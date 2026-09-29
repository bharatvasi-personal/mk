import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';
import { StockService } from './stock.service';
import { assertBranchAccess } from '../../common/auth/branch-access';

const D = Prisma.Decimal;

/**
 * Physical stock counts, and the variance they expose. This is module 4 — the part
 * that answers "is someone taking the paneer".
 */
@Injectable()
export class StockCountService {
  constructor(
    private readonly db: TenantDb,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    branchId: string;
    countedOn: string;
    scope?: string;
    notes?: string;
    lines: { inventoryItemId: string; countedQty: string; reason?: string }[];
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const actor = TenantContext.actor();
      const reference = `SC-${input.countedOn.replace(/-/g, '')}-${Date.now().toString(36).toUpperCase().slice(-4)}`;

      let varianceValueMinor = 0;
      const lineData = [];

      for (const line of input.lines) {
        // Freeze the system quantity at the moment of counting. Comparing a count taken
        // at 10 pm against a balance read at midnight would manufacture variance.
        const branchItem = await tx.branchInventoryItem.findUnique({
          where: {
            branchId_inventoryItemId: { branchId: input.branchId, inventoryItemId: line.inventoryItemId },
          },
          include: { item: { select: { avgCostMinor: true } } },
        });
        const systemQty = new D(branchItem?.onHandQty ?? 0);
        const countedQty = new D(line.countedQty);
        const varianceQty = countedQty.minus(systemQty);
        const valueMinor = Math.round(Number(varianceQty) * (branchItem?.item.avgCostMinor ?? 0));
        varianceValueMinor += valueMinor;

        lineData.push({
          tenantId,
          inventoryItemId: line.inventoryItemId,
          systemQty,
          countedQty,
          varianceQty,
          varianceValueMinor: valueMinor,
          reason: line.reason,
        });
      }

      const count = await tx.stockCount.create({
        data: {
          tenantId,
          branchId: input.branchId,
          reference,
          countedOn: new Date(input.countedOn),
          scope: input.scope,
          notes: input.notes,
          countedByUserId: actor?.userId,
          status: 'SUBMITTED',
          varianceValueMinor,
          lines: { create: lineData },
        },
        include: { lines: { include: { item: { select: { name: true, sku: true } } } } },
      });

      await this.audit.log(tx, {
        action: 'STOCK_COUNT_SUBMITTED',
        entity: 'StockCount',
        entityId: count.id,
        branchId: input.branchId,
        after: { reference, lines: lineData.length, varianceValueMinor },
      });

      return count;
    });
  }

  /**
   * Approving a count is what actually moves stock: each variance becomes a
   * COUNT_ADJUSTMENT ledger entry. Requiring approval means a helper can count without
   * being able to write off shrinkage by themselves.
   */
  async approve(stockCountId: string) {
    return this.db.run(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: stockCountId },
        include: { lines: true },
      });
      assertBranchAccess(count.branchId, 'stock:count:approve');
      if (count.status === 'APPROVED') throw new BadRequestException('This count is already approved');
      if (count.status === 'CANCELLED') throw new BadRequestException('This count was cancelled');

      for (const line of count.lines) {
        if (new D(line.varianceQty).isZero()) continue;
        await this.stock.post(
          {
            branchId: count.branchId,
            inventoryItemId: line.inventoryItemId,
            qtyDelta: line.varianceQty.toString(),
            reason: 'COUNT_ADJUSTMENT',
            stockCountId: count.id,
            note: line.reason ?? `Count ${count.reference}`,
            occurredAt: count.countedOn,
          },
          tx,
        );
        await tx.branchInventoryItem.update({
          where: {
            branchId_inventoryItemId: {
              branchId: count.branchId,
              inventoryItemId: line.inventoryItemId,
            },
          },
          data: { lastCountedAt: count.countedOn },
        });
      }

      const approved = await tx.stockCount.update({
        where: { id: stockCountId },
        data: {
          status: 'APPROVED',
          approvedByUserId: TenantContext.actor()?.userId,
          approvedAt: new Date(),
        },
      });

      await this.audit.log(tx, {
        action: 'STOCK_COUNT_APPROVED',
        entity: 'StockCount',
        entityId: stockCountId,
        branchId: count.branchId,
        after: { varianceValueMinor: count.varianceValueMinor },
      });
      return approved;
    });
  }

  /**
   * The variance report: bought vs should-have-used vs wasted vs actually counted.
   *
   * An unexplained shortfall on paneer is pilferage; on tomatoes it is probably
   * spoilage nobody logged. The report shows both and lets the manager attribute it —
   * and that attribution is itself a ledger entry, so the trail closes.
   */
  async varianceReport(branchId: string, from: string, to: string) {
    return this.db.run(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          inventory_item_id: string;
          name: string;
          sku: string;
          uom: string;
          avg_cost_minor: number;
          opening_qty: Prisma.Decimal;
          purchased_qty: Prisma.Decimal;
          consumed_qty: Prisma.Decimal;
          declared_waste_qty: Prisma.Decimal;
          adjusted_qty: Prisma.Decimal;
          closing_qty: Prisma.Decimal;
          counted_qty: Prisma.Decimal | null;
        }[]
      >`
        WITH movements AS (
          SELECT
            l.inventory_item_id,
            SUM(CASE WHEN l.occurred_at < ${from}::date THEN l.qty_delta ELSE 0 END) AS opening_qty,
            SUM(CASE WHEN l.occurred_at >= ${from}::date AND l.occurred_at < (${to}::date + 1)
                     AND l.reason = 'PURCHASE_RECEIPT' THEN l.qty_delta ELSE 0 END) AS purchased_qty,
            SUM(CASE WHEN l.occurred_at >= ${from}::date AND l.occurred_at < (${to}::date + 1)
                     AND l.reason = 'SALE_CONSUMPTION' THEN -l.qty_delta ELSE 0 END) AS consumed_qty,
            SUM(CASE WHEN l.occurred_at >= ${from}::date AND l.occurred_at < (${to}::date + 1)
                     AND l.reason IN ('WASTAGE','SPOILAGE','STAFF_MEAL') THEN -l.qty_delta ELSE 0 END) AS declared_waste_qty,
            SUM(CASE WHEN l.occurred_at >= ${from}::date AND l.occurred_at < (${to}::date + 1)
                     AND l.reason = 'COUNT_ADJUSTMENT' THEN l.qty_delta ELSE 0 END) AS adjusted_qty,
            SUM(CASE WHEN l.occurred_at < (${to}::date + 1) THEN l.qty_delta ELSE 0 END) AS closing_qty
          FROM stock_ledger_entries l
          WHERE l.branch_id = ${branchId}::uuid
          GROUP BY l.inventory_item_id
        ),
        latest_count AS (
          SELECT DISTINCT ON (scl.inventory_item_id)
                 scl.inventory_item_id, scl.counted_qty
          FROM stock_count_lines scl
          JOIN stock_counts sc ON sc.id = scl.stock_count_id
          WHERE sc.branch_id = ${branchId}::uuid
            AND sc.status = 'APPROVED'
            AND sc.counted_on <= ${to}::date
          ORDER BY scl.inventory_item_id, sc.counted_on DESC
        )
        SELECT i.id AS inventory_item_id, i.name, i.sku, u.code AS uom, i.avg_cost_minor,
               COALESCE(m.opening_qty,0) AS opening_qty,
               COALESCE(m.purchased_qty,0) AS purchased_qty,
               COALESCE(m.consumed_qty,0) AS consumed_qty,
               COALESCE(m.declared_waste_qty,0) AS declared_waste_qty,
               COALESCE(m.adjusted_qty,0) AS adjusted_qty,
               COALESCE(m.closing_qty,0) AS closing_qty,
               lc.counted_qty
        FROM inventory_items i
        JOIN uoms u ON u.id = i.uom_id
        LEFT JOIN movements m ON m.inventory_item_id = i.id
        LEFT JOIN latest_count lc ON lc.inventory_item_id = i.id
        WHERE i.is_active AND i.is_tracked
        ORDER BY i.category, i.name
      `;

      return rows
        .map((r) => {
          const unexplained = r.counted_qty === null ? null : Number(r.counted_qty) - Number(r.closing_qty);
          return {
            inventoryItemId: r.inventory_item_id,
            name: r.name,
            sku: r.sku,
            uom: r.uom,
            openingQty: Number(r.opening_qty),
            purchasedQty: Number(r.purchased_qty),
            consumedQty: Number(r.consumed_qty),
            declaredWasteQty: Number(r.declared_waste_qty),
            adjustedQty: Number(r.adjusted_qty),
            expectedClosingQty: Number(r.closing_qty),
            countedQty: r.counted_qty === null ? null : Number(r.counted_qty),
            unexplainedQty: unexplained,
            unexplainedValueMinor: unexplained === null ? null : Math.round(unexplained * r.avg_cost_minor),
            /** Worth a conversation: more than 5% of what went through unaccounted for. */
            flagged:
              unexplained !== null &&
              Math.abs(unexplained) > 0.001 &&
              Math.abs(unexplained) / Math.max(1, Number(r.purchased_qty) + Number(r.opening_qty)) > 0.05,
          };
        })
        .filter((r) => r.purchasedQty !== 0 || r.consumedQty !== 0 || r.countedQty !== null);
    });
  }

  async list(branchId: string) {
    return this.db.run((tx) =>
      tx.stockCount.findMany({
        where: { branchId },
        include: { _count: { select: { lines: true } } },
        orderBy: { countedOn: 'desc' },
        take: 50,
      }),
    );
  }
}
