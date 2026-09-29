import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantDb } from '../common/prisma/tenant-db.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { LegalService } from '../modules/legal/legal.service';
import { ReportsService } from '../modules/reports/reports.service';
import { StockService } from '../modules/inventory/stock.service';

/**
 * Scheduled work.
 *
 * In-process cron rather than a separate scheduler because there are five jobs, one
 * server, and no need for a second moving part. The jobs are all idempotent, so a
 * restart mid-run or a double fire is harmless — which is the property that makes this
 * simplification safe rather than merely convenient.
 *
 * Every job must establish its own tenant context: there is no request to inherit one
 * from, and the database layer refuses to run without it.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly reports: ReportsService,
    private readonly legal: LegalService,
    private readonly stock: StockService,
  ) {}

  /** 00:20 IST — roll up yesterday for every branch. */
  @Cron('20 0 * * *', { timeZone: 'Asia/Kolkata' })
  async rollupYesterday(): Promise<void> {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await this.forEachTenant(async (branches) => {
      for (const branch of branches) {
        await this.reports.rollupDay(branch.id, yesterday);
      }
    });
    this.logger.log(`Daily rollup complete for ${yesterday}`);
  }

  /** 00:05 IST — clear yesterday's sold-out flags so the menu opens clean. */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  async clearSoldOut(): Promise<void> {
    await this.forEachTenant(async (_branches, tenantId) => {
      const cleared = await this.db.run(
        (tx) =>
          tx.branchMenuItem.updateMany({
            where: { soldOutUntil: { lt: new Date() } },
            data: { soldOutUntil: null },
          }),
        { tenantId },
      );
      if (cleared.count) this.logger.log(`Cleared ${cleared.count} sold-out flags`);
    });
  }

  /** 07:00 IST — document renewal reminders. Deliberately early: partners read at breakfast. */
  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })
  async documentReminders(): Promise<void> {
    await this.forEachTenant(async () => {
      const { queued } = await this.legal.dispatchDueReminders();
      if (queued) this.logger.log(`Queued ${queued} document reminder e-mails`);
    });
  }

  /** 02:00 IST — repair the on-hand cache from the ledger. Should always be a no-op. */
  @Cron('0 2 * * *', { timeZone: 'Asia/Kolkata' })
  async reconcileStock(): Promise<void> {
    await this.forEachTenant(async (branches) => {
      for (const branch of branches) {
        const { repairedRows } = await this.stock.reconcileCache(branch.id);
        if (repairedRows > 0) {
          // A non-zero count means something wrote stock outside the ledger path. Worth
          // investigating rather than quietly fixing forever.
          this.logger.warn(
            `Repaired ${repairedRows} on-hand rows at branch ${branch.code} — the ledger and ` +
              'the cache had drifted, which should not happen',
          );
        }
      }
    });
  }

  /**
   * 03:30 IST — drop idempotency records older than 48 h.
   *
   * Done per tenant rather than in one sweep, because the app role cannot see across
   * tenants (by design) and a maintenance job is not a good reason to make an exception.
   */
  @Cron('30 3 * * *', { timeZone: 'Asia/Kolkata' })
  async pruneIdempotency(): Promise<void> {
    let total = 0;
    await this.forEachTenant(async (_branches, tenantId) => {
      const deleted = await this.db.run(
        (tx) =>
          tx.idempotencyRecord.deleteMany({
            where: { createdAt: { lt: new Date(Date.now() - 48 * 3_600_000) } },
          }),
        { tenantId },
      );
      total += deleted.count;
    });
    if (total) this.logger.log(`Pruned ${total} idempotency records`);
  }

  /** Runs `fn` once per active tenant, inside that tenant's context. */
  private async forEachTenant(
    fn: (branches: { id: string; code: string }[], tenantId: string) => Promise<void>,
  ): Promise<void> {
    const tenants = await this.db.runWithoutTenantScope('enumerate tenants for a scheduled job', (tx) =>
      tx.$queryRaw<{ id: string; slug: string }[]>`SELECT * FROM public.list_active_tenants()`,
    );

    for (const tenant of tenants) {
      const branches = await this.db.run(
        (tx) => tx.branch.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
        { tenantId: tenant.id },
      );
      await TenantContext.run(
        { requestId: `cron-${Date.now()}`, tenantId: tenant.id, tenantSlug: tenant.slug },
        async () => {
          try {
            await fn(branches, tenant.id);
          } catch (err) {
            this.logger.error(`Job failed for tenant ${tenant.slug}: ${(err as Error).message}`);
          }
        },
      );
    }
  }
}
