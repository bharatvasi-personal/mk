import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';
import { assertBranchAccess } from '../../common/auth/branch-access';

const D = Prisma.Decimal;

/**
 * Payroll.
 *
 * Reads `AttendanceDay`, never raw punches — the derived record is the reviewed,
 * correctable one, and paying from raw events would mean paying an unreviewed number.
 *
 * Approving a run **freezes** the attendance days it paid, so history cannot shift
 * under a payslip that has already been handed over in cash.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /** Computes a draft run. Re-runnable until approved. */
  async prepare(branchId: string, period: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const [yearStr, monthStr] = period.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 0));
      const daysInMonth = periodEnd.getUTCDate();

      const existing = await tx.payrollRun.findUnique({
        where: { branchId_period: { branchId, period } },
      });
      if (existing && existing.status !== 'DRAFT') {
        throw new BadRequestException(`Payroll for ${period} is already ${existing.status.toLowerCase()}`);
      }

      const unreviewed = await tx.attendanceDay.count({
        where: { branchId, workDate: { gte: periodStart, lte: periodEnd }, status: 'NEEDS_REVIEW' },
      });
      if (unreviewed > 0) {
        throw new BadRequestException(
          `${unreviewed} attendance ${unreviewed === 1 ? 'day needs' : 'days need'} review before ` +
            'payroll can be prepared. Fix those first — paying an unreviewed day is how wage disputes start.',
        );
      }

      const employees = await tx.employee.findMany({
        where: { branchId, OR: [{ isActive: true }, { exitedOn: { gte: periodStart } }] },
        include: {
          salaryStructures: {
            where: { effectiveFrom: { lte: periodEnd } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
          advances: { where: { isSettled: false } },
        },
      });

      // A draft is replaced wholesale rather than patched — simpler and always consistent.
      if (existing) await tx.payrollLine.deleteMany({ where: { payrollRunId: existing.id } });

      const payDay = employees[0]?.salaryStructures[0]?.payDayOfMonth ?? 10;
      const run =
        existing ??
        (await tx.payrollRun.create({
          data: {
            tenantId,
            branchId,
            period,
            periodStart,
            periodEnd,
            payDate: new Date(Date.UTC(year, month, Math.min(payDay, 28))),
            status: 'DRAFT',
          },
        }));

      let gross = 0;
      let deductions = 0;

      for (const employee of employees) {
        const salary = employee.salaryStructures[0];
        if (!salary) continue; // No salary on record — reported as a gap, not guessed at.

        const days = await tx.attendanceDay.findMany({
          where: { employeeId: employee.id, workDate: { gte: periodStart, lte: periodEnd } },
        });

        const presentDays = days.filter((d) => d.status === 'PRESENT').length;
        const halfDays = days.filter((d) => d.status === 'HALF_DAY').length;
        const paidLeaveDays = days.filter((d) => d.status === 'LEAVE' || d.status === 'HOLIDAY').length;
        const weeklyOffs = days.filter((d) => d.status === 'WEEKLY_OFF').length;
        const absentDays = days.filter((d) => d.status === 'ABSENT').length;
        const overtimeMinutes = days.reduce((s, d) => s + d.overtimeMinutes, 0);

        const effectivePaidDays = presentDays + halfDays * 0.5 + paidLeaveDays + weeklyOffs;

        let basicMinor: number;
        let hourlyMinor: number;
        if (salary.basis === 'DAILY') {
          const rate = salary.dailyRateMinor ?? 0;
          basicMinor = Math.round(rate * (presentDays + halfDays * 0.5));
          hourlyMinor = Math.round(rate / 8);
        } else {
          const monthly = salary.monthlyGrossMinor ?? 0;
          // Pro-rate on calendar days, which is the convention here and matches what
          // staff expect when they compare notes.
          basicMinor = Math.round((monthly / daysInMonth) * effectivePaidDays);
          hourlyMinor = Math.round(monthly / (daysInMonth * 8));
        }

        const overtimeMinor = Math.round(
          (overtimeMinutes / 60) * hourlyMinor * Number(salary.overtimeRateMultiplier),
        );

        // Recover advances, but never more than half of net — leaving someone with
        // nothing to take home guarantees they leave.
        const outstandingAdvance = employee.advances.reduce(
          (s, a) => s + (a.amountMinor - a.recoveredMinor),
          0,
        );
        const grossMinor = basicMinor + overtimeMinor;
        const advanceDeductionMinor = Math.min(outstandingAdvance, Math.round(grossMinor * 0.5));
        const netMinor = grossMinor - advanceDeductionMinor;

        await tx.payrollLine.create({
          data: {
            tenantId,
            payrollRunId: run.id,
            employeeId: employee.id,
            presentDays: new D(presentDays),
            paidLeaveDays: new D(paidLeaveDays),
            absentDays: new D(absentDays),
            overtimeMinutes,
            basicMinor,
            overtimeMinor,
            advanceDeductionMinor,
            grossMinor,
            netMinor,
          },
        });

        gross += grossMinor;
        deductions += advanceDeductionMinor;
      }

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { grossMinor: gross, deductionsMinor: deductions, netMinor: gross - deductions },
      });

      return tx.payrollRun.findUniqueOrThrow({
        where: { id: updated.id },
        include: {
          lines: {
            include: { employee: { select: { name: true, employeeCode: true, roleType: true } } },
            orderBy: { employee: { name: 'asc' } },
          },
        },
      });
    });
  }

  async approve(payrollRunId: string) {
    return this.db.run(async (tx) => {
      const run = await tx.payrollRun.findUniqueOrThrow({
        where: { id: payrollRunId },
        include: { lines: true },
      });
      assertBranchAccess(run.branchId, 'payroll:approve');
      if (run.status !== 'DRAFT') throw new BadRequestException('Only a draft run can be approved');

      // Freeze the days this run paid.
      await tx.attendanceDay.updateMany({
        where: {
          branchId: run.branchId,
          workDate: { gte: run.periodStart, lte: run.periodEnd },
          lockedByPayrollRunId: null,
        },
        data: { lockedByPayrollRunId: run.id },
      });

      // Recover the advances this run deducted.
      for (const line of run.lines) {
        let toRecover = line.advanceDeductionMinor;
        if (toRecover <= 0) continue;
        const advances = await tx.salaryAdvance.findMany({
          where: { employeeId: line.employeeId, isSettled: false },
          orderBy: { givenOn: 'asc' },
        });
        for (const advance of advances) {
          if (toRecover <= 0) break;
          const owed = advance.amountMinor - advance.recoveredMinor;
          const apply = Math.min(owed, toRecover);
          await tx.salaryAdvance.update({
            where: { id: advance.id },
            data: {
              recoveredMinor: advance.recoveredMinor + apply,
              isSettled: advance.recoveredMinor + apply >= advance.amountMinor,
            },
          });
          toRecover -= apply;
        }
      }

      const approved = await tx.payrollRun.update({
        where: { id: payrollRunId },
        data: {
          status: 'APPROVED',
          approvedByUserId: TenantContext.actor()?.userId,
          approvedAt: new Date(),
        },
      });

      await this.audit.log(tx, {
        action: 'PAYROLL_APPROVED',
        entity: 'PayrollRun',
        entityId: payrollRunId,
        branchId: run.branchId,
        after: { period: run.period, netMinor: run.netMinor, employees: run.lines.length },
      });
      return approved;
    });
  }

  async markPaid(payrollRunId: string, payments: { employeeId: string; method: string; reference?: string }[]) {
    return this.db.run(async (tx) => {
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: payrollRunId } });
      assertBranchAccess(run.branchId, 'payroll:approve');
      if (run.status !== 'APPROVED') throw new BadRequestException('Approve the run before marking it paid');

      for (const p of payments) {
        await tx.payrollLine.updateMany({
          where: { payrollRunId, employeeId: p.employeeId },
          data: { paymentMethod: p.method, paymentReference: p.reference, paidAt: new Date() },
        });
      }

      const remaining = await tx.payrollLine.count({ where: { payrollRunId, paidAt: null } });
      const updated =
        remaining === 0
          ? await tx.payrollRun.update({
              where: { id: payrollRunId },
              data: { status: 'PAID', paidAt: new Date() },
            })
          : run;

      await this.audit.log(tx, {
        action: 'PAYROLL_PAID',
        entity: 'PayrollRun',
        entityId: payrollRunId,
        branchId: run.branchId,
        after: { paid: payments.length, remaining },
      });
      return updated;
    });
  }

  async list(branchId: string) {
    return this.db.run((tx) =>
      tx.payrollRun.findMany({
        where: { branchId },
        include: { _count: { select: { lines: true } } },
        orderBy: { period: 'desc' },
        take: 24,
      }),
    );
  }

  async get(payrollRunId: string) {
    return this.db.run((tx) =>
      tx.payrollRun.findUniqueOrThrow({
        where: { id: payrollRunId },
        include: {
          lines: { include: { employee: { select: { name: true, employeeCode: true, roleType: true, phone: true } } } },
        },
      }),
    );
  }

  /** Staff cost for a date range — the other half of the two numbers that matter. */
  async staffCost(tx: Tx, branchId: string, from: Date, to: Date): Promise<number> {
    const runs = await tx.payrollRun.findMany({
      where: { branchId, status: { in: ['APPROVED', 'PAID'] }, periodStart: { lte: to }, periodEnd: { gte: from } },
    });
    if (runs.length === 0) return 0;

    // Apportion each overlapping run by the number of its days inside the window.
    let total = 0;
    for (const run of runs) {
      const runDays =
        Math.round((run.periodEnd.getTime() - run.periodStart.getTime()) / 86_400_000) + 1;
      const overlapStart = run.periodStart > from ? run.periodStart : from;
      const overlapEnd = run.periodEnd < to ? run.periodEnd : to;
      const overlapDays = Math.max(
        0,
        Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000) + 1,
      );
      total += Math.round((run.netMinor / runDays) * overlapDays);
    }
    return total;
  }
}
