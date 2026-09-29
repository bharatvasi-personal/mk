import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  employeeSchema,
  payrollRunSchema,
  salaryAdvanceSchema,
  salaryStructureSchema,
  shiftAssignmentSchema,
  shiftSchema,
  uuid,
} from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { EmployeesService } from './employees.service';
import { PayrollService } from './payroll.service';

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly payroll: PayrollService,
  ) {}

  @Get('employees')
  @RequirePermissions('employee:read')
  list(@Query('branchId') branchId?: string, @Query('includeInactive') includeInactive?: string) {
    return this.employees.list(branchId, includeInactive === 'true');
  }

  @Get('employees/:id')
  @RequirePermissions('employee:read')
  get(@Param('id') id: string) {
    return this.employees.get(id);
  }

  @Post('employees')
  @RequirePermissions('employee:write')
  create(@Body(zodBody(employeeSchema)) body: z.infer<typeof employeeSchema>) {
    return this.employees.upsert(body);
  }

  @Put('employees/:id')
  @RequirePermissions('employee:write')
  update(@Param('id') id: string, @Body(zodBody(employeeSchema)) body: z.infer<typeof employeeSchema>) {
    return this.employees.upsert(body, id);
  }

  @Post('salary')
  @RequirePermissions('salary:write')
  @ApiOperation({ summary: 'Set salary. Versioned — a raise does not rewrite old payslips.' })
  setSalary(@Body(zodBody(salaryStructureSchema)) body: z.infer<typeof salaryStructureSchema>) {
    return this.employees.setSalary(body as never);
  }

  @Post('advances')
  @RequirePermissions('salary:write')
  advance(@Body(zodBody(salaryAdvanceSchema)) body: z.infer<typeof salaryAdvanceSchema>) {
    return this.employees.giveAdvance(body);
  }

  // ─── Shifts ───────────────────────────────────────────────────────────────

  @Get('shifts/:branchId')
  @RequirePermissions('employee:read')
  shifts(@Param('branchId') branchId: string) {
    return this.employees.listShifts(branchId);
  }

  @Post('shifts')
  @RequirePermissions('shift:write')
  upsertShift(@Body(zodBody(shiftSchema)) body: z.infer<typeof shiftSchema>) {
    return this.employees.upsertShift(body);
  }

  @Post('shift-assignments')
  @RequirePermissions('shift:write')
  assignShift(@Body(zodBody(shiftAssignmentSchema)) body: z.infer<typeof shiftAssignmentSchema>) {
    return this.employees.assignShift(body);
  }

  // ─── Payroll ──────────────────────────────────────────────────────────────

  @Post('payroll/prepare')
  @RequirePermissions('payroll:run')
  @ApiOperation({ summary: 'Compute a draft payroll run from reviewed attendance' })
  prepare(@Body(zodBody(payrollRunSchema)) body: z.infer<typeof payrollRunSchema>) {
    return this.payroll.prepare(body.branchId, body.period);
  }

  @Get('payroll/:branchId')
  @RequirePermissions('payroll:read')
  listPayroll(@Param('branchId') branchId: string) {
    return this.payroll.list(branchId);
  }

  @Get('payroll/run/:id')
  @RequirePermissions('payroll:read')
  getPayroll(@Param('id') id: string) {
    return this.payroll.get(id);
  }

  @Post('payroll/:id/approve')
  @RequirePermissions('payroll:approve')
  @ApiOperation({ summary: 'Approve a run — freezes the attendance days it paid' })
  approve(@Param('id') id: string) {
    return this.payroll.approve(id);
  }

  @Post('payroll/:id/paid')
  @RequirePermissions('payroll:approve')
  markPaid(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          payments: z
            .array(
              z.object({
                employeeId: uuid,
                method: z.enum(['CASH', 'UPI', 'NEFT', 'IMPS', 'CHEQUE']),
                reference: z.string().max(80).optional(),
              }),
            )
            .min(1),
        }),
      ),
    )
    body: { payments: { employeeId: string; method: string; reference?: string }[] },
  ) {
    return this.payroll.markPaid(id, body.payments);
  }
}
