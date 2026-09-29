import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  BUYING_RHYTHMS,
  INVENTORY_CATEGORIES,
  branchStockPolicySchema,
  inventoryItemSchema,
  recipeSchema,
  stockCountSchema,
  stockMovementSchema,
  uuid,
} from '@mk/shared';
import type { BuyingRhythm, InventoryCategory } from '@prisma/client';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { InventoryService } from './inventory.service';
import { RecipeService } from './recipe.service';
import { StockCountService } from './stock-count.service';
import { StockService } from './stock.service';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly stock: StockService,
    private readonly counts: StockCountService,
    private readonly recipes: RecipeService,
  ) {}

  @Get('uoms')
  @RequirePermissions('inventory:read')
  uoms() {
    return this.inventory.listUoms();
  }

  @Get('items')
  @RequirePermissions('inventory:read')
  items(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.inventory.listItems({
      category: INVENTORY_CATEGORIES.find((c) => c === category) as InventoryCategory | undefined,
      search,
      branchId,
    });
  }

  @Post('items')
  @RequirePermissions('inventory:write')
  createItem(@Body(zodBody(inventoryItemSchema)) body: z.infer<typeof inventoryItemSchema>) {
    return this.inventory.upsertItem(body as never);
  }

  @Put('items/:id')
  @RequirePermissions('inventory:write')
  updateItem(
    @Param('id') id: string,
    @Body(zodBody(inventoryItemSchema)) body: z.infer<typeof inventoryItemSchema>,
  ) {
    return this.inventory.upsertItem(body as never, id);
  }

  @Put('policy')
  @RequirePermissions('inventory:write')
  @ApiOperation({ summary: 'Set reorder point / par level / preferred vendor for a branch' })
  setPolicy(@Body(zodBody(branchStockPolicySchema)) body: z.infer<typeof branchStockPolicySchema>) {
    return this.inventory.setBranchPolicy(body);
  }

  @Get('on-hand/:branchId')
  @RequirePermissions('inventory:read')
  onHand(
    @Param('branchId') branchId: string,
    @Query('lowOnly') lowOnly?: string,
    @Query('category') category?: string,
  ) {
    return this.inventory.stockOnHand(branchId, {
      lowOnly: lowOnly === 'true',
      category: INVENTORY_CATEGORIES.find((c) => c === category) as InventoryCategory | undefined,
    });
  }

  @Get('buy-today/:branchId')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'Purchase worklist grouped by vendor, filtered by buying rhythm' })
  buyToday(@Param('branchId') branchId: string, @Query('rhythm') rhythm?: string) {
    const rhythms = rhythm
      ? (rhythm.split(',').filter((r) => (BUYING_RHYTHMS as readonly string[]).includes(r)) as BuyingRhythm[])
      : undefined;
    return this.inventory.purchaseWorklist(branchId, rhythms);
  }

  @Post('movements')
  @RequirePermissions('stock:wastage')
  @ApiOperation({ summary: 'Manual stock movement — wastage, staff meal, opening balance' })
  move(@Body(zodBody(stockMovementSchema)) body: z.infer<typeof stockMovementSchema>) {
    return this.stock.post({
      branchId: body.branchId,
      inventoryItemId: body.inventoryItemId,
      qtyDelta: body.qtyDelta,
      reason: body.reason,
      note: body.note,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
  }

  @Get('ledger/:branchId')
  @RequirePermissions('inventory:read')
  ledger(
    @Param('branchId') branchId: string,
    @Query('inventoryItemId') inventoryItemId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.inventory.ledger(branchId, {
      inventoryItemId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  // ─── Recipes ──────────────────────────────────────────────────────────────

  @Post('recipes')
  @RequirePermissions('recipe:write')
  upsertRecipe(@Body(zodBody(recipeSchema)) body: z.infer<typeof recipeSchema>) {
    return this.recipes.upsert(body);
  }

  @Get('recipes/:menuItemId')
  @RequirePermissions('recipe:read')
  getRecipe(@Param('menuItemId') menuItemId: string, @Query('variantId') variantId?: string) {
    return this.recipes.get(menuItemId, variantId ?? null);
  }

  @Get('margins/:branchId')
  @RequirePermissions('inventory:cost:read')
  @ApiOperation({ summary: 'Per-dish food cost % against target — the margin worklist' })
  margins(@Param('branchId') branchId: string) {
    return this.recipes.marginReport(branchId);
  }

  // ─── Stock counts & variance ──────────────────────────────────────────────

  @Post('counts')
  @RequirePermissions('stock:count')
  createCount(@Body(zodBody(stockCountSchema)) body: z.infer<typeof stockCountSchema>) {
    return this.counts.create(body as never);
  }

  @Get('counts/:branchId')
  @RequirePermissions('stock:count')
  listCounts(@Param('branchId') branchId: string) {
    return this.counts.list(branchId);
  }

  @Post('counts/:id/approve')
  @RequirePermissions('stock:count:approve')
  @ApiOperation({ summary: 'Approve a count — posts the variance to the stock ledger' })
  approveCount(@Param('id') id: string) {
    return this.counts.approve(id);
  }

  @Get('variance/:branchId')
  @RequirePermissions('report:variance')
  @ApiOperation({ summary: 'Bought vs should-have-used vs counted — wastage and pilferage' })
  variance(
    @Param('branchId') branchId: string,
    @Query(zodBody(z.object({ from: z.string(), to: z.string() }))) q: { from: string; to: string },
  ) {
    return this.counts.varianceReport(branchId, q.from, q.to);
  }

  @Post('reconcile/:branchId')
  @RequirePermissions('inventory:write')
  @ApiOperation({ summary: 'Repair the on-hand cache from the ledger (should be a no-op)' })
  reconcile(@Param('branchId') branchId: string) {
    return this.stock.reconcileCache(branchId);
  }
}
