import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, permissionsFor, type Permission, type Role } from '@mk/shared';
import { TenantContext } from '../tenant/tenant-context';
import { TenantDb } from '../prisma/tenant-db.service';
import { ALLOW_CUSTOMER, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';
import { TokenService } from './token.service';

/**
 * One guard does authentication and authorization, because splitting them across two
 * guards means two passes over the same metadata and an ordering dependency for no
 * gain.
 *
 * Branch scoping is checked here too: if the request carries a `branchId` (body,
 * query or param), the caller's grant must cover that branch. That single check is
 * what stops a Tellapur manager reading branch #2's numbers, and it applies to every
 * endpoint without each one remembering.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: TenantDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const cls = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, cls])) return true;

    const req = context.switchToHttp().getRequest();
    const claims = await this.readToken(req);
    const ctx = TenantContext.require();

    if (claims.tid !== ctx.tenantId) {
      // A token minted for another tenant. Not merely unauthorized — worth noticing.
      throw new ForbiddenException('Token does not belong to this tenant');
    }

    const allowCustomer = this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMER, [handler, cls]);
    if (claims.kind === 'CUSTOMER' && !allowCustomer) {
      throw new ForbiddenException('Staff access required');
    }

    // Grants are re-read from the database rather than trusted from the token, so
    // revoking a manager's access takes effect immediately instead of at token expiry.
    const grants = claims.kind === 'STAFF' ? await this.loadGrants(claims.sub) : [];
    if (claims.kind === 'STAFF' && grants.length === 0) {
      throw new ForbiddenException('This account has no active access grants');
    }

    ctx.actor = {
      userId: claims.sub,
      name: claims.name,
      kind: claims.kind,
      grants,
      permissions: permissionsFor(grants),
      customerId: claims.kind === 'CUSTOMER' ? claims.sub : undefined,
    };

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [handler, cls]) ?? [];
    if (required.length === 0) return true;

    const branchId = this.branchIdFrom(req);
    for (const permission of required) {
      if (!can(grants, permission, branchId)) {
        throw new ForbiddenException(
          branchId
            ? `Requires "${permission}" at this branch`
            : `Requires "${permission}"`,
        );
      }
    }
    return true;
  }

  private async readToken(req: { headers: Record<string, unknown> }) {
    const raw = req.headers['authorization'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      return await this.tokens.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async loadGrants(userId: string): Promise<{ role: Role; branchId: string | null }[]> {
    return this.db.run(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, isActive: true },
        select: { branchRoles: { select: { role: true, branchId: true } } },
      });
      return (user?.branchRoles ?? []) as { role: Role; branchId: string | null }[];
    });
  }

  private branchIdFrom(req: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }): string | undefined {
    for (const src of [req.params, req.query, req.body]) {
      const v = src?.['branchId'];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  }
}
