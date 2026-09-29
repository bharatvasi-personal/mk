import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MEAL_SLOTS, publicOrderSchema, slotForHour } from '@mk/shared';
import type { MealSlot } from '@prisma/client';
import type { z } from 'zod';
import { AllowCustomer, Public } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';

/**
 * The customer-facing surface. Everything here is either unauthenticated (menu,
 * branch info) or customer-authenticated (placing and tracking an order).
 *
 * Kept as its own controller rather than adding `@Public()` to the admin controllers,
 * because the shape of what a customer may see is a product decision that should live
 * in one readable place — not be inferred from decorators scattered across ten files.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly menu: MenuService,
    private readonly orders: OrdersService,
    private readonly db: TenantDb,
  ) {}

  @Public()
  @Get('branches')
  @ApiOperation({ summary: 'Open branches with address, hours and geolocation' })
  async branches() {
    return this.db.run((tx) =>
      tx.branch.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          pincode: true,
          lat: true,
          lng: true,
          phone: true,
          operatingHours: true,
          openingDate: true,
        },
        orderBy: { code: 'asc' },
      }),
    );
  }

  @Public()
  @Get('menu/:branchId')
  @ApiOperation({ summary: 'Public menu for a branch — available items only, with prices' })
  async publicMenu(@Param('branchId') branchId: string, @Query('mealSlot') mealSlot?: string) {
    const slot = (MEAL_SLOTS.find((s) => s === mealSlot) ?? undefined) as MealSlot | undefined;
    return this.menu.branchMenu(branchId, { mealSlot: slot });
  }

  @Public()
  @Get('now')
  @ApiOperation({ summary: 'Which meal slot is being served right now, in shop-local time' })
  now() {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(
        new Date(),
      ),
    );
    return { hour, mealSlot: slotForHour(hour), serverTime: new Date().toISOString() };
  }

  @AllowCustomer()
  @Post('orders')
  @ApiOperation({ summary: 'Place an online pickup order (payment is a separate step)' })
  async placeOrder(@Body(zodBody(publicOrderSchema)) body: z.infer<typeof publicOrderSchema>) {
    const actor = TenantContext.actor();
    if (!actor?.customerId) throw new BadRequestException('Customer sign-in required');

    const customer = await this.db.run((tx) =>
      tx.customer.findUniqueOrThrow({
        where: { id: actor.customerId! },
        select: { id: true, name: true, phone: true },
      }),
    );

    const pickupAt = new Date(body.pickupAt);
    // A pickup time in the past, or absurdly far out, is a client bug or a bored user.
    if (pickupAt.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('Choose a pickup time in the future');
    }
    if (pickupAt.getTime() > Date.now() + 7 * 86_400_000) {
      throw new BadRequestException('Pickup orders can be placed up to a week ahead');
    }

    const order = await this.orders.create(
      {
        branchId: body.branchId,
        clientRef: body.clientRef,
        channel: 'ONLINE_PICKUP',
        mealSlot: body.mealSlot,
        items: body.items,
        pickupAt: body.pickupAt,
        notes: body.notes,
        customerName: customer.name ?? undefined,
        customerPhone: customer.phone,
        discountMinor: 0,
      },
      { allowDiscount: false },
    );

    await this.db.run((tx) =>
      tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } }),
    );

    return {
      orderId: order.id,
      tokenNo: order.tokenNo,
      totalMinor: order.totalMinor,
      taxMinor: order.taxMinor,
      subtotalMinor: order.subtotalMinor,
      pickupAt: order.pickupAt,
      paymentStatus: order.paymentStatus,
    };
  }

  @AllowCustomer()
  @Get('orders')
  @ApiOperation({ summary: 'A customer’s own order history' })
  async myOrders() {
    const actor = TenantContext.actor();
    if (!actor?.customerId) throw new BadRequestException('Customer sign-in required');
    return this.db.run((tx) =>
      tx.order.findMany({
        where: { customerId: actor.customerId },
        select: {
          id: true,
          tokenNo: true,
          status: true,
          paymentStatus: true,
          totalMinor: true,
          pickupAt: true,
          createdAt: true,
          mealSlot: true,
          items: { select: { nameSnapshot: true, variantSnapshot: true, qty: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
  }

  @AllowCustomer()
  @Get('orders/:id')
  async myOrder(@Param('id') id: string) {
    const actor = TenantContext.actor();
    return this.db.run(async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { id, customerId: actor?.customerId },
        select: {
          id: true,
          tokenNo: true,
          status: true,
          paymentStatus: true,
          totalMinor: true,
          pickupAt: true,
          items: { select: { nameSnapshot: true, variantSnapshot: true, qty: true, lineTotalMinor: true } },
        },
      });
      return order;
    });
  }
}
