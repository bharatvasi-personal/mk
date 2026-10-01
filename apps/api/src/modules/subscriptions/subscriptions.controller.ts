import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  subscriptionPaidSchema,
  subscriptionSchema,
  subscriptionSkipSchema,
  subscriptionStatusSchema,
} from '@mk/shared';
import type {
  SubscriptionInput,
  SubscriptionPaidInput,
  SubscriptionSkipInput,
  SubscriptionStatusInput,
} from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermissions('subscription:read')
  list(@Query('branchId') branchId?: string, @Query('status') status?: string) {
    return this.subscriptions.list({ branchId, status });
  }

  @Get('due/:branchId')
  @RequirePermissions('subscription:read')
  @ApiOperation({ summary: "The day's delivery list — active plans due on a date and shift" })
  due(
    @Param('branchId') branchId: string,
    @Query('date') date: string,
    @Query('shift') shift?: string,
  ) {
    return this.subscriptions.due(branchId, date, shift);
  }

  @Get(':id')
  @RequirePermissions('subscription:read')
  get(@Param('id') id: string) {
    return this.subscriptions.get(id);
  }

  @Post()
  @RequirePermissions('subscription:write')
  create(@Body(zodBody(subscriptionSchema)) body: SubscriptionInput) {
    return this.subscriptions.create(body);
  }

  @Put(':id')
  @RequirePermissions('subscription:write')
  update(@Param('id') id: string, @Body(zodBody(subscriptionSchema)) body: SubscriptionInput) {
    return this.subscriptions.update(id, body);
  }

  @Post(':id/status')
  @RequirePermissions('subscription:write')
  @ApiOperation({ summary: 'Pause, resume, cancel or complete a plan' })
  setStatus(@Param('id') id: string, @Body(zodBody(subscriptionStatusSchema)) body: SubscriptionStatusInput) {
    return this.subscriptions.setStatus(id, body);
  }

  @Post(':id/skips')
  @RequirePermissions('subscription:write')
  @ApiOperation({ summary: 'Set the one-off skipped days for a plan' })
  setSkips(@Param('id') id: string, @Body(zodBody(subscriptionSkipSchema)) body: SubscriptionSkipInput) {
    return this.subscriptions.setSkips(id, body);
  }

  @Post(':id/paid')
  @RequirePermissions('subscription:write')
  setPaid(@Param('id') id: string, @Body(zodBody(subscriptionPaidSchema)) body: SubscriptionPaidInput) {
    return this.subscriptions.setPaid(id, body);
  }
}
