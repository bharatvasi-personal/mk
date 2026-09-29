import { Injectable } from '@nestjs/common';
import type { EmployeeInput } from '@mk/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(branchId?: string, includeInactive = false) {
    return this.db.run((tx) =>
      tx.employee.findMany({
        where: { ...(branchId ? { branchId } : {}), ...(includeInactive ? {} : { isActive: true }) },
        include: {
          salaryStructures: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
          user: { select: { id: true, email: true, phone: true, isActive: true } },
          credentials: {
            where: { revokedAt: null },
            select: { id: true, type: true, identifier: true, issuedOn: true },
          },
          _count: { select: { advances: { where: { isSettled: false } } } },
        },
        orderBy: [{ roleType: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  async get(id: string) {
    return this.db.run((tx) =>
      tx.employee.findUniqueOrThrow({
        where: { id },
        include: {
          salaryStructures: { orderBy: { effectiveFrom: 'desc' } },
          shiftAssignments: { include: { shift: true }, orderBy: { effectiveFrom: 'desc' } },
          advances: { orderBy: { givenOn: 'desc' } },
          credentials: { where: { revokedAt: null } },
          branch: { select: { id: true, name: true, code: true } },
        },
      }),
    );
  }

  async upsert(input: EmployeeInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const data = {
        ...input,
        joinedOn: new Date(input.joinedOn),
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      };
      if (id) {
        const before = await tx.employee.findUniqueOrThrow({ where: { id } });
        const after = await tx.employee.update({ where: { id }, data });
        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'Employee',
          entityId: id,
          branchId: after.branchId,
          ...diff(before as never, after as never),
        });
        return after;
      }
      const created = await tx.employee.create({ data: { ...data, tenantId } });
      await this.audit.log(tx, {
        action: 'CREATE',
        entity: 'Employee',
        entityId: created.id,
        branchId: created.branchId,
        after: created,
      });
      return created;
    });
  }

  /**
   * Salary is versioned, not edited. A raise creates a new row and closes the previous
   * one, so last month's payslip still reconciles against last month's rate.
   */
  async setSalary(input: {
    employeeId: string;
    effectiveFrom: string;
    basis: 'MONTHLY' | 'DAILY';
    monthlyGrossMinor?: number;
    dailyRateMinor?: number;
    components: Record<string, number>;
    overtimeRateMultiplier: number;
    payDayOfMonth: number;
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const effectiveFrom = new Date(input.effectiveFrom);

      await tx.salaryStructure.updateMany({
        where: { employeeId: input.employeeId, effectiveTo: null },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) },
      });

      const created = await tx.salaryStructure.create({
        data: {
          tenantId,
          employeeId: input.employeeId,
          effectiveFrom,
          basis: input.basis,
          monthlyGrossMinor: input.monthlyGrossMinor,
          dailyRateMinor: input.dailyRateMinor,
          components: input.components as never,
          overtimeRateMultiplier: input.overtimeRateMultiplier,
          payDayOfMonth: input.payDayOfMonth,
        },
      });

      await this.audit.log(tx, {
        action: 'SALARY_SET',
        entity: 'SalaryStructure',
        entityId: created.id,
        after: {
          employeeId: input.employeeId,
          basis: input.basis,
          monthlyGrossMinor: input.monthlyGrossMinor,
          dailyRateMinor: input.dailyRateMinor,
          effectiveFrom: input.effectiveFrom,
        },
      });
      return created;
    });
  }

  /** Advances are universal at this wage level, so payroll must deduct them automatically. */
  async giveAdvance(input: { employeeId: string; amountMinor: number; reason?: string; givenOn?: string }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const advance = await tx.salaryAdvance.create({
        data: {
          tenantId,
          employeeId: input.employeeId,
          amountMinor: input.amountMinor,
          reason: input.reason,
          givenOn: input.givenOn ? new Date(input.givenOn) : new Date(),
        },
      });
      await this.audit.log(tx, {
        action: 'SALARY_ADVANCE',
        entity: 'SalaryAdvance',
        entityId: advance.id,
        after: { employeeId: input.employeeId, amountMinor: input.amountMinor, reason: input.reason },
      });
      return advance;
    });
  }

  // ─── Shifts ───────────────────────────────────────────────────────────────

  /**
   * Shifts with who is currently on them.
   *
   * The roster is the question this list is actually asked — "who works mornings" — and a
   * shift list without it leaves an admin assigning people into a void, with no way to see
   * whether the assignment took. Past assignments are excluded rather than deleted: an
   * expired one still explains how last month's attendance was read.
   */
  async listShifts(branchId: string) {
    const today = new Date();
    return this.db.run((tx) =>
      tx.shift.findMany({
        where: { branchId },
        include: {
          assignments: {
            where: {
              effectiveFrom: { lte: today },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            },
            select: {
              id: true,
              daysOfWeek: true,
              effectiveFrom: true,
              effectiveTo: true,
              employee: { select: { id: true, name: true, employeeCode: true, roleType: true } },
            },
            orderBy: { effectiveFrom: 'desc' },
          },
        },
        orderBy: { startTime: 'asc' },
      }),
    );
  }

  async upsertShift(input: {
    branchId: string;
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
    fullDayMinutes: number;
    isActive: boolean;
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      return tx.shift.upsert({
        where: { branchId_name: { branchId: input.branchId, name: input.name } },
        create: { ...input, tenantId },
        update: input,
      });
    });
  }

  async assignShift(input: {
    employeeId: string;
    shiftId: string;
    effectiveFrom: string;
    effectiveTo?: string;
    daysOfWeek: number[];
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      return tx.shiftAssignment.create({
        data: {
          tenantId,
          employeeId: input.employeeId,
          shiftId: input.shiftId,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          daysOfWeek: input.daysOfWeek,
        },
      });
    });
  }
}
