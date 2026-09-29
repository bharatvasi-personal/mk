import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RecipeInput } from '@mk/shared';
import { IncompatibleUomError, convertQty, type UomDef } from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';
import { StockService } from './stock.service';

const D = Prisma.Decimal;

export interface ConsumptionLine {
  inventoryItemId: string;
  qty: Prisma.Decimal;
  costMinor: number;
}

/**
 * Recipes do two jobs: deplete stock automatically when something is sold, and give a
 * live per-dish cost so the food-cost percentage is a measured number rather than a
 * guess at month end.
 */
@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async upsert(input: RecipeInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const active = await tx.recipe.findFirst({
        where: { menuItemId: input.menuItemId, variantId: input.variantId, isActive: true },
        orderBy: { version: 'desc' },
      });

      // The next version number comes from the highest version that has EVER existed for
      // this dish, not from the currently active one. Those differ the moment a recipe is
      // deactivated without a replacement — and numbering from the active row then
      // reuses a version that already exists, which the unique constraint rejects.
      const latest = await tx.recipe.findFirst({
        where: { menuItemId: input.menuItemId, variantId: input.variantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      // A new version rather than an edit. Changing a recipe must not retroactively
      // change the cost of thalis already sold.
      if (active) {
        await tx.recipe.update({ where: { id: active.id }, data: { isActive: false } });
      }

      // Validate units before writing anything. Refusing a bad recipe at save time is
      // the difference between "you cannot enter that" and three weeks of quietly wrong
      // stock that only surfaces when someone counts.
      await this.assertUnitsConvertible(tx, input.lines);

      const created = await tx.recipe.create({
        data: {
          tenantId,
          menuItemId: input.menuItemId,
          variantId: input.variantId,
          yieldQty: new D(input.yieldQty),
          notes: input.notes,
          version: (latest?.version ?? 0) + 1,
          lines: {
            create: input.lines.map((l) => ({
              tenantId,
              inventoryItemId: l.inventoryItemId,
              qty: new D(l.qty),
              uomId: l.uomId,
              wastagePct: l.wastagePct,
              isOptional: l.isOptional,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.log(tx, {
        action: 'RECIPE_VERSION',
        entity: 'Recipe',
        entityId: created.id,
        after: { menuItemId: input.menuItemId, version: created.version, lines: input.lines.length },
      });
      return created;
    });
  }

  async get(menuItemId: string, variantId: string | null) {
    return this.db.run((tx) =>
      tx.recipe.findFirst({
        where: { menuItemId, variantId, isActive: true },
        include: {
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true, avgCostMinor: true } },
              uom: { select: { id: true, code: true } },
            },
          },
        },
        orderBy: { version: 'desc' },
      }),
    );
  }

  /**
   * Cost of one serving at today's weighted-average ingredient cost, including the
   * per-line wastage allowance (peeling, trimming, cooking loss).
   */
  async costPerServing(tx: Tx, menuItemId: string, variantId: string | null): Promise<number> {
    const recipe = await this.findRecipe(tx, menuItemId, variantId);
    if (!recipe) return 0;
    let total = 0;
    for (const line of recipe.lines) {
      // avgCostMinor is per *stock* unit, so the recipe quantity has to be expressed in
      // that unit before it is multiplied by a cost.
      const stockQty = this.toStockQty(line);
      if (stockQty === null) continue;
      total += Number(stockQty) * (1 + line.wastagePct / 100) * line.item.avgCostMinor;
    }
    return Math.round(total / Number(recipe.yieldQty));
  }

  /** Food cost % in basis points against a selling price, for the margin alert. */
  async foodCostBp(menuItemId: string, variantId: string | null, priceMinor: number): Promise<number> {
    if (priceMinor <= 0) return 0;
    const cost = await this.db.run((tx) => this.costPerServing(tx, menuItemId, variantId));
    return Math.round((cost / priceMinor) * 10_000);
  }

  /**
   * Depletes stock for a settled order and returns the cost of goods sold.
   *
   * Runs inside the settle transaction: if stock depletion fails, the bill does not
   * settle. That is deliberate — a bill without its consumption silently corrupts both
   * the stock position and the food-cost number, and the corruption is invisible until
   * someone counts.
   *
   * Items with no recipe simply cost nothing and consume nothing. That is honest: an
   * un-costed item shows up in the reports as a gap to fill, not as a wrong number.
   */
  async consumeForOrder(tx: Tx, orderId: string): Promise<{ costMinor: number; lines: ConsumptionLine[] }> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        branchId: true,
        items: {
          where: { isVoided: false },
          select: { id: true, menuItemId: true, variantId: true, qty: true },
        },
      },
    });

    // Aggregate across lines first — three thalis on one bill should be one ledger
    // entry per ingredient, not three.
    const required = new Map<string, Prisma.Decimal>();
    const perLineCost = new Map<string, number>();

    for (const line of order.items) {
      const recipe =
        (await this.findRecipe(tx, line.menuItemId, line.variantId)) ??
        (await this.findRecipe(tx, line.menuItemId, null));
      if (!recipe) {
        perLineCost.set(line.id, 0);
        continue;
      }
      const servings = new D(line.qty).div(recipe.yieldQty);
      let lineCost = 0;
      for (const rl of recipe.lines) {
        const stockQty = this.toStockQty(rl);
        if (stockQty === null) continue;
        const qty = new D(stockQty).times(1 + rl.wastagePct / 100).times(servings);
        required.set(rl.inventoryItemId, (required.get(rl.inventoryItemId) ?? new D(0)).plus(qty));
        lineCost += Number(qty) * rl.item.avgCostMinor;
      }
      perLineCost.set(line.id, Math.round(lineCost));
    }

    let costMinor = 0;
    const lines: ConsumptionLine[] = [];
    for (const [inventoryItemId, qty] of required) {
      const entry = await this.stock.post(
        {
          branchId: order.branchId,
          inventoryItemId,
          qtyDelta: qty.negated().toString(),
          reason: 'SALE_CONSUMPTION',
          orderId,
        },
        tx,
      );
      costMinor += entry.valueMinor;
      lines.push({ inventoryItemId, qty, costMinor: entry.valueMinor });
    }

    // Write the per-line cost back so a historical bill can report its own margin.
    for (const [orderItemId, lineCostMinor] of perLineCost) {
      await tx.orderItem.update({ where: { id: orderItemId }, data: { lineCostMinor } });
    }

    return { costMinor, lines };
  }

  /** Which dishes are unpriced or over their target food cost — the margin worklist. */
  async marginReport(branchId: string) {
    return this.db.run(async (tx) => {
      const priced = await tx.branchMenuItem.findMany({
        where: { branchId, isAvailable: true },
        select: {
          priceMinor: true,
          mealSlot: true,
          variantId: true,
          menuItem: { select: { id: true, name: true, targetFoodCostPct: true } },
        },
      });

      const out = [];
      for (const row of priced) {
        const costMinor = await this.costPerServing(tx, row.menuItem.id, row.variantId);
        const bp = row.priceMinor > 0 ? Math.round((costMinor / row.priceMinor) * 10_000) : 0;
        const targetBp = (row.menuItem.targetFoodCostPct ?? 35) * 100;
        out.push({
          menuItemId: row.menuItem.id,
          name: row.menuItem.name,
          mealSlot: row.mealSlot,
          priceMinor: row.priceMinor,
          costMinor,
          foodCostBp: bp,
          targetBp,
          hasRecipe: costMinor > 0,
          overTarget: costMinor > 0 && bp > targetBp,
        });
      }
      return out.sort((a, b) => b.foodCostBp - a.foodCostBp);
    });
  }

  /**
   * Rejects a recipe whose lines are written in units the stocked item cannot express.
   *
   * Reports every offending line at once rather than the first — someone entering a
   * twelve-line thali recipe should not have to submit twelve times to find them all.
   */
  private async assertUnitsConvertible(
    tx: Tx,
    lines: { inventoryItemId: string; uomId: string; qty: string }[],
  ): Promise<void> {
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: lines.map((l) => l.inventoryItemId) } },
      select: { id: true, name: true, uom: { select: { code: true, baseCode: true, factorToBase: true } } },
    });
    const uoms = await tx.uom.findMany({
      where: { id: { in: lines.map((l) => l.uomId) } },
      select: { id: true, code: true, baseCode: true, factorToBase: true },
    });

    const itemById = new Map(items.map((i) => [i.id, i]));
    const uomById = new Map(uoms.map((u) => [u.id, u]));
    const problems: string[] = [];

    for (const line of lines) {
      const item = itemById.get(line.inventoryItemId);
      const uom = uomById.get(line.uomId);
      if (!item || !uom) {
        problems.push('A recipe line refers to an item or unit that does not exist');
        continue;
      }
      try {
        convertQty(line.qty, uom, item.uom);
      } catch (err) {
        if (err instanceof IncompatibleUomError) {
          problems.push(
            `${item.name}: the recipe says ${uom.code} but it is stocked in ${item.uom.code}`,
          );
        } else {
          throw err;
        }
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException({
        message: 'These recipe lines use units that cannot be converted to how the item is stocked',
        errors: problems.map((p) => ({ field: 'lines', message: p })),
      });
    }
  }

  /**
   * Converts a recipe line's quantity from the unit it was written in into the unit the
   * item is stocked in.
   *
   * Returns `null` rather than throwing when the two units are incompatible. That choice
   * is deliberate and only matters in one place: `consumeForOrder` runs inside the settle
   * transaction, so throwing here would stop the shop billing a customer because of a
   * recipe someone mis-configured weeks ago. Money first. The line is skipped, logged,
   * and shows up in the variance report as stock that moved without explanation — which
   * is exactly the signal that something needs fixing.
   *
   * Recipes cannot be *saved* with incompatible units (see `assertUnitsConvertible`), so
   * this path should be unreachable for anything created after this validation existed.
   */
  private toStockQty(line: {
    qty: unknown;
    uom: UomDef;
    item: { name: string; uom: UomDef };
  }): string | null {
    try {
      return convertQty(String(line.qty), line.uom, line.item.uom);
    } catch (err) {
      if (err instanceof IncompatibleUomError) {
        this.logger.error(
          `Recipe line for "${line.item.name}" is written in ${line.uom.code} but the item ` +
            `is stocked in ${line.item.uom.code}. Skipping it — fix the recipe.`,
        );
        return null;
      }
      throw err;
    }
  }

  private async findRecipe(tx: Tx, menuItemId: string, variantId: string | null) {
    const recipe = await tx.recipe.findFirst({
      where: { menuItemId, variantId, isActive: true },
      orderBy: { version: 'desc' },
      include: {
        lines: {
          include: {
            // Both units are needed: the recipe is written in one and stock is held in
            // the other, and the gap between them is where quantities get destroyed.
            uom: { select: { code: true, baseCode: true, factorToBase: true } },
            item: {
              select: {
                avgCostMinor: true,
                name: true,
                uom: { select: { code: true, baseCode: true, factorToBase: true } },
              },
            },
          },
        },
      },
    });
    if (!recipe && variantId !== null) return null;
    if (!recipe) return null;
    return recipe;
  }
}
