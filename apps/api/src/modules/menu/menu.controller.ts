import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  MEAL_SLOTS,
  branchMenuPriceSchema,
  menuCategorySchema,
  menuItemSchema,
  setSoldOutSchema,
  uuid,
} from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { MenuService } from './menu.service';

@ApiTags('menu')
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('branch/:branchId')
  @RequirePermissions('menu:read')
  @ApiOperation({ summary: 'Priced menu for a branch — what the POS loads at shift start' })
  async branchMenu(
    @Param('branchId') branchId: string,
    @Query('mealSlot') mealSlot?: string,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    return this.menu.branchMenu(branchId, {
      mealSlot: MEAL_SLOTS.find((s) => s === mealSlot),
      includeUnavailable: includeUnavailable === 'true',
    });
  }

  @Get('categories')
  @RequirePermissions('menu:read')
  listCategories() {
    return this.menu.listCategories();
  }

  @Post('categories')
  @RequirePermissions('menu:write')
  createCategory(@Body(zodBody(menuCategorySchema)) body: z.infer<typeof menuCategorySchema>) {
    return this.menu.upsertCategory(body);
  }

  @Put('categories/:id')
  @RequirePermissions('menu:write')
  updateCategory(
    @Param('id') id: string,
    @Body(zodBody(menuCategorySchema)) body: z.infer<typeof menuCategorySchema>,
  ) {
    return this.menu.upsertCategory(body, id);
  }

  @Get('items')
  @RequirePermissions('menu:read')
  listItems(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.menu.listItems({ categoryId, search });
  }

  @Post('items')
  @RequirePermissions('menu:write')
  createItem(@Body(zodBody(menuItemSchema)) body: z.infer<typeof menuItemSchema>) {
    return this.menu.upsertItem(body);
  }

  @Put('items/:id')
  @RequirePermissions('menu:write')
  updateItem(
    @Param('id') id: string,
    @Body(zodBody(menuItemSchema)) body: z.infer<typeof menuItemSchema>,
  ) {
    return this.menu.upsertItem(body, id);
  }

  @Put('prices')
  @RequirePermissions('menu:price:write')
  @ApiOperation({ summary: 'Set the price for a branch × variant × meal slot' })
  setPrice(@Body(zodBody(branchMenuPriceSchema)) body: z.infer<typeof branchMenuPriceSchema>) {
    return this.menu.setBranchPrice(body);
  }

  @Patch('sold-out')
  @RequirePermissions('menu:write')
  @ApiOperation({ summary: 'Mark an item sold out (cleared nightly)' })
  setSoldOut(@Body(zodBody(setSoldOutSchema)) body: z.infer<typeof setSoldOutSchema>) {
    return this.menu.setSoldOut(
      body.branchMenuItemId,
      body.soldOutUntil ? new Date(body.soldOutUntil) : null,
    );
  }

  @Post('clone-pricing')
  @RequirePermissions('menu:price:write', 'branch:write')
  @ApiOperation({ summary: 'Copy one branch’s prices to another, optionally with a markup' })
  clonePricing(
    @Body(
      zodBody(
        z.object({ fromBranchId: uuid, toBranchId: uuid, markupBp: z.number().int().min(0).max(5000).default(0) }),
      ),
    )
    body: { fromBranchId: string; toBranchId: string; markupBp: number },
  ) {
    return this.menu.cloneBranchPricing(body.fromBranchId, body.toBranchId, body.markupBp);
  }
}
