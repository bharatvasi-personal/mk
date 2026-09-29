import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';
import { assertBranchAccess } from '../../common/auth/branch-access';

/**
 * The cash drawer shift, and the Z-report.
 *
 * This is the control that actually catches till errors and pilferage: the system
 * knows what cash *should* be in the drawer, the person closing counts what *is*, and
 * the difference is recorded with a name against it. Without this, cash sales are an
 * honour system.
 */
@Injectable()
export class CashSessionService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async open(branchId: string, openingFloatMinor: number) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const existing = await tx.cashSession.findFirst({ where: { branchId, closedAt: null } });
      if (existing) {
        throw new BadRequestException(
          'A drawer is already open at this branch. Close it before opening another.',
        );
      }
      const session = await tx.cashSession.create({
        data: {
          tenantId,
          branchId,
          openedByUserId: TenantContext.actor()!.userId,
          openingFloatMinor,
        },
      });
      await this.audit.log(tx, {
        action: 'CASH_SESSION_OPENED',
        entity: 'CashSession',
        entityId: session.id,
        branchId,
        after: { openingFloatMinor },
      });
      return session;
    });
  }

  async current(branchId: string) {
    return this.db.run(async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: { branchId, closedAt: null },
        orderBy: { openedAt: 'desc' },
      });
      if (!session) return null;
      return { ...session, ...(await this.tally(tx, session.id, session.openingFloatMinor)) };
    });
  }

  /**
   * Close the drawer. The variance is stored, never hidden and never auto-corrected:
   * a ₹40 shortfall on a ₹9,000 day is a miscount, and a ₹40 shortfall every day is a
   * pattern. Only the record makes the difference visible.
   */
  async close(input: {
    cashSessionId: string;
    countedCashMinor: number;
    denominationCount?: Record<string, number>;
    notes?: string;
  }) {
    return this.db.run(async (tx) => {
      const session = await tx.cashSession.findUniqueOrThrow({ where: { id: input.cashSessionId } });
      assertBranchAccess(session.branchId, 'cash_session:manage');
      if (session.closedAt) throw new BadRequestException('This drawer is already closed');

      const tally = await this.tally(tx, session.id, session.openingFloatMinor);

      if (input.denominationCount) {
        const fromDenoms = Object.entries(input.denominationCount).reduce(
          (sum, [note, count]) => sum + Number(note) * 100 * count,
          0,
        );
        if (fromDenoms !== input.countedCashMinor) {
          throw new BadRequestException(
            `The notes counted add up to ₹${(fromDenoms / 100).toFixed(2)} but you entered ` +
              `₹${(input.countedCashMinor / 100).toFixed(2)} — recount before closing`,
          );
        }
      }

      const varianceMinor = input.countedCashMinor - tally.expectedCashMinor;

      const closed = await tx.cashSession.update({
        where: { id: session.id },
        data: {
          closedByUserId: TenantContext.actor()!.userId,
          closedAt: new Date(),
          expectedCashMinor: tally.expectedCashMinor,
          countedCashMinor: input.countedCashMinor,
          varianceMinor,
          denominationCount: input.denominationCount as never,
          notes: input.notes,
        },
      });

      await this.audit.log(tx, {
        action: 'CASH_SESSION_CLOSED',
        entity: 'CashSession',
        entityId: session.id,
        branchId: session.branchId,
        after: {
          expectedCashMinor: tally.expectedCashMinor,
          countedCashMinor: input.countedCashMinor,
          varianceMinor,
        },
      });

      return { ...closed, zReport: { ...tally, countedCashMinor: input.countedCashMinor, varianceMinor } };
    });
  }

  async list(branchId: string) {
    return this.db.run((tx) =>
      tx.cashSession.findMany({ where: { branchId }, orderBy: { openedAt: 'desc' }, take: 30 }),
    );
  }

  /** The Z-report body: sales by tender for this drawer shift. */
  private async tally(
    tx: Parameters<Parameters<TenantDb['run']>[0]>[0],
    cashSessionId: string,
    openingFloatMinor: number,
  ) {
    const byTender = await tx.payment.groupBy({
      by: ['tender'],
      where: { order: { cashSessionId, status: 'SETTLED' } },
      _sum: { amountMinor: true },
      _count: true,
    });

    const sum = (tender: string) =>
      byTender.find((r) => r.tender === tender)?._sum.amountMinor ?? 0;

    const orders = await tx.order.aggregate({
      where: { cashSessionId, status: 'SETTLED' },
      _count: true,
      _sum: { totalMinor: true, discountMinor: true, costMinor: true },
    });

    const cashSalesMinor = sum('CASH');

    return {
      orderCount: orders._count,
      grossSalesMinor: orders._sum.totalMinor ?? 0,
      discountMinor: orders._sum.discountMinor ?? 0,
      cogsMinor: orders._sum.costMinor ?? 0,
      cashSalesMinor,
      upiSalesMinor: sum('UPI_MANUAL') + sum('UPI_GATEWAY'),
      cardSalesMinor: sum('CARD'),
      complimentaryMinor: sum('COMPLIMENTARY'),
      openingFloatMinor,
      /** What should physically be in the drawer right now. */
      expectedCashMinor: openingFloatMinor + cashSalesMinor,
      byTender: byTender.map((r) => ({
        tender: r.tender,
        amountMinor: r._sum.amountMinor ?? 0,
        count: r._count,
      })),
    };
  }
}
