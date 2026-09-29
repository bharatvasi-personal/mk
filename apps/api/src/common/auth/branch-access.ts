import { ForbiddenException } from '@nestjs/common';
import { canAt, type Permission } from '@mk/shared';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Asserts the caller may act on a record **at the branch that record belongs to**.
 *
 * The guard on the way in can only scope a request that names a branch, and most
 * endpoints that act on a record do not: settle *this order*, approve *this stock count*,
 * approve *this payroll run*, download *this document*. Without this check, a manager at
 * one branch could act on another branch's records simply by knowing an id — the id is
 * the only thing the request carries.
 *
 * So the check happens here, after the record is loaded, against the branch on the
 * record. Call it immediately after the lookup and before anything is changed.
 *
 * A `null` branch means the record belongs to the whole business (a partnership deed, for
 * instance); then holding the permission anywhere is enough.
 */
export function assertBranchAccess(branchId: string | null, permission: Permission): void {
  const actor = TenantContext.actor();

  // No actor means an internal caller — a scheduled job or the payment webhook, both of
  // which run outside any user's session and are trusted by other means.
  if (!actor) return;

  if (actor.kind !== 'STAFF') {
    throw new ForbiddenException('Staff access required');
  }

  if (branchId === null) {
    if (!actor.permissions.has(permission)) {
      throw new ForbiddenException(`Requires "${permission}"`);
    }
    return;
  }

  if (!canAt(actor.grants, permission, branchId)) {
    throw new ForbiddenException(
      `Requires "${permission}" at the branch this record belongs to`,
    );
  }
}
