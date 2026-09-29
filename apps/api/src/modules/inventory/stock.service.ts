import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type StockMovementReason } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';

const D = Prisma.Decimal;

export interface MovementInput {
  branchId: string;
  inventoryItemId: string;
  /** Signed. Negative consumes. */
  qtyDelta: string | number;
  reason: StockMovementReason;
  unitCostMinor?: number;
  note?: string;
  occurredAt?: Date;
  orderId?: string;
  goodsReceiptId?: string;
  stockCountId?: string;
}

/**
 * The stock ledger.
 *
 * Everything that changes stock goes through `post()`. The ledger is append-only and
 * is the single source of truth; `branch_inventory_items.on_hand_qty` is a cache
 * updated in the same transaction. A mutable stock counter without a ledger is how
 * inventory systems end up quietly wrong, and quietly wrong inventory gets abandoned.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async post(input: MovementInput, tx?: Tx) {
    return this.db.run(async (t) => this.postInTx(t, input), { tx });
  }

  async postMany(inputs: MovementInput[], tx?: Tx) {
    return this.db.run(async (t) => {
      const out = [];
      for (const input of inputs) out.push(await this.postInTx(t, input));
      return out;
    }, { tx });
  }

  private async postInTx(tx: Tx, input: MovementInput) {
    const tenantId = await currentTenant(tx);
    const delta = new D(input.qtyDelta);
    if (delta.isZero()) throw new BadRequestException('A stock movement of zero is not a movement');

    // Lock the branch stock row so two concurrent movements cannot both read the same
    // balance. At 100 orders/day contention is rare, but a wrong balance is permanent.
    const [locked] = await tx.$queryRaw<{ on_hand_qty: Prisma.Decimal }[]>`
      SELECT on_hand_qty FROM branch_inventory_items
      WHERE branch_id = ${input.branchId}::uuid AND inventory_item_id = ${input.inventoryItemId}::uuid
      FOR UPDATE
    `;

    let opening = locked ? new D(locked.on_hand_qty) : new D(0);
    if (!locked) {
      // First movement for this item at this branch — create the policy row with
      // zero-ish defaults so the manager can fill in reorder points later.
      await tx.branchInventoryItem.create({
        data: { tenantId, branchId: input.branchId, inventoryItemId: input.inventoryItemId, onHandQty: 0 },
      });
      opening = new D(0);
    }

    const item = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: input.inventoryItemId },
      select: { avgCostMinor: true, name: true },
    });

    const unitCostMinor = input.unitCostMinor ?? item.avgCostMinor;
    const balanceAfter = opening.plus(delta);

    const entry = await tx.stockLedgerEntry.create({
      data: {
        tenantId,
        branchId: input.branchId,
        inventoryItemId: input.inventoryItemId,
        qtyDelta: delta,
        unitCostMinor,
        valueMinor: Math.round(Number(delta.abs()) * unitCostMinor),
        reason: input.reason,
        balanceAfterQty: balanceAfter,
        note: input.note,
        occurredAt: input.occurredAt ?? new Date(),
        orderId: input.orderId,
        goodsReceiptId: input.goodsReceiptId,
        stockCountId: input.stockCountId,
      },
    });

    await tx.branchInventoryItem.update({
      where: { branchId_inventoryItemId: { branchId: input.branchId, inventoryItemId: input.inventoryItemId } },
      data: { onHandQty: balanceAfter },
    });

    // Wastage and shrinkage are money leaving the business, so they are audited like
    // money. Sale consumption is not — it would be one audit row per thali.
    if (['WASTAGE', 'SPOILAGE', 'COUNT_ADJUSTMENT', 'STAFF_MEAL'].includes(input.reason)) {
      await this.audit.log(tx, {
        action: `STOCK_${input.reason}`,
        entity: 'StockLedgerEntry',
        entityId: entry.id,
        branchId: input.branchId,
        after: {
          item: item.name,
          qtyDelta: delta.toString(),
          valueMinor: entry.valueMinor,
          note: input.note,
        },
      });
    }

    return entry;
  }

  /**
   * Weighted-average cost, recomputed on receipt.
   *
   * FIFO on loose vegetables bought by the crate from a mandi is theatre — the crates
   * are not separable and nobody is going to track lots of coriander. Weighted average
   * is honest and accurate enough to manage a 30% food-cost target.
   */
  async applyReceiptCost(
    tx: Tx,
    inventoryItemId: string,
    receivedQty: Prisma.Decimal | string | number,
    unitCostMinor: number,
  ): Promise<void> {
    const item = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: inventoryItemId },
      select: { avgCostMinor: true },
    });
    const totals = await tx.branchInventoryItem.aggregate({
      where: { inventoryItemId },
      _sum: { onHandQty: true },
    });

    const existingQty = new D(totals._sum.onHandQty ?? 0);
    const incomingQty = new D(receivedQty);
    const totalQty = existingQty.plus(incomingQty);

    const newAvg = totalQty.lte(0)
      ? unitCostMinor
      : Math.round(
          (Number(existingQty) * item.avgCostMinor + Number(incomingQty) * unitCostMinor) /
            Number(totalQty),
        );

    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { avgCostMinor: newAvg, lastPurchaseCostMinor: unitCostMinor },
    });
  }

  /** Reconciles the on-hand cache against the ledger. Run nightly; should be a no-op. */
  async reconcileCache(branchId: string) {
    return this.db.run(async (tx) => {
      const repaired = await tx.$executeRaw`
        UPDATE branch_inventory_items b
        SET on_hand_qty = COALESCE(l.total, 0)
        FROM (
          SELECT inventory_item_id, SUM(qty_delta) AS total
          FROM stock_ledger_entries
          WHERE branch_id = ${branchId}::uuid
          GROUP BY inventory_item_id
        ) l
        WHERE b.branch_id = ${branchId}::uuid
          AND b.inventory_item_id = l.inventory_item_id
          AND b.on_hand_qty <> COALESCE(l.total, 0)
      `;
      return { repairedRows: repaired };
    });
  }
}
