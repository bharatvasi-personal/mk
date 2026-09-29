import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';
import { PrismaService } from './prisma.service';

/** A Prisma transaction client — what every repository method receives. */
export type Tx = Prisma.TransactionClient;

/**
 * Every database access goes through here.
 *
 * `run()` opens a transaction and sets `app.tenant_id` as a transaction-local
 * setting before running the callback. Postgres row-level security policies read
 * that setting, so a query that forgets its tenant filter returns zero rows rather
 * than another tenant's data.
 *
 * The cost is one extra round trip per transaction (`set_config`). At this business's
 * volume that is irrelevant, and it buys an isolation guarantee that does not depend
 * on every developer remembering a `where` clause forever.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(fn: (tx: Tx) => Promise<T>, opts?: { tenantId?: string; tx?: Tx; timeoutMs?: number }): Promise<T> {
    // Already inside a tenant-scoped transaction — reuse it so callers compose.
    if (opts?.tx) return fn(opts.tx);

    const tenantId = opts?.tenantId ?? TenantContext.tenantId();
    return this.prisma.$transaction(
      async (tx) => {
        await this.applyTenant(tx, tenantId);
        return fn(tx);
      },
      { timeout: opts?.timeoutMs ?? 15_000, maxWait: 5_000 },
    );
  }

  /**
   * Runs without setting `app.tenant_id`.
   *
   * This does **not** grant cross-tenant access — the connection is still the
   * non-privileged app role, so RLS hides every tenant-owned row. It exists for the
   * three operations that legitimately precede a tenant scope, and those go through the
   * narrow SECURITY DEFINER functions in prisma/sql/02_rls.sql. Deliberately verbose so
   * the reason is stated at the call site.
   */
  async runWithoutTenantScope<T>(reason: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    void reason;
    return this.prisma.$transaction(async (tx) => fn(tx), { timeout: 30_000 });
  }

  private async applyTenant(tx: Tx, tenantId: string): Promise<void> {
    // `true` = transaction-local, so the setting cannot leak to the next borrower
    // of this pooled connection.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, true)`;
  }

  get raw(): PrismaService {
    return this.prisma;
  }
}
