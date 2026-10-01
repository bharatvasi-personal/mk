/**
 * The single source of truth for authorization.
 *
 * The API guards import this to decide access; the web app imports the *same* file
 * to decide what to render. That is deliberate: the usual bug in role-based systems
 * is a UI that offers a button the API then rejects, because permissions were
 * written down twice.
 *
 * Guards check permissions, never role names. Adding a role later touches only
 * ROLE_PERMISSIONS below.
 */

export const ROLES = ['OWNER', 'PARTNER', 'MANAGER', 'CHEF', 'HELPER', 'ACCOUNTANT'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Menu
  'menu:read',
  'menu:write',
  'menu:price:write',
  // Orders & billing
  'order:read',
  'order:create',
  'order:void',
  'order:settle',
  'order:discount',
  'order:refund',
  'kitchen:read',
  'kitchen:update',
  'cash_session:manage',
  // Subscriptions (weekly / monthly meal plans)
  'subscription:read',
  'subscription:write',
  // Inventory
  'inventory:read',
  'inventory:write',
  'inventory:cost:read',
  'stock:issue',
  'stock:wastage',
  'stock:count',
  'stock:count:approve',
  'recipe:read',
  'recipe:write',
  // Vendors & purchasing
  'vendor:read',
  'vendor:write',
  'po:read',
  'po:create',
  'po:approve',
  'grn:create',
  'payable:read',
  'payable:pay',
  // Employees & payroll
  'employee:read',
  'employee:write',
  'salary:read',
  'salary:write',
  'payroll:read',
  'payroll:run',
  'payroll:approve',
  'shift:write',
  // Attendance
  'attendance:punch:self',
  'attendance:read:self',
  'attendance:read:all',
  'attendance:correct',
  'attendance:approve',
  'attendance:device:manage',
  // Legal documents
  'legal:read',
  'legal:write',
  'legal:download',
  // Branch & tenant admin
  'branch:read',
  'branch:write',
  'user:read',
  'user:write',
  'role:grant',
  'tenant:settings',
  'audit:read',
  // Reporting
  'report:sales',
  'report:cost',
  'report:staff',
  'report:variance',
  'report:consolidated',
  'expense:read',
  'expense:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Everything. Used by OWNER and (minus a couple of entries) PARTNER. */
const ALL: Permission[] = [...PERMISSIONS];

const MANAGER: Permission[] = [
  'menu:read',
  'menu:write',
  'menu:price:write',
  'order:read',
  'order:create',
  'order:void',
  'order:settle',
  'order:discount',
  'order:refund',
  'kitchen:read',
  'kitchen:update',
  'cash_session:manage',
  'subscription:read',
  'subscription:write',
  'inventory:read',
  'inventory:write',
  'inventory:cost:read',
  'stock:issue',
  'stock:wastage',
  'stock:count',
  'recipe:read',
  'recipe:write',
  'vendor:read',
  'vendor:write',
  'po:read',
  'po:create',
  'grn:create',
  'payable:read',
  'employee:read',
  'shift:write',
  'attendance:punch:self',
  'attendance:read:self',
  'attendance:read:all',
  'attendance:correct',
  'attendance:approve',
  'expense:read',
  'expense:write',
  'report:sales',
  'report:cost',
  'report:staff',
  'report:variance',
  'branch:read',
];

const CHEF: Permission[] = [
  'menu:read',
  'order:read',
  'kitchen:read',
  'kitchen:update',
  'inventory:read',
  'stock:issue',
  'stock:wastage',
  'recipe:read',
  'attendance:punch:self',
  'attendance:read:self',
];

/**
 * A helper takes orders and settles them. Note the deliberate absences:
 * no cost prices, no reports, no discounts, no voids. At this wage level the
 * separation is not distrust, it is protecting them from being blamed.
 */
const HELPER: Permission[] = [
  'menu:read',
  'order:read',
  'order:create',
  'order:settle',
  'kitchen:read',
  'attendance:punch:self',
  'attendance:read:self',
];

const ACCOUNTANT: Permission[] = [
  'order:read',
  'subscription:read',
  'inventory:read',
  'inventory:cost:read',
  'vendor:read',
  'po:read',
  'payable:read',
  'payable:pay',
  'employee:read',
  'salary:read',
  'payroll:read',
  'attendance:read:all',
  'legal:read',
  'expense:read',
  'expense:write',
  'report:sales',
  'report:cost',
  'report:staff',
  'report:variance',
  'report:consolidated',
  'branch:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  // A partner can do everything operationally but cannot change another partner's
  // access or tenant-level settings — the guard rail that keeps a partnership civil.
  PARTNER: ALL.filter((p) => p !== 'role:grant' && p !== 'tenant:settings'),
  MANAGER,
  CHEF,
  HELPER,
  ACCOUNTANT,
};

/** Roles whose grant is tenant-wide; the rest are meaningful only against a branch. */
export const TENANT_WIDE_ROLES: readonly Role[] = ['OWNER', 'PARTNER', 'ACCOUNTANT'];

export interface RoleGrant {
  role: Role;
  /** null = tenant-wide */
  branchId: string | null;
}

export function permissionsFor(grants: readonly RoleGrant[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const g of grants) for (const p of ROLE_PERMISSIONS[g.role] ?? []) out.add(p);
  return out;
}

/**
 * Does this set of grants allow `permission`, optionally at `branchId`?
 * A tenant-wide grant satisfies any branch. A branch grant satisfies only that branch.
 */
/**
 * Does this person hold `permission` — optionally, at `branchId`?
 *
 * With no branch given this asks "anywhere", which is the right question for
 * tenant-level things: the dish catalogue, the vendor directory and the item list are
 * shared across branches, so a manager of one branch legitimately edits them.
 *
 * It is the WRONG question for anything that belongs to a branch. Use `canAt` there, and
 * pass the branch the *record* belongs to rather than the one the caller claims — see the
 * note on `canAt`.
 */
export function can(
  grants: readonly RoleGrant[],
  permission: Permission,
  branchId?: string | null,
): boolean {
  for (const g of grants) {
    if (!ROLE_PERMISSIONS[g.role]?.includes(permission)) continue;
    if (g.branchId === null) return true; // tenant-wide grant satisfies any branch
    if (!branchId) return true; // asking "anywhere", and this grant is somewhere
    if (g.branchId === branchId) return true;
  }
  return false;
}

/**
 * Strict branch check: the permission must be held **at this specific branch**.
 *
 * The distinction matters because most endpoints that act on a record take the record's
 * id, not a branch id — settle this order, approve this stock count, approve this payroll
 * run, download this document. The request never mentions a branch, so a guard reading
 * the request cannot scope it, and a manager at one branch could act on another's records
 * simply by knowing an id.
 *
 * So the check has to happen after the record is loaded, against the branch the record
 * actually belongs to. A missing branch here is a programming error, not "anywhere" —
 * hence the separate function rather than an optional argument that is easy to forget.
 */
export function canAt(
  grants: readonly RoleGrant[],
  permission: Permission,
  branchId: string,
): boolean {
  for (const g of grants) {
    if (!ROLE_PERMISSIONS[g.role]?.includes(permission)) continue;
    if (g.branchId === null || g.branchId === branchId) return true;
  }
  return false;
}

export function branchesFor(grants: readonly RoleGrant[]): { all: boolean; ids: string[] } {
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.branchId === null) return { all: true, ids: [] };
    ids.add(g.branchId);
  }
  return { all: false, ids: [...ids] };
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  PARTNER: 'Partner',
  MANAGER: 'Manager',
  CHEF: 'Chef',
  HELPER: 'Helper',
  ACCOUNTANT: 'Accountant',
};
