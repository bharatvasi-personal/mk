import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Role } from '@mk/shared';
import { TENANT_WIDE_ROLES } from '@mk/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { hashPassword, randomToken } from '../../common/auth/crypto';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /**
   * Branches the caller can actually see. A tenant-wide grant sees all; a branch grant
   * sees only its own. This is what makes the branch picker in the UI correct without
   * the UI having to know the rules.
   */
  async listForActor() {
    const actor = TenantContext.actor();
    return this.db.run(async (tx) => {
      const all = await tx.branch.findMany({
        where: { isActive: true },
        include: { _count: { select: { employees: { where: { isActive: true } } } } },
        orderBy: { code: 'asc' },
      });
      if (!actor) return all;
      const tenantWide = actor.grants.some((g) => g.branchId === null);
      if (tenantWide) return all;
      const allowed = new Set(actor.grants.map((g) => g.branchId));
      return all.filter((b) => allowed.has(b.id));
    });
  }

  async get(id: string) {
    return this.db.run((tx) =>
      tx.branch.findUniqueOrThrow({
        where: { id },
        include: {
          diningTables: { where: { isActive: true }, orderBy: { label: 'asc' } },
          shifts: { where: { isActive: true } },
          _count: { select: { employees: true, orders: true } },
        },
      }),
    );
  }

  async upsert(
    input: {
      code: string;
      name: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      pincode: string;
      lat?: number;
      lng?: number;
      phone?: string;
      gstin?: string;
      geofenceRadiusM?: number;
      openingDate?: string;
      operatingHours?: Record<string, unknown>;
      isActive?: boolean;
    },
    id?: string,
  ) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const data = {
        ...input,
        openingDate: input.openingDate ? new Date(input.openingDate) : undefined,
        operatingHours: (input.operatingHours ?? {}) as never,
      };
      if (id) {
        const before = await tx.branch.findUniqueOrThrow({ where: { id } });
        const after = await tx.branch.update({ where: { id }, data });
        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'Branch',
          entityId: id,
          branchId: id,
          ...diff(before as never, after as never),
        });
        return after;
      }
      const created = await tx.branch.create({ data: { ...data, tenantId } });
      await this.audit.log(tx, {
        action: 'CREATE',
        entity: 'Branch',
        entityId: created.id,
        branchId: created.id,
        after: created,
      });
      return created;
    });
  }

  async upsertTable(input: { branchId: string; label: string; seats: number; isActive: boolean }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      return tx.diningTable.upsert({
        where: { branchId_label: { branchId: input.branchId, label: input.label } },
        create: { ...input, tenantId },
        update: { seats: input.seats, isActive: input.isActive },
      });
    });
  }

  // ─── Users & access ───────────────────────────────────────────────────────

  async listUsers() {
    return this.db.run((tx) =>
      tx.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          totpEnabled: true,
          lastLoginAt: true,
          branchRoles: {
            select: { id: true, role: true, branchId: true, branch: { select: { name: true, code: true } } },
          },
          employee: { select: { id: true, employeeCode: true, roleType: true } },
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  /**
   * Creates a staff login with a generated temporary password, returned exactly once.
   *
   * Deliberately not an e-mailed invite link: several of these people do not use e-mail,
   * and the manager handing over a password in person is the flow that actually works
   * in a 12x18 ft shop. The password is one-time and must be changed on first sign-in.
   */
  async createUser(input: {
    name: string;
    email?: string;
    phone?: string;
    role: Role;
    branchId?: string | null;
    employeeId?: string;
  }) {
    if (!input.email && !input.phone) {
      throw new BadRequestException('A login needs either an e-mail or a phone number');
    }
    this.assertGrantIsValid(input.role, input.branchId ?? null);

    const tempPassword = `mk-${randomToken(6).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;

    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const user = await tx.user.create({
        data: {
          tenantId,
          name: input.name,
          email: input.email?.toLowerCase(),
          phone: input.phone?.replace(/^\+91/, ''),
          passwordHash: await hashPassword(tempPassword),
          branchRoles: {
            create: {
              tenantId,
              role: input.role,
              branchId: TENANT_WIDE_ROLES.includes(input.role) ? null : input.branchId,
              grantedByUserId: TenantContext.actor()?.userId,
            },
          },
        },
      });

      if (input.employeeId) {
        await tx.employee.update({ where: { id: input.employeeId }, data: { userId: user.id } });
      }

      await this.audit.log(tx, {
        action: 'USER_CREATED',
        entity: 'User',
        entityId: user.id,
        branchId: input.branchId ?? null,
        after: { name: input.name, email: input.email, phone: input.phone, role: input.role },
      });

      return {
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
        /** Shown once. Hand it over in person; they must change it on first sign-in. */
        temporaryPassword: tempPassword,
      };
    });
  }

  async grantRole(input: { userId: string; role: Role; branchId?: string | null }) {
    this.assertGrantIsValid(input.role, input.branchId ?? null);
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const branchId = TENANT_WIDE_ROLES.includes(input.role) ? null : (input.branchId ?? null);
      if (!TENANT_WIDE_ROLES.includes(input.role) && !branchId) {
        throw new BadRequestException(`${input.role} must be granted against a specific branch`);
      }

      const grant = await tx.userBranchRole.create({
        data: {
          tenantId,
          userId: input.userId,
          role: input.role,
          branchId,
          grantedByUserId: TenantContext.actor()?.userId,
        },
      });

      await this.audit.log(tx, {
        action: 'ROLE_GRANTED',
        entity: 'UserBranchRole',
        entityId: grant.id,
        branchId,
        after: { userId: input.userId, role: input.role, branchId },
      });
      return grant;
    });
  }

  async revokeRole(grantId: string) {
    return this.db.run(async (tx) => {
      const grant = await tx.userBranchRole.findUniqueOrThrow({ where: { id: grantId } });

      // Never leave a tenant with no owner. This is the mistake that needs a DBA to undo.
      if (grant.role === 'OWNER') {
        const owners = await tx.userBranchRole.count({ where: { role: 'OWNER' } });
        if (owners <= 1) {
          throw new BadRequestException('Cannot revoke the last owner — grant another owner first');
        }
      }

      await tx.userBranchRole.delete({ where: { id: grantId } });
      await this.audit.log(tx, {
        action: 'ROLE_REVOKED',
        entity: 'UserBranchRole',
        entityId: grantId,
        branchId: grant.branchId,
        before: grant,
      });
      return { ok: true as const };
    });
  }

  async setUserActive(userId: string, isActive: boolean) {
    return this.db.run(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { isActive } });
      if (!isActive) {
        // Deactivating must end their sessions immediately, not at token expiry.
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.log(tx, {
        action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        entity: 'User',
        entityId: userId,
        after: { isActive },
      });
      return { id: user.id, isActive: user.isActive };
    });
  }

  /** Only an OWNER may create or change another OWNER or PARTNER. */
  private assertGrantIsValid(role: Role, branchId: string | null): void {
    const actor = TenantContext.actor();
    if (!actor) return;
    if ((role === 'OWNER' || role === 'PARTNER') && !actor.grants.some((g) => g.role === 'OWNER')) {
      throw new ForbiddenException('Only an owner can grant owner or partner access');
    }
    if (!TENANT_WIDE_ROLES.includes(role) && !branchId) {
      throw new BadRequestException(`${role} must be granted against a branch`);
    }
  }
}
