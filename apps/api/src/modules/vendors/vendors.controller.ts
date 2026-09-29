import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  goodsReceiptSchema,
  purchaseOrderSchema,
  uuid,
  vendorPaymentSchema,
  vendorSchema,
} from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { VendorsService } from './vendors.service';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermissions('vendor:read')
  list(@Query('search') search?: string, @Query('all') all?: string) {
    return this.vendors.list({ search, activeOnly: all !== 'true' });
  }

  @Post()
  @RequirePermissions('vendor:write')
  create(@Body(zodBody(vendorSchema)) body: z.infer<typeof vendorSchema>) {
    return this.vendors.upsert(body);
  }

  @Put(':id')
  @RequirePermissions('vendor:write')
  update(@Param('id') id: string, @Body(zodBody(vendorSchema)) body: z.infer<typeof vendorSchema>) {
    return this.vendors.upsert(body, id);
  }

  @Put('prices')
  @RequirePermissions('vendor:write')
  @ApiOperation({ summary: 'Record a vendor price (the previous one is closed, not overwritten)' })
  setPrice(
    @Body(
      zodBody(
        z.object({
          vendorId: uuid,
          inventoryItemId: uuid,
          priceMinor: z.number().int().nonnegative(),
          minOrderQty: z.string().optional(),
        }),
      ),
    )
    body: { vendorId: string; inventoryItemId: string; priceMinor: number; minOrderQty?: string },
  ) {
    return this.vendors.setItemPrice(body);
  }

  @Get('compare/:inventoryItemId')
  @RequirePermissions('vendor:read', 'inventory:cost:read')
  compare(@Param('inventoryItemId') inventoryItemId: string) {
    return this.vendors.priceComparison(inventoryItemId);
  }

  // ─── Purchasing ───────────────────────────────────────────────────────────

  @Post('purchase-orders')
  @RequirePermissions('po:create')
  createPo(@Body(zodBody(purchaseOrderSchema)) body: z.infer<typeof purchaseOrderSchema>) {
    return this.vendors.createPurchaseOrder(body);
  }

  @Get('purchase-orders/:branchId')
  @RequirePermissions('po:read')
  listPos(@Param('branchId') branchId: string, @Query('status') status?: string) {
    return this.vendors.listPurchaseOrders(branchId, status);
  }

  @Post('receipts')
  @RequirePermissions('grn:create')
  @ApiOperation({ summary: 'Receive goods — updates stock and weighted-average cost' })
  receive(@Body(zodBody(goodsReceiptSchema)) body: z.infer<typeof goodsReceiptSchema>) {
    return this.vendors.receiveGoods(body);
  }

  // ─── Payables ─────────────────────────────────────────────────────────────

  @Get('payables/list')
  @RequirePermissions('payable:read')
  @ApiOperation({ summary: 'Who do I owe, and when — overdue first' })
  payables(@Query('vendorId') vendorId?: string, @Query('dueWithinDays') dueWithinDays?: string) {
    return this.vendors.payables({
      vendorId,
      dueWithinDays: dueWithinDays ? Number(dueWithinDays) : undefined,
    });
  }

  @Get('payables/balances')
  @RequirePermissions('payable:read')
  balances() {
    return this.vendors.vendorBalances();
  }

  @Post('payments')
  @RequirePermissions('payable:pay')
  pay(@Body(zodBody(vendorPaymentSchema)) body: z.infer<typeof vendorPaymentSchema>) {
    return this.vendors.recordPayment(body);
  }
}
