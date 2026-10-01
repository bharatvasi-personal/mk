import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  SubscriptionInput,
  SubscriptionPaidInput,
  SubscriptionSkipInput,
  SubscriptionStatusInput,
} from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { assertBranchAccess } from '../../common/auth/branch-access';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';

/**
 * Weekly and monthly meal plans.
 *
 * The website already sells these and, until now, every enquiry was tracked by hand in a
 * WhatsApp thread. This records the plan, manages its lifecycle — pause, skip a festival,
 * cancel, mark paid — and turns the set of active plans into a daily delivery list the
 * kitchen can pack against.
 *
 * Online recurring payment is deliberately not here yet: it belongs with the UPI gateway
 * and delivery in the next phase. Collection stays manual, tracked with `isPaid`, so the
 * partners can at least see who has paid without the platform pretending to bill anyone.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list(opts: { branchId?: string; status?: string } = {}) {
    return this.db.run((tx) =>
      tx.subscription.findMany({
        where: {
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
          ...(opts.status ? { status: opts.status } : {}),
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  get(id: string) {
    return this.db.run((tx) => tx.subscription.findUniqueOrThrow({ where: { id } }));
  }

  async create(input: SubscriptionInput) {
    assertBranchAccess(input.branchId, 'subscription:write');
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);

      // Link to a customer record by phone when one exists, so a subscriber's plans and
      // their walk-in orders eventually hang off the same person. Never created here —
      // that is the ordering flow's job; a plan just points at one if it is already there.
      const customer =
        input.customerId ??
        (
          await tx.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone: normalisePhone(input.customerPhone) } },
            select: { id: true },
          })
        )?.id;

      const sub = await tx.subscription.create({
        data: {
          tenantId,
          branchId: input.branchId,
          customerId: customer ?? null,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          addressLine: input.addressLine,
          area: input.area,
          plan: input.plan,
          diet: input.diet,
          shift: input.shift,
          daysOfWeek: input.daysOfWeek,
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          amountMinor: input.amountMinor,
          pricePerMealMinor: input.pricePerMealMinor,
          notes: input.notes,
          createdByUserId: TenantContext.actor()?.userId,
        },
      });

      await this.audit.log(tx, {
        action: 'SUBSCRIPTION_CREATED',
        entity: 'Subscription',
        entityId: sub.id,
        branchId: input.branchId,
        after: { plan: sub.plan, shift: sub.shift, amountMinor: sub.amountMinor },
      });
      return sub;
    });
  }

  async update(id: string, input: SubscriptionInput) {
    return this.db.run(async (tx) => {
      const before = await tx.subscription.findUniqueOrThrow({ where: { id } });
      assertBranchAccess(before.branchId, 'subscription:write');

      const sub = await tx.subscription.update({
        where: { id },
        data: {
          branchId: input.branchId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          addressLine: input.addressLine,
          area: input.area,
          plan: input.plan,
          diet: input.diet,
          shift: input.shift,
          daysOfWeek: input.daysOfWeek,
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          amountMinor: input.amountMinor,
          pricePerMealMinor: input.pricePerMealMinor,
          notes: input.notes,
        },
      });
      await this.audit.log(tx, { action: 'UPDATE', entity: 'Subscription', entityId: id, before, after: sub });
      return sub;
    });
  }

  async setStatus(id: string, input: SubscriptionStatusInput) {
    return this.db.run(async (tx) => {
      const before = await tx.subscription.findUniqueOrThrow({ where: { id } });
      assertBranchAccess(before.branchId, 'subscription:write');

      const sub = await tx.subscription.update({
        where: { id },
        data: {
          status: input.status,
          // Clear the window unless the plan is being paused.
          pausedFrom: input.status === 'PAUSED' && input.pausedFrom ? new Date(input.pausedFrom) : null,
          pausedTo: input.status === 'PAUSED' && input.pausedTo ? new Date(input.pausedTo) : null,
        },
      });
      await this.audit.log(tx, {
        action: `SUBSCRIPTION_${input.status}`,
        entity: 'Subscription',
        entityId: id,
        branchId: before.branchId,
        after: { status: input.status, pausedFrom: input.pausedFrom, pausedTo: input.pausedTo },
      });
      return sub;
    });
  }

  async setSkips(id: string, input: SubscriptionSkipInput) {
    return this.db.run(async (tx) => {
      const before = await tx.subscription.findUniqueOrThrow({ where: { id } });
      assertBranchAccess(before.branchId, 'subscription:write');
      const sub = await tx.subscription.update({
        where: { id },
        data: { skipDates: [...new Set(input.dates)].sort() },
      });
      await this.audit.log(tx, {
        action: 'SUBSCRIPTION_SKIP',
        entity: 'Subscription',
        entityId: id,
        branchId: before.branchId,
        after: { skipDates: sub.skipDates },
      });
      return sub;
    });
  }

  async setPaid(id: string, input: SubscriptionPaidInput) {
    return this.db.run(async (tx) => {
      const before = await tx.subscription.findUniqueOrThrow({ where: { id } });
      assertBranchAccess(before.branchId, 'subscription:write');
      const sub = await tx.subscription.update({
        where: { id },
        data: {
          isPaid: input.isPaid,
          paidOn: input.isPaid ? new Date(input.paidOn ?? new Date().toISOString().slice(0, 10)) : null,
        },
      });
      await this.audit.log(tx, {
        action: 'SUBSCRIPTION_PAID',
        entity: 'Subscription',
        entityId: id,
        branchId: before.branchId,
        after: { isPaid: sub.isPaid, paidOn: sub.paidOn },
      });
      return sub;
    });
  }

  /**
   * The day's delivery list.
   *
   * This is what the kitchen packs against: every active plan that is due on `date` for
   * the requested shift, once the day-of-week, the pause window and any one-off skips have
   * been applied. Returned grouped by shift and diet so the kitchen can count how many veg
   * and non-veg boxes to make before reading a single name.
   */
  async due(branchId: string, date: string, shift?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Expected a date as YYYY-MM-DD');
    const day = new Date(`${date}T00:00:00.000Z`);
    const weekday = day.getUTCDay();

    return this.db.run(async (tx) => {
      const subs = await tx.subscription.findMany({
        where: {
          branchId,
          status: 'ACTIVE',
          startDate: { lte: day },
          OR: [{ endDate: null }, { endDate: { gte: day } }],
        },
        orderBy: { customerName: 'asc' },
      });

      const due = subs.filter((s) => {
        if (!s.daysOfWeek.includes(weekday)) return false;
        if (s.skipDates.includes(date)) return false;
        if (s.pausedFrom && s.pausedTo && day >= s.pausedFrom && day <= s.pausedTo) return false;
        if (shift && shift !== 'BOTH' && s.shift !== 'BOTH' && s.shift !== shift) return false;
        return true;
      });

      const meals = (s: (typeof due)[number]) =>
        shift && shift !== 'BOTH' ? 1 : s.shift === 'BOTH' ? 2 : 1;

      return {
        date,
        weekday,
        total: due.length,
        veg: due.filter((s) => s.diet === 'VEG').length,
        nonVeg: due.filter((s) => s.diet === 'NON_VEG').length,
        mixed: due.filter((s) => s.diet === 'MIXED').length,
        mealCount: due.reduce((n, s) => n + meals(s), 0),
        rows: due.map((s) => ({
          id: s.id,
          customerName: s.customerName,
          customerPhone: s.customerPhone,
          addressLine: s.addressLine,
          area: s.area,
          diet: s.diet,
          shift: s.shift,
          plan: s.plan,
          isPaid: s.isPaid,
        })),
      };
    });
  }
}

/** Store phones without the +91 so the customer lookup matches the ordering flow. */
function normalisePhone(phone: string): string {
  return phone.replace(/^\+91/, '');
}
