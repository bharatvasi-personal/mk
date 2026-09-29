import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import type { Role } from '@mk/shared';
import { loadConfig } from '../../config/configuration';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationService } from '../../common/notifications/notification.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  generateOtp,
  hashPassword,
  openString,
  randomToken,
  sealString,
  sha256,
  verifyPassword,
} from '../../common/auth/crypto';
import { TokenService } from '../../common/auth/token.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
/** A counter phone is shared; one code per minute stops it becoming an SMS bill. */
const OTP_RESEND_SECONDS = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cfg = loadConfig();

  constructor(
    private readonly db: TenantDb,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
  ) {}

  // ─── Staff ────────────────────────────────────────────────────────────────

  async staffLogin(input: {
    identifier: string;
    password: string;
    totpCode?: string;
    client: 'WEB' | 'POS' | 'MOBILE';
  }) {
    const ctx = TenantContext.require();
    const identifier = input.identifier.trim();
    const isEmail = identifier.includes('@');

    return this.db.run(async (tx) => {
      const user = await tx.user.findFirst({
        where: isEmail
          ? { email: identifier.toLowerCase() }
          : { phone: identifier.replace(/^\+91/, '') },
        include: { branchRoles: { select: { role: true, branchId: true } } },
      });

      // Uniform failure for unknown user, wrong password and inactive account —
      // otherwise the error message tells an attacker which usernames exist.
      const fail = () => new UnauthorizedException('Those details did not match');

      if (!user || !user.passwordHash || !user.isActive) {
        // Spend comparable time so the response does not time-leak account existence.
        await verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000',
          input.password,
        );
        throw fail();
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new ForbiddenException('Too many attempts. Try again in a few minutes.');
      }

      if (!(await verifyPassword(user.passwordHash, input.password))) {
        const failed = user.failedLoginCount + 1;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            lockedUntil:
              failed >= MAX_FAILED_LOGINS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                : null,
          },
        });
        await this.audit.log(tx, {
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: user.id,
          after: { failedLoginCount: failed },
        });
        throw fail();
      }

      if (user.totpEnabled && user.totpSecret) {
        if (!input.totpCode) throw new UnauthorizedException('Authenticator code required');
        const secret = openString(user.totpSecret);
        if (!authenticator.verify({ token: input.totpCode, secret })) {
          throw new UnauthorizedException('That authenticator code is not valid');
        }
      }

      if (user.branchRoles.length === 0) {
        throw new ForbiddenException('This account has no access grants yet');
      }

      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      const pair = await this.issueTokens(tx, {
        userId: user.id,
        tenantId: ctx.tenantId,
        name: user.name,
        kind: 'STAFF',
        grants: user.branchRoles as { role: Role; branchId: string | null }[],
        client: input.client,
      });

      await this.audit.log(tx, { action: 'LOGIN', entity: 'User', entityId: user.id });

      return {
        ...pair,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          locale: user.locale,
          totpEnabled: user.totpEnabled,
          grants: user.branchRoles,
        },
      };
    });
  }

  // ─── Customers (phone + OTP) ──────────────────────────────────────────────

  async requestOtp(phone: string) {
    const normalized = phone.replace(/^\+91/, '');
    return this.db.run(async (tx) => {
      const recent = await tx.otpChallenge.findFirst({
        where: { phone: normalized, createdAt: { gt: new Date(Date.now() - OTP_RESEND_SECONDS * 1000) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        throw new BadRequestException('A code was just sent. Wait a minute before asking for another.');
      }

      const code = generateOtp();
      await tx.otpChallenge.create({
        data: {
          tenantId: TenantContext.tenantId(),
          phone: normalized,
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        },
      });

      const result = await this.notify.sendOtpNow(normalized, code);
      return { sent: true, expiresInSeconds: OTP_TTL_MINUTES * 60, devCode: result.devCode };
    });
  }

  async verifyOtp(input: { phone: string; code: string; name?: string }) {
    const normalized = input.phone.replace(/^\+91/, '');
    const ctx = TenantContext.require();

    return this.db.run(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: { phone: normalized, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) throw new UnauthorizedException('That code has expired. Ask for a new one.');
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        throw new ForbiddenException('Too many wrong codes. Ask for a new one.');
      }
      if (challenge.codeHash !== sha256(input.code)) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
        throw new UnauthorizedException('That code is not correct');
      }

      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      const customer = await tx.customer.upsert({
        where: { tenantId_phone: { tenantId: ctx.tenantId, phone: normalized } },
        create: { tenantId: ctx.tenantId, phone: normalized, name: input.name },
        // Only fill the name if we did not have one — never overwrite what they told us before.
        update: input.name ? { name: input.name } : {},
      });

      const pair = await this.issueTokens(tx, {
        userId: customer.id,
        tenantId: ctx.tenantId,
        name: customer.name ?? 'Guest',
        kind: 'CUSTOMER',
        grants: [],
        client: 'WEB',
      });

      return {
        ...pair,
        customer: { id: customer.id, name: customer.name, phone: customer.phone },
      };
    });
  }

  // ─── Refresh rotation ─────────────────────────────────────────────────────

  /**
   * Rotating refresh tokens with reuse detection: presenting an already-rotated token
   * means either a bug or a stolen token, and in both cases the safe response is to
   * revoke the whole family and force a fresh login.
   */
  async refresh(rawToken: string) {
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const tokenHash = sha256(rawToken);

    return this.db.run(async (tx) => {
      const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!existing) throw new UnauthorizedException('Unknown refresh token');

      if (existing.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(
          `Refresh token reuse detected for family ${existing.familyId}; family revoked`,
        );
        await this.audit.log(tx, {
          action: 'REFRESH_REUSE_DETECTED',
          entity: 'RefreshToken',
          entityId: existing.id,
        });
        throw new UnauthorizedException('Session ended. Please sign in again.');
      }

      if (existing.expiresAt < new Date()) throw new UnauthorizedException('Session expired');

      const user = await tx.user.findFirst({
        where: { id: existing.userId, isActive: true },
        include: { branchRoles: { select: { role: true, branchId: true } } },
      });

      // A customer's refresh token has no matching User row — look them up instead.
      const customer = user
        ? null
        : await tx.customer.findFirst({ where: { id: existing.userId, isBlocked: false } });

      if (!user && !customer) throw new UnauthorizedException('Account is no longer active');

      const newRaw = randomToken();
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedByTokenHash: sha256(newRaw) },
      });

      const claims = {
        sub: existing.userId,
        tid: existing.tenantId,
        kind: user ? ('STAFF' as const) : ('CUSTOMER' as const),
        name: user?.name ?? customer?.name ?? 'Guest',
        grants: (user?.branchRoles ?? []) as { role: Role; branchId: string | null }[],
      };

      await tx.refreshToken.create({
        data: {
          tenantId: existing.tenantId,
          userId: existing.userId,
          tokenHash: sha256(newRaw),
          familyId: existing.familyId,
          client: existing.client,
          expiresAt: new Date(Date.now() + this.cfg.JWT_REFRESH_TTL_DAYS * 86_400_000),
        },
      });

      return {
        accessToken: await this.tokens.sign(claims),
        refreshToken: newRaw,
        expiresIn: this.tokens.accessTtlSeconds(),
      };
    });
  }

  async logout(rawToken: string | undefined): Promise<{ ok: true }> {
    if (rawToken) {
      await this.db.run(async (tx) => {
        const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
        if (row) {
          // Revoke the family, not just this token — "sign out" should mean it.
          await tx.refreshToken.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      });
    }
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    return this.db.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new UnauthorizedException('Current password is not correct');
      }
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      // Changing a password ends every other session — that is the point of changing it.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(tx, { action: 'PASSWORD_CHANGED', entity: 'User', entityId: userId });
      return { ok: true as const };
    });
  }

  async setupTotp(userId: string) {
    const secret = authenticator.generateSecret();
    return this.db.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      // Stored encrypted and not yet enabled — enabling requires proving a code works,
      // otherwise a mistyped setup locks the owner out of their own business.
      await tx.user.update({
        where: { id: userId },
        data: { totpSecret: sealString(secret) },
      });
      return {
        secret,
        otpauthUrl: authenticator.keyuri(user.email ?? user.name, 'MithilaKitchen', secret),
      };
    });
  }

  async enableTotp(userId: string, code: string) {
    return this.db.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpSecret) throw new BadRequestException('Start the setup first');
      if (!authenticator.verify({ token: code, secret: openString(user.totpSecret) })) {
        throw new BadRequestException('That code is not valid — check your authenticator app');
      }
      await tx.user.update({ where: { id: userId }, data: { totpEnabled: true } });
      await this.audit.log(tx, { action: 'TOTP_ENABLED', entity: 'User', entityId: userId });
      return { ok: true as const };
    });
  }

  async me() {
    const actor = TenantContext.actor();
    if (!actor) throw new UnauthorizedException();
    return this.db.run(async (tx) => {
      if (actor.kind === 'CUSTOMER') {
        const c = await tx.customer.findUniqueOrThrow({
          where: { id: actor.userId },
          select: { id: true, name: true, phone: true, locale: true },
        });
        return { kind: 'CUSTOMER' as const, ...c };
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          locale: true,
          totpEnabled: true,
          branchRoles: {
            select: {
              role: true,
              branchId: true,
              branch: { select: { id: true, name: true, code: true } },
            },
          },
          employee: { select: { id: true, employeeCode: true, roleType: true, branchId: true } },
        },
      });
      return {
        kind: 'STAFF' as const,
        ...user,
        permissions: [...actor.permissions],
      };
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async issueTokens(
    tx: Tx,
    args: {
      userId: string;
      tenantId: string;
      name: string;
      kind: 'STAFF' | 'CUSTOMER';
      grants: { role: Role; branchId: string | null }[];
      client: 'WEB' | 'POS' | 'MOBILE';
    },
  ) {
    const refreshToken = randomToken();
    await tx.refreshToken.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        tokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        client: args.client,
        userAgent: TenantContext.peek()?.userAgent ?? null,
        ip: TenantContext.peek()?.ip ?? null,
        expiresAt: new Date(Date.now() + this.cfg.JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });

    return {
      accessToken: await this.tokens.sign({
        sub: args.userId,
        tid: args.tenantId,
        kind: args.kind,
        name: args.name,
        grants: args.grants,
      }),
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds(),
    };
  }
}
