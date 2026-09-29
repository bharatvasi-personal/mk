import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@mk/shared';
import { TenantContext, type RequestActor } from '../tenant/tenant-context';

export const IS_PUBLIC = 'mk:isPublic';
export const REQUIRED_PERMISSIONS = 'mk:permissions';
export const ALLOW_CUSTOMER = 'mk:allowCustomer';

/** No authentication. Public menu, health, webhooks (which verify their own signature). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Permissions, never role names. Adding a role later means editing the RBAC matrix
 * in @mk/shared and nothing else.
 */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

/** Endpoints a logged-in customer may call (their own orders, for instance). */
export const AllowCustomer = () => SetMetadata(ALLOW_CUSTOMER, true);

export const CurrentActor = createParamDecorator((_d: unknown, _ctx: ExecutionContext): RequestActor => {
  const actor = TenantContext.actor();
  if (!actor) throw new Error('CurrentActor used on an endpoint with no authenticated actor');
  return actor;
});

export const CurrentTenant = createParamDecorator((_d: unknown, _ctx: ExecutionContext): string =>
  TenantContext.tenantId(),
);
