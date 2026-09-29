import { Injectable } from '@nestjs/common';
import { Prisma, type BuyingRhythm, type InventoryCategory } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';

const D = Prisma.Decimal;

export interface InventoryItemInput {
  sku: string;
  name: string;
  nameI18n: Record<string, string>;
  category: InventoryCategory;
  uomId: string;
  buyingRhythm: BuyingRhythm;
  shelfLifeDays?: number;
  isTracked: boolean;
  isActive: boolean;
  notes?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async listUoms() {
    return this.db.run((tx) => tx.uom.findMany({ orderBy: { code: 'asc' } }));
  }

  async listItems(opts: { category?: InventoryCategory; search?: string; branchId?: string } = {}) {
    return this.db.run((tx) =>
      tx.inventoryItem.findMany({
        where: {
          isActive: true,
          ...(opts.category ? { category: opts.category } : {}),
          ...(opts.search ? { OR: [{ name: { contains: opts.search, mode: 'insensitive' } }, { sku: { contains: opts.search, mode: 'insensitive' } }] } : {}),
        },
        include: {
          uom: { select: { code: true, name: true } },
          branchItems: opts.branchId ? { where: { branchId: opts.branchId } } : false,
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  async upsertItem(input: InventoryItemInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      if (id) {
        const before = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
        const after = await tx.inventoryItem.update({ where: { id }, data: input });
        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'InventoryItem',
          entityId: id,
          ...diff(before as never, after as never),
        });
        return after;
      }
      const created = await tx.inventoryItem.create({ data: { ...input, tenantId } });
      await this.audit.log(tx, { action: 'CREATE', entity: 'InventoryItem', entityId: created.id, after: created });
      return created;
    });
  }

  async setBranchPolicy(input: {
    branchId: string;
    inventoryItemId: string;
    reorderPointQty: string;
    parLevelQty: string;
    preferredVendorId?: string;
    storageLocation?: string;
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      return tx.branchInventoryItem.upsert({
        where: {
          branchId_inventoryItemId: {
            branchId: input.branchId,
            inventoryItemId: input.inventoryItemId,
          },
        },
        create: {
          tenantId,
          branchId: input.branchId,
          inventoryItemId: input.inventoryItemId,
          reorderPointQty: new D(input.reorderPointQty),
          parLevelQty: new D(input.parLevelQty),
          preferredVendorId: input.preferredVendorId,
          storageLocation: input.storageLocation,
        },
        update: {
          reorderPointQty: new D(input.reorderPointQty),
          parLevelQty: new D(input.parLevelQty),
          preferredVendorId: input.preferredVendorId ?? null,
          storageLocation: input.storageLocation ?? null,
        },
      });
    });
  }

  async stockOnHand(branchId: string, opts: { lowOnly?: boolean; category?: InventoryCategory } = {}) {
    return this.db.run(async (tx) => {
      const rows = await tx.branchInventoryItem.findMany({
        where: {
          branchId,
          item: { isActive: true, isTracked: true, ...(opts.category ? { category: opts.category } : {}) },
        },
        include: {
          item: {
            select: {
              id: true,
              sku: true,
              name: true,
              category: true,
              buyingRhythm: true,
              avgCostMinor: true,
              shelfLifeDays: true,
              uom: { select: { code: true } },
            },
          },
          preferredVendor: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { item: { name: 'asc' } },
      });

      const mapped = rows.map((r) => {
        const onHand = new D(r.onHandQty);
        const reorder = new D(r.reorderPointQty);
        return {
          inventoryItemId: r.item.id,
          sku: r.item.sku,
          name: r.item.name,
          category: r.item.category,
          buyingRhythm: r.item.buyingRhythm,
          uom: r.item.uom.code,
          onHandQty: onHand.toString(),
          reorderPointQty: reorder.toString(),
          parLevelQty: new D(r.parLevelQty).toString(),
          valueMinor: Math.round(Number(onHand) * r.item.avgCostMinor),
          avgCostMinor: r.item.avgCostMinor,
          preferredVendor: r.preferredVendor,
          storageLocation: r.storageLocation,
          lastCountedAt: r.lastCountedAt,
          isLow: onHand.lte(reorder),
          isOut: onHand.lte(0),
        };
      });

      return opts.lowOnly ? mapped.filter((m) => m.isLow) : mapped;
    });
  }

  /**
   * "What do I buy today", grouped by vendor.
   *
   * A kitchen does not have one purchasing workflow. Vegetables are a 6 am phone screen
   * at the mandi; spices are a monthly PO to a distributor. Filtering by buying rhythm
   * is what makes this list short enough to actually be used — a list of 80 items gets
   * ignored, a list of 9 vegetables gets acted on.
   */
  async purchaseWorklist(branchId: string, rhythms?: BuyingRhythm[]) {
    const low = await this.stockOnHand(branchId, { lowOnly: true });
    const filtered = rhythms?.length ? low.filter((l) => rhythms.includes(l.buyingRhythm)) : low;

    const groups = new Map<
      string,
      { vendorId: string | null; vendorName: string; vendorPhone: string | null; items: typeof filtered; estimatedMinor: number }
    >();

    for (const row of filtered) {
      const key = row.preferredVendor?.id ?? 'unassigned';
      const group =
        groups.get(key) ??
        {
          vendorId: row.preferredVendor?.id ?? null,
          vendorName: row.preferredVendor?.name ?? 'No preferred vendor',
          vendorPhone: row.preferredVendor?.phone ?? null,
          items: [] as typeof filtered,
          estimatedMinor: 0,
        };
      // Suggest topping up to the par level, not just to the reorder point — buying the
      // minimum means buying again tomorrow.
      const suggestQty = Math.max(0, Number(row.parLevelQty) - Number(row.onHandQty));
      group.items.push({ ...row, suggestQty: suggestQty.toFixed(4) } as never);
      group.estimatedMinor += Math.round(suggestQty * row.avgCostMinor);
      groups.set(key, group);
    }

    return [...groups.values()].sort((a, b) => b.estimatedMinor - a.estimatedMinor);
  }

  async ledger(branchId: string, opts: { inventoryItemId?: string; from?: Date; to?: Date; limit?: number }) {
    return this.db.run((tx) =>
      tx.stockLedgerEntry.findMany({
        where: {
          branchId,
          ...(opts.inventoryItemId ? { inventoryItemId: opts.inventoryItemId } : {}),
          ...(opts.from || opts.to
            ? { occurredAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
            : {}),
        },
        include: { item: { select: { name: true, sku: true, uom: { select: { code: true } } } } },
        orderBy: { occurredAt: 'desc' },
        take: opts.limit ?? 200,
      }),
    );
  }
}
