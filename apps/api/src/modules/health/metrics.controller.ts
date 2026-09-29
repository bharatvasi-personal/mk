import { Controller, Get, Header } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Prometheus metrics.
 *
 * Hand-rolled rather than pulling in a client library, because what is worth scraping
 * here is small and specific, and a dependency that exposes forty Node internals by
 * default is mostly noise on a box running one shop.
 *
 * The business gauges are the point. Process memory tells you the container is alive;
 * "zero orders in the last hour during lunch service" tells you the counter has stopped,
 * which is the thing someone actually needs to be woken up for.
 */
@Controller('metrics')
export class MetricsController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const lines: string[] = [];
    const memory = process.memoryUsage();

    const gauge = (name: string, help: string, value: number, labels = '') => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${value}`);
    };

    gauge('mk_uptime_seconds', 'Seconds since the API process started', Math.round(process.uptime()));
    gauge('mk_process_resident_bytes', 'Resident set size', memory.rss);
    gauge('mk_process_heap_used_bytes', 'V8 heap in use', memory.heapUsed);
    gauge('mk_build_info', 'Always 1; labels carry the build', 1, `{node="${process.version}"}`);

    try {
      // One query for every business gauge. Cross-tenant on purpose — this is the
      // operator's view of the whole platform, and it returns counts only, never rows.
      // Through a SECURITY DEFINER function returning aggregate counts only: a scrape
      // has no tenant, and row-level security would otherwise hide every row and report
      // a busy shop as a dead one. See prisma/sql/02_rls.sql.
      const [row] = await this.prisma.$queryRaw<
        {
          orders_last_hour: bigint;
          orders_today: bigint;
          revenue_today_minor: bigint | null;
          queued_notifications: bigint;
          failed_notifications: bigint;
          open_cash_sessions: bigint;
          attendance_needs_review: bigint;
          expired_documents: bigint;
          overdue_payables_minor: bigint | null;
          active_tenants: bigint;
          active_branches: bigint;
        }[]
      >(Prisma.sql`SELECT * FROM public.platform_metrics()`);

      const n = (v: bigint | null | undefined) => Number(v ?? 0);

      gauge('mk_database_up', 'Whether the database answered this scrape', 1);
      gauge('mk_orders_settled_last_hour', 'Bills settled in the last hour', n(row?.orders_last_hour));
      gauge('mk_orders_settled_today', 'Bills settled today (IST)', n(row?.orders_today));
      gauge('mk_revenue_today_paise', 'Revenue today in paise (IST)', n(row?.revenue_today_minor));
      gauge('mk_notifications_pending', 'Outbox messages waiting to send', n(row?.queued_notifications));
      gauge('mk_notifications_failed', 'Outbox messages that gave up', n(row?.failed_notifications));
      gauge('mk_cash_sessions_open', 'Cash drawers currently open', n(row?.open_cash_sessions));
      gauge('mk_attendance_needs_review', 'Attendance days blocking payroll', n(row?.attendance_needs_review));
      gauge('mk_legal_documents_expired', 'Expired licences and registrations', n(row?.expired_documents));
      gauge('mk_payables_overdue_paise', 'Vendor money past its due date, in paise', n(row?.overdue_payables_minor));
      gauge('mk_tenants_active', 'Businesses on this deployment', n(row?.active_tenants));
      gauge('mk_branches_active', 'Open branches across all tenants', n(row?.active_branches));
    } catch {
      // A scrape must never fail loudly: the alert should come from mk_database_up
      // being 0, not from Prometheus recording the target as down for an unrelated reason.
      gauge('mk_database_up', 'Whether the database answered this scrape', 0);
    }

    void this.startedAt;
    return `${lines.join('\n')}\n`;
  }
}
