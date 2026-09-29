import { Injectable } from '@nestjs/common';
import { pctBp } from '@mk/shared';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { PayrollService } from '../staff/payroll.service';
import { currentTenant } from '../menu/menu.service';

const IST = 'Asia/Kolkata';

function istDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Reporting.
 *
 * Two tiers on purpose. The **Today** screen queries orders directly — at 100 orders a
 * day that is microseconds and always current, and a partner refreshing it wants the
 * truth, not last night's rollup. Everything historical reads `DailySummary`, which the
 * nightly job computes, so a month-over-month comparison is a scan of thirty small rows
 * rather than a year of order lines.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly payroll: PayrollService,
  ) {}

  /** The screen a partner opens twenty times a day. */
  async today(branchId: string) {
    return this.dayLive(branchId, istDate());
  }

  async dayLive(branchId: string, date: string) {
    return this.db.run(async (tx) => {
      const [totals] = await tx.$queryRaw<
        {
          order_count: bigint;
          guest_count: bigint | null;
          gross_minor: bigint | null;
          discount_minor: bigint | null;
          tax_minor: bigint | null;
          cogs_minor: bigint | null;
        }[]
      >`
        SELECT COUNT(*) AS order_count,
               SUM(guest_count) AS guest_count,
               SUM(total_minor) AS gross_minor,
               SUM(discount_minor) AS discount_minor,
               SUM(tax_minor) AS tax_minor,
               SUM(cost_minor) AS cogs_minor
        FROM orders
        WHERE branch_id = ${branchId}::uuid
          AND status = 'SETTLED'
          AND (settled_at AT TIME ZONE ${IST})::date = ${date}::date
      `;

      const byTender = await tx.$queryRaw<{ tender: string; amount_minor: bigint; count: bigint }[]>`
        SELECT p.tender, SUM(p.amount_minor) AS amount_minor, COUNT(*) AS count
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        WHERE o.branch_id = ${branchId}::uuid
          AND o.status = 'SETTLED'
          AND (o.settled_at AT TIME ZONE ${IST})::date = ${date}::date
          AND p.status = 'PAID'
        GROUP BY p.tender
      `;

      const bySlot = await tx.$queryRaw<{ meal_slot: string; orders: bigint; net_minor: bigint }[]>`
        SELECT meal_slot, COUNT(*) AS orders, SUM(total_minor) AS net_minor
        FROM orders
        WHERE branch_id = ${branchId}::uuid
          AND status = 'SETTLED'
          AND (settled_at AT TIME ZONE ${IST})::date = ${date}::date
        GROUP BY meal_slot
      `;

      const topItems = await tx.$queryRaw<
        { menu_item_id: string; name: string; qty: bigint; revenue_minor: bigint }[]
      >`
        SELECT oi.menu_item_id, oi.name_snapshot AS name,
               SUM(oi.qty) AS qty, SUM(oi.line_total_minor) AS revenue_minor
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.branch_id = ${branchId}::uuid
          AND o.status = 'SETTLED'
          AND NOT oi.is_voided
          AND (o.settled_at AT TIME ZONE ${IST})::date = ${date}::date
        GROUP BY oi.menu_item_id, oi.name_snapshot
        ORDER BY qty DESC
        LIMIT 10
      `;

      const wastage = await tx.$queryRaw<{ value_minor: bigint | null }[]>`
        SELECT SUM(value_minor) AS value_minor
        FROM stock_ledger_entries
        WHERE branch_id = ${branchId}::uuid
          AND reason IN ('WASTAGE','SPOILAGE','STAFF_MEAL')
          AND (occurred_at AT TIME ZONE ${IST})::date = ${date}::date
      `;

      const n = (v: bigint | null | undefined) => Number(v ?? 0);
      const orderCount = n(totals?.order_count);
      const grossMinor = n(totals?.gross_minor);
      const cogsMinor = n(totals?.cogs_minor);

      const tender = (t: string) => n(byTender.find((r) => r.tender === t)?.amount_minor);

      const dayStart = new Date(`${date}T00:00:00+05:30`);
      const dayEnd = new Date(`${date}T23:59:59+05:30`);
      const labourCostMinor = await this.payroll.staffCost(tx, branchId, dayStart, dayEnd);

      return {
        date,
        orderCount,
        guestCount: n(totals?.guest_count),
        grossSalesMinor: grossMinor,
        discountMinor: n(totals?.discount_minor),
        taxMinor: n(totals?.tax_minor),
        netSalesMinor: grossMinor - n(totals?.tax_minor),
        cogsMinor,
        wastageMinor: n(wastage[0]?.value_minor),
        labourCostMinor,
        avgTicketMinor: orderCount ? Math.round(grossMinor / orderCount) : 0,
        /** The two numbers that decide whether this business works. */
        foodCostBp: pctBp(cogsMinor, grossMinor),
        labourCostBp: pctBp(labourCostMinor, grossMinor),
        cashSalesMinor: tender('CASH'),
        upiSalesMinor: tender('UPI_MANUAL') + tender('UPI_GATEWAY'),
        cardSalesMinor: tender('CARD'),
        onlineSalesMinor: tender('UPI_GATEWAY'),
        complimentaryMinor: tender('COMPLIMENTARY'),
        byTender: byTender.map((r) => ({
          tender: r.tender,
          amountMinor: n(r.amount_minor),
          count: n(r.count),
        })),
        slotBreakdown: bySlot.map((r) => ({
          mealSlot: r.meal_slot,
          orders: n(r.orders),
          netMinor: n(r.net_minor),
        })),
        topItems: topItems.map((r) => ({
          menuItemId: r.menu_item_id,
          name: r.name,
          qty: n(r.qty),
          revenueMinor: n(r.revenue_minor),
        })),
      };
    });
  }

  /**
   * Computes and stores the rollup for one branch-day. Idempotent, so the nightly job
   * can be re-run and a corrected day can be recomputed on demand.
   */
  async rollupDay(branchId: string, date: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const live = await this.dayLive(branchId, date);
      const businessDate = new Date(`${date}T00:00:00.000Z`);

      const expenses = await tx.expense.aggregate({
        where: { branchId, incurredOn: businessDate },
        _sum: { amountMinor: true },
      });

      const data = {
        orderCount: live.orderCount,
        guestCount: live.guestCount,
        grossSalesMinor: live.grossSalesMinor,
        discountMinor: live.discountMinor,
        netSalesMinor: live.netSalesMinor,
        taxMinor: live.taxMinor,
        cogsMinor: live.cogsMinor,
        wastageMinor: live.wastageMinor,
        labourCostMinor: live.labourCostMinor,
        otherExpenseMinor: expenses._sum.amountMinor ?? 0,
        cashSalesMinor: live.cashSalesMinor,
        upiSalesMinor: live.upiSalesMinor,
        cardSalesMinor: live.cardSalesMinor,
        onlineSalesMinor: live.onlineSalesMinor,
        avgTicketMinor: live.avgTicketMinor,
        foodCostBp: live.foodCostBp,
        labourCostBp: live.labourCostBp,
        slotBreakdown: live.slotBreakdown as never,
        topItems: live.topItems as never,
        computedAt: new Date(),
      };

      return tx.dailySummary.upsert({
        where: { branchId_businessDate: { branchId, businessDate } },
        create: { tenantId, branchId, businessDate, ...data },
        update: data,
      });
    });
  }

  async series(opts: { branchId?: string; from: string; to: string; granularity: 'DAY' | 'WEEK' | 'MONTH' }) {
    return this.db.run(async (tx) => {
      const rows = await tx.dailySummary.findMany({
        where: {
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
          businessDate: { gte: new Date(`${opts.from}T00:00:00Z`), lte: new Date(`${opts.to}T00:00:00Z`) },
        },
        orderBy: { businessDate: 'asc' },
      });

      if (opts.granularity === 'DAY') return rows;

      // Bucket by ISO week or by month. Done in application code rather than SQL because
      // the row count here is at most a few hundred and readability wins.
      const buckets = new Map<string, (typeof rows)[number][]>();
      for (const row of rows) {
        const d = row.businessDate;
        const key =
          opts.granularity === 'MONTH'
            ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
            : isoWeek(d);
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }

      return [...buckets.entries()].map(([bucket, group]) => {
        const sum = (f: (r: (typeof rows)[number]) => number) => group.reduce((s, r) => s + f(r), 0);
        const gross = sum((r) => r.grossSalesMinor);
        const cogs = sum((r) => r.cogsMinor);
        const labour = sum((r) => r.labourCostMinor);
        const orders = sum((r) => r.orderCount);
        return {
          bucket,
          days: group.length,
          orderCount: orders,
          grossSalesMinor: gross,
          netSalesMinor: sum((r) => r.netSalesMinor),
          cogsMinor: cogs,
          wastageMinor: sum((r) => r.wastageMinor),
          labourCostMinor: labour,
          otherExpenseMinor: sum((r) => r.otherExpenseMinor),
          cashSalesMinor: sum((r) => r.cashSalesMinor),
          upiSalesMinor: sum((r) => r.upiSalesMinor),
          avgTicketMinor: orders ? Math.round(gross / orders) : 0,
          foodCostBp: pctBp(cogs, gross),
          labourCostBp: pctBp(labour, gross),
        };
      });
    });
  }

  /** Branch-vs-branch. Cheap because it reads one small rollup table. */
  async branchComparison(from: string, to: string) {
    return this.db.run(async (tx) => {
      const rows = await tx.dailySummary.groupBy({
        by: ['branchId'],
        where: { businessDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        _sum: {
          orderCount: true,
          grossSalesMinor: true,
          netSalesMinor: true,
          cogsMinor: true,
          labourCostMinor: true,
          wastageMinor: true,
          otherExpenseMinor: true,
        },
      });

      const branches = await tx.branch.findMany({ select: { id: true, name: true, code: true } });
      const byId = new Map(branches.map((b) => [b.id, b]));

      return rows.map((r) => {
        const gross = r._sum.grossSalesMinor ?? 0;
        const cogs = r._sum.cogsMinor ?? 0;
        const labour = r._sum.labourCostMinor ?? 0;
        const other = r._sum.otherExpenseMinor ?? 0;
        return {
          branch: byId.get(r.branchId) ?? { id: r.branchId, name: 'Unknown', code: '?' },
          orderCount: r._sum.orderCount ?? 0,
          grossSalesMinor: gross,
          netSalesMinor: r._sum.netSalesMinor ?? 0,
          cogsMinor: cogs,
          labourCostMinor: labour,
          wastageMinor: r._sum.wastageMinor ?? 0,
          otherExpenseMinor: other,
          /** Contribution before overheads not tracked per branch. */
          contributionMinor: gross - cogs - labour - other,
          foodCostBp: pctBp(cogs, gross),
          labourCostBp: pctBp(labour, gross),
        };
      });
    });
  }

  /**
   * Fixed cost ÷ contribution per thali = how many thalis a day just to stand still.
   * The number a partner should know by heart.
   */
  async breakEven(branchId: string, from: string, to: string) {
    return this.db.run(async (tx) => {
      const days = await tx.dailySummary.findMany({
        where: {
          branchId,
          businessDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
      });
      if (days.length === 0) return null;

      const fixed = await tx.expense.aggregate({
        where: {
          branchId,
          category: { isFixed: true },
          incurredOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        _sum: { amountMinor: true },
      });

      const gross = days.reduce((s, d) => s + d.grossSalesMinor, 0);
      const cogs = days.reduce((s, d) => s + d.cogsMinor, 0);
      const labour = days.reduce((s, d) => s + d.labourCostMinor, 0);
      const orders = days.reduce((s, d) => s + d.orderCount, 0);
      const fixedMinor = (fixed._sum.amountMinor ?? 0) + labour;

      const avgTicket = orders ? gross / orders : 0;
      const variableRatio = gross ? cogs / gross : 0;
      const contributionPerOrder = avgTicket * (1 - variableRatio);

      return {
        days: days.length,
        avgTicketMinor: Math.round(avgTicket),
        contributionPerOrderMinor: Math.round(contributionPerOrder),
        fixedCostMinor: fixedMinor,
        fixedCostPerDayMinor: Math.round(fixedMinor / days.length),
        breakEvenOrdersPerDay:
          contributionPerOrder > 0 ? Math.ceil(fixedMinor / days.length / contributionPerOrder) : null,
        actualOrdersPerDay: Math.round(orders / days.length),
      };
    });
  }

  /** The day-close checklist result, stored on the rollup so a day can be "locked". */
  async closeDay(branchId: string, date: string, userId: string) {
    return this.db.run(async (tx) => {
      await this.rollupDay(branchId, date);
      return tx.dailySummary.update({
        where: { branchId_businessDate: { branchId, businessDate: new Date(`${date}T00:00:00.000Z`) } },
        data: { closedByUserId: userId, closedAt: new Date() },
      });
    });
  }

  /**
   * The audit trail, filtered the way someone actually arrives at it.
   *
   * Nobody opens this screen wanting "the last 200 events". They arrive holding a
   * question — who voided that bill on Tuesday, who changed the thali price, who
   * downloaded the FSSAI licence — so the filters are a date range, an action, a branch
   * and a person, and the actor's name is joined in rather than left as a UUID that means
   * nothing to the partner reading it.
   *
   * Paged, because the alternative on a busy month is a screen that quietly stops at 200
   * rows and lets someone conclude an event never happened.
   */
  async auditTrail(opts: {
    entity?: string;
    entityId?: string;
    userId?: string;
    action?: string;
    branchId?: string;
    from?: string;
    to?: string;
    page?: number;
  }) {
    const pageSize = 50;
    const page = Math.max(1, opts.page ?? 1);

    const where = {
      ...(opts.entity ? { entity: opts.entity } : {}),
      ...(opts.entityId ? { entityId: opts.entityId } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00.000Z`) } : {}),
              // Exclusive upper bound one day on, so a range of 1st–1st contains the 1st.
              ...(opts.to
                ? { lt: new Date(new Date(`${opts.to}T00:00:00.000Z`).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
    };

    return this.db.run(async (tx) => {
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // The distinct action and entity lists drive the filter dropdowns. Derived rather
      // than hard-coded so a new audited action appears in the filter the day it ships.
      const [actions, entities] = await Promise.all([
        tx.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
        tx.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
      ]);

      return {
        total,
        page,
        pageSize,
        rows,
        actions: actions.map((a) => a.action),
        entities: entities.map((e) => e.entity),
      };
    });
  }
}

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
