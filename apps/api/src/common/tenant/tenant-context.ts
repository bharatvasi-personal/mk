import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, Role } from '@mk/shared';

export interface RequestActor {
  userId: string;
  name: string;
  grants: { role: Role; branchId: string | null }[];
  permissions: Set<Permission>;
  kind: 'STAFF' | 'CUSTOMER' | 'DEVICE';
  customerId?: string;
}

export interface RequestContext {
  requestId: string;
  tenantId: string;
  tenantSlug?: string;
  actor?: RequestActor;
  ip?: string;
  userAgent?: string;
}

/**
 * Request context in AsyncLocalStorage rather than threaded through every function
 * signature. The tenant id in particular is needed by the database layer on every
 * single query, and passing it by hand is exactly the thing that eventually gets
 * forgotten.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const TenantContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** Throws rather than returning undefined — a query with no tenant is a bug, not a state. */
  require(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No tenant context. Every database access must happen inside TenantContext.run(). ' +
          'Background jobs must wrap their work explicitly.',
      );
    }
    return ctx;
  },

  peek(): RequestContext | undefined {
    return storage.getStore();
  },

  tenantId(): string {
    return TenantContext.require().tenantId;
  },

  actor(): RequestActor | undefined {
    return storage.getStore()?.actor;
  },
};
