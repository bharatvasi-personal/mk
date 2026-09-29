import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { reportRangeSchema } from '@mk/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermissions } from '../../common/auth/decorators';
import { zodBody, zodQuery } from '../../common/http/zod-validation.pipe';
import type { RequestActor } from '../../common/tenant/tenant-context';
import { ReportsService } from './reports.service';

/** Both range reports need real dates; without this a missing one reached Prisma as `new Date(undefined)`. */
const dateRangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('today/:branchId')
  @RequirePermissions('report:sales')
  @ApiOperation({ summary: 'Live figures for today — revenue, food cost %, cash vs UPI, top items' })
  today(@Param('branchId') branchId: string) {
    return this.reports.today(branchId);
  }

  @Get('day/:branchId')
  @RequirePermissions('report:sales')
  day(@Param('branchId') branchId: string, @Query('date') date: string) {
    return this.reports.dayLive(branchId, date);
  }

  @Get('series')
  @RequirePermissions('report:sales')
  @ApiOperation({ summary: 'Daily / weekly / monthly sales, cost and tender mix' })
  series(@Query(zodBody(reportRangeSchema)) q: z.infer<typeof reportRangeSchema>) {
    return this.reports.series(q);
  }

  @Get('branches')
  @RequirePermissions('report:consolidated')
  @ApiOperation({ summary: 'Branch-vs-branch comparison with contribution and cost ratios' })
  branches(@Query(zodQuery(dateRangeQuery)) q: { from: string; to: string }) {
    return this.reports.branchComparison(q.from, q.to);
  }

  @Get('break-even/:branchId')
  @RequirePermissions('report:cost')
  @ApiOperation({ summary: 'How many orders a day just to cover fixed costs' })
  breakEven(@Param('branchId') branchId: string, @Query(zodQuery(dateRangeQuery)) q: { from: string; to: string }) {
    return this.reports.breakEven(branchId, q.from, q.to);
  }

  @Post('rollup/:branchId')
  @RequirePermissions('report:sales')
  @ApiOperation({ summary: 'Recompute a day’s rollup (the nightly job calls this too)' })
  rollup(@Param('branchId') branchId: string, @Body(zodBody(z.object({ date: z.string() }))) body: { date: string }) {
    return this.reports.rollupDay(branchId, body.date);
  }

  @Post('close-day/:branchId')
  @RequirePermissions('report:sales', 'cash_session:manage')
  @ApiOperation({ summary: 'Lock a trading day once the manager has completed the checklist' })
  closeDay(
    @Param('branchId') branchId: string,
    @Body(zodBody(z.object({ date: z.string() }))) body: { date: string },
    @CurrentActor() actor: RequestActor,
  ) {
    return this.reports.closeDay(branchId, body.date, actor.userId);
  }

  @Get('audit')
  @RequirePermissions('audit:read')
  audit(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.reports.auditTrail({
      entity,
      entityId,
      userId,
      action,
      branchId,
      from,
      to,
      page: page ? Number(page) : undefined,
    });
  }
}
