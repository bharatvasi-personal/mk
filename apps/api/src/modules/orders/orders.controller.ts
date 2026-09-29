import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  KITCHEN_STATIONS,
  cancelOrderSchema,
  closeCashSessionSchema,
  createOrderSchema,
  openCashSessionSchema,
  quickBillSchema,
  settleOrderSchema,
  updateOrderStatusSchema,
  uuid,
  voidOrderItemSchema,
} from '@mk/shared';
import type { KitchenStation } from '@prisma/client';
import { CurrentActor, RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import type { RequestActor } from '../../common/tenant/tenant-context';
import { CashSessionService } from './cash-session.service';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
@UseInterceptors(IdempotencyInterceptor)
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description:
    'A client-generated UUID. Send it on every write from the POS: a replay returns the ' +
    'original response instead of creating a second order or taking payment twice.',
})
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly cash: CashSessionService,
  ) {}

  @Post()
  @RequirePermissions('order:create')
  @ApiOperation({ summary: 'Create an order. Prices are resolved server-side from the branch menu.' })
  create(
    @Body(zodBody(createOrderSchema)) body: z.infer<typeof createOrderSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.orders.create(body, { allowDiscount: actor.permissions.has('order:discount') });
  }

  @Post(':id/kot')
  @RequirePermissions('order:create')
  @ApiOperation({ summary: 'Confirm and cut kitchen tickets, split by station' })
  kot(@Param('id') id: string) {
    return this.orders.confirmAndPrintKot(id);
  }

  @Post('quick-bill')
  @RequirePermissions('order:create', 'order:settle')
  @ApiOperation({
    summary: 'Create + KOT + settle in one transaction — the POS\'s primary operation',
    description:
      'Safe to replay: the order\'s clientRef is unique per branch, and a replay after the ' +
      'bill has settled returns the existing bill. This is what the offline queue sends.',
  })
  quickBill(
    @Body(zodBody(quickBillSchema)) body: z.infer<typeof quickBillSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.orders.quickBill(body, { allowDiscount: actor.permissions.has('order:discount') });
  }

  @Post('settle')
  @RequirePermissions('order:settle')
  @ApiOperation({ summary: 'Settle a bill: payments, stock depletion, COGS, GST invoice' })
  settle(@Body(zodBody(settleOrderSchema)) body: z.infer<typeof settleOrderSchema>) {
    return this.orders.settle(body);
  }

  @Patch('status')
  @RequirePermissions('kitchen:update')
  status(@Body(zodBody(updateOrderStatusSchema)) body: z.infer<typeof updateOrderStatusSchema>) {
    return this.orders.updateStatus(body.orderId, body.status);
  }

  @Post('void-item')
  @RequirePermissions('order:void')
  voidItem(@Body(zodBody(voidOrderItemSchema)) body: z.infer<typeof voidOrderItemSchema>) {
    return this.orders.voidItem(body.orderId, body.orderItemId, body.reason);
  }

  @Post('cancel')
  @RequirePermissions('order:void')
  cancel(@Body(zodBody(cancelOrderSchema)) body: z.infer<typeof cancelOrderSchema>) {
    return this.orders.cancel(body.orderId, body.reason);
  }

  @Post('credit-note')
  @RequirePermissions('order:refund')
  @ApiOperation({ summary: 'The only way to correct a settled bill — the invoice stays immutable' })
  creditNote(
    @Body(
      zodBody(
        z.object({ orderId: uuid, amountMinor: z.number().int().positive(), reason: z.string().min(3).max(300) }),
      ),
    )
    body: { orderId: string; amountMinor: number; reason: string },
  ) {
    return this.orders.issueCreditNote(body.orderId, body.amountMinor, body.reason);
  }

  @Get('open')
  @RequirePermissions('order:read')
  open(@Query('branchId') branchId: string) {
    return this.orders.openOrders(branchId);
  }

  @Get('kitchen')
  @RequirePermissions('kitchen:read')
  @ApiOperation({ summary: 'Kitchen display queue for a station' })
  kitchen(@Query('branchId') branchId: string, @Query('station') station?: string) {
    return this.orders.kitchenQueue(
      branchId,
      KITCHEN_STATIONS.find((s) => s === station) as KitchenStation | undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('order:read')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Get(':id/bill')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: 'Everything the thermal printer needs, resolved server-side' })
  bill(@Param('id') id: string) {
    return this.orders.bill(id);
  }
}

@ApiTags('cash')
@Controller('cash-sessions')
export class CashSessionController {
  constructor(private readonly cash: CashSessionService) {}

  @Post('open')
  @RequirePermissions('cash_session:manage')
  open(@Body(zodBody(openCashSessionSchema)) body: z.infer<typeof openCashSessionSchema>) {
    return this.cash.open(body.branchId, body.openingFloatMinor);
  }

  @Get('current')
  @RequirePermissions('cash_session:manage')
  @ApiOperation({ summary: 'The open drawer and its running tally' })
  current(@Query('branchId') branchId: string) {
    return this.cash.current(branchId);
  }

  @Post('close')
  @RequirePermissions('cash_session:manage')
  @ApiOperation({ summary: 'Close the drawer and produce the Z-report with the cash variance' })
  close(@Body(zodBody(closeCashSessionSchema)) body: z.infer<typeof closeCashSessionSchema>) {
    return this.cash.close(body);
  }

  @Get()
  @RequirePermissions('cash_session:manage')
  list(@Query('branchId') branchId: string) {
    return this.cash.list(branchId);
  }
}
