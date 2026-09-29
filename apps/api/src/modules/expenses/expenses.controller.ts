import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { expenseSchema } from '@mk/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';

/**
 * Expenses: rent, electricity, gas refills, repairs.
 *
 * Small module, large consequence — revenue minus food cost minus staff cost is *not*
 * profit, and a partner who only ever sees the first three numbers will believe the
 * business is doing better than it is. The `isFixed` flag on the category is what makes
 * a break-even thali count computable.
 */
@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  @RequirePermissions('expense:read')
  categories() {
    return this.db.run((tx) =>
      tx.expenseCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    );
  }

  @Post('categories')
  @RequirePermissions('expense:write')
  createCategory(
    @Body(zodBody(z.object({ name: z.string().min(1).max(80), isFixed: z.boolean().default(false) })))
    body: { name: string; isFixed: boolean },
  ) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      return tx.expenseCategory.upsert({
        where: { tenantId_name: { tenantId, name: body.name } },
        create: { tenantId, ...body },
        update: { isFixed: body.isFixed, isActive: true },
      });
    });
  }

  @Get()
  @RequirePermissions('expense:read')
  list(@Query('branchId') branchId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.db.run((tx) =>
      tx.expense.findMany({
        where: {
          branchId,
          ...(from || to
            ? {
                incurredOn: {
                  ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
                  ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
                },
              }
            : {}),
        },
        include: { category: { select: { name: true, isFixed: true } } },
        orderBy: { incurredOn: 'desc' },
        take: 200,
      }),
    );
  }

  @Post()
  @RequirePermissions('expense:write')
  @ApiOperation({ summary: 'Record an expense' })
  create(@Body(zodBody(expenseSchema)) body: z.infer<typeof expenseSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const expense = await tx.expense.create({
        data: {
          tenantId,
          branchId: body.branchId,
          categoryId: body.categoryId,
          amountMinor: body.amountMinor,
          incurredOn: new Date(`${body.incurredOn}T00:00:00Z`),
          paymentMethod: body.paymentMethod,
          reference: body.reference,
          description: body.description,
          enteredByUserId: TenantContext.actor()?.userId,
        },
      });
      await this.audit.log(tx, {
        action: 'EXPENSE_RECORDED',
        entity: 'Expense',
        entityId: expense.id,
        branchId: body.branchId,
        after: { amountMinor: body.amountMinor, categoryId: body.categoryId, incurredOn: body.incurredOn },
      });
      return expense;
    });
  }
}
