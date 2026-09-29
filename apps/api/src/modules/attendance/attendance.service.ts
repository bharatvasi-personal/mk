import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AttendanceStatus, Prisma } from '@prisma/client';
import type { PunchInput } from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { hmacSha256, randomToken, sha256, verifyPassword } from '../../common/auth/crypto';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';

const IST = 'Asia/Kolkata';
/** India has no daylight saving, so a fixed offset is correct rather than merely convenient. */
const IST_OFFSET_MINUTES = 330;

/** The local business date for an instant, in the shop's timezone. */
function businessDate(at: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return new Date(`${parts}T00:00:00.000Z`);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Attendance.
 *
 * The design that matters here — argued at length in docs/ATTENDANCE-RESEARCH.md — is
 * that **a punch is raw immutable evidence and an attendance day is a derived,
 * correctable record.** Cheap attendance products conflate the two, which is exactly
 * why none of them can cope with a missed punch, a drifting device clock, or a shift
 * that crosses midnight.
 *
 * At launch, punches come from a rotating wall QR code or a manager tap. In phase 3 an
 * NFC reader posts to this same endpoint with an HMAC — one authentication adapter,
 * zero schema change.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  /** Rotating QR tokens, in memory: they live 90 seconds and losing them is harmless. */
  private readonly qrTokens = new Map<string, { branchId: string; expiresAt: number }>();

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ─── The wall QR ──────────────────────────────────────────────────────────

  /**
   * A short-lived rotating token, rendered as a QR code on the tablet or a screen at
   * the counter. Rotation is what stops someone photographing the QR once and punching
   * in from home every morning.
   */
  issueQrToken(branchId: string): { token: string; expiresInSeconds: number } {
    const token = randomToken(16);
    const ttl = 90;
    this.qrTokens.set(token, { branchId, expiresAt: Date.now() + ttl * 1000 });
    for (const [k, v] of this.qrTokens) if (v.expiresAt < Date.now()) this.qrTokens.delete(k);
    return { token, expiresInSeconds: ttl };
  }

  // ─── Punch ────────────────────────────────────────────────────────────────

  /**
   * The single punch endpoint. Every source posts this shape.
   *
   * Nothing here ever rejects a punch for being outside the geofence. GPS drift between
   * neighbouring units in a dense market is real, and a helper who cannot clock in
   * because of satellite geometry will stop using the system by Thursday. The punch is
   * recorded and *flagged* for the manager to look at.
   */
  async punch(input: PunchInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);

      const device = input.deviceCode
        ? await tx.attendanceDevice.findFirst({
            where: { code: input.deviceCode, branchId: input.branchId, isActive: true },
          })
        : null;

      if (input.source === 'QR') {
        const entry = input.credentialIdentifier ? this.qrTokens.get(input.credentialIdentifier) : undefined;
        if (!entry || entry.expiresAt < Date.now() || entry.branchId !== input.branchId) {
          throw new ForbiddenException('That QR code has expired — ask for a fresh one at the counter');
        }
      }

      const employee = await this.resolveEmployee(tx, input);

      // Staff may only punch themselves; a manager with attendance:correct may punch
      // anyone (the "he forgot, mark him in" case, which is legitimate and audited).
      const actor = TenantContext.actor();
      if (actor && actor.kind === 'STAFF' && !actor.permissions.has('attendance:correct')) {
        const self = await tx.employee.findFirst({ where: { userId: actor.userId } });
        if (!self || self.id !== employee.id) {
          throw new ForbiddenException('You can only record your own attendance');
        }
      }

      // Device clocks drift. Correct with the known offset rather than trusting either
      // the device or the server blindly.
      const reported = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const occurredAt = new Date(reported.getTime() - (device?.clockSkewSeconds ?? 0) * 1000);

      // A punch far in the future is a broken device clock, not a time traveller.
      if (occurredAt.getTime() > Date.now() + 10 * 60_000) {
        throw new BadRequestException('That device clock is wrong — its time is in the future');
      }

      let outsideGeofence = false;
      if (input.lat !== undefined && input.lng !== undefined) {
        const branch = await tx.branch.findUniqueOrThrow({
          where: { id: input.branchId },
          select: { lat: true, lng: true, geofenceRadiusM: true },
        });
        if (branch.lat !== null && branch.lng !== null) {
          const metres = distanceMetres(
            { lat: branch.lat, lng: branch.lng },
            { lat: input.lat, lng: input.lng },
          );
          // Accuracy is added to the radius: a ±60 m fix cannot prove you were outside
          // a 100 m fence.
          outsideGeofence = metres > branch.geofenceRadiusM + (input.accuracyM ?? 0);
        }
      }

      const event = await tx.attendanceEvent.create({
        data: {
          tenantId,
          branchId: input.branchId,
          employeeId: employee.id,
          direction: input.direction,
          source: input.source,
          deviceId: device?.id,
          occurredAt,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          outsideGeofence,
          photoKey: input.photoKey,
          rawPayload: input.rawPayload as never,
          byUserId: actor?.userId,
        },
      });

      if (device) {
        await tx.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      }

      const day = await this.rebuildDay(tx, employee.id, businessDate(occurredAt));

      return {
        event: { id: event.id, direction: event.direction, occurredAt: event.occurredAt, outsideGeofence },
        employee: { id: employee.id, name: employee.name },
        day,
      };
    });
  }

  /**
   * Recomputes one employee-day from the event stream. Idempotent, which is what makes
   * importing a week of missed punches from a device CSV a non-event.
   *
   * Punches are paired in order: IN, OUT, IN, OUT. An unpaired trailing IN before the
   * end of the day, or an OUT with no IN, produces NEEDS_REVIEW with a reason rather
   * than a plausible-looking wrong number. Silently guessing is how payroll disputes
   * start.
   */
  async rebuildDay(tx: Tx, employeeId: string, workDate: Date) {
    const tenantId = await currentTenant(tx);

    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { branchId: true, weeklyOffDay: true },
    });

    // `workDate` is UTC midnight standing for an IST calendar date, so the day actually
    // begins 5h30 earlier in UTC. Getting this wrong silently drops every punch made
    // before 05:30 IST — which is most of a kitchen's morning shift.
    const dayStart = new Date(workDate.getTime() - IST_OFFSET_MINUTES * 60_000);
    // The window runs to 06:00 the next morning so a late shift belongs to the day it
    // started, not to the day it ended.
    const dayEnd = new Date(dayStart.getTime() + 30 * 3_600_000);

    const events = await tx.attendanceEvent.findMany({
      where: { employeeId, isVoided: false, occurredAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { occurredAt: 'asc' },
    });

    const shift = await this.shiftFor(tx, employeeId, workDate);
    const holiday = await tx.holiday.findFirst({
      where: {
        date: workDate,
        OR: [{ branchId: null }, { branchId: employee.branchId }],
      },
    });
    const leave = await tx.leaveRequest.findFirst({
      where: { employeeId, status: 'APPROVED', fromDate: { lte: workDate }, toDate: { gte: workDate } },
    });

    let workedMinutes = 0;
    let firstInAt: Date | null = null;
    let lastOutAt: Date | null = null;
    let needsReviewReason: string | null = null;
    let openIn: Date | null = null;

    for (const e of events) {
      if (e.direction === 'IN') {
        if (openIn) {
          needsReviewReason = 'Two punch-ins with no punch-out between them';
        }
        openIn = e.occurredAt;
        firstInAt ??= e.occurredAt;
      } else {
        if (!openIn) {
          needsReviewReason ??= 'A punch-out with no matching punch-in';
          continue;
        }
        workedMinutes += minutesBetween(openIn, e.occurredAt);
        lastOutAt = e.occurredAt;
        openIn = null;
      }
    }
    if (openIn) {
      needsReviewReason ??= 'Punched in but never punched out';
    }

    const breakMinutes = shift?.breakMinutes ?? 0;
    const netMinutes = Math.max(0, workedMinutes - breakMinutes);
    const fullDay = shift?.fullDayMinutes ?? 480;

    let lateMinutes = 0;
    let earlyOutMinutes = 0;
    if (shift && firstInAt) {
      const expectedIn = this.timeOn(workDate, shift.startTime);
      lateMinutes = Math.max(0, minutesBetween(expectedIn, firstInAt) - shift.graceMinutes);
    }
    if (shift && lastOutAt) {
      const expectedOut = this.timeOn(workDate, shift.endTime, shift.startTime > shift.endTime);
      earlyOutMinutes = Math.max(0, minutesBetween(lastOutAt, expectedOut));
    }

    let status: AttendanceStatus;
    if (needsReviewReason) status = 'NEEDS_REVIEW';
    else if (events.length === 0 && holiday) status = 'HOLIDAY';
    else if (events.length === 0 && leave) status = 'LEAVE';
    else if (events.length === 0 && employee.weeklyOffDay === workDate.getUTCDay()) status = 'WEEKLY_OFF';
    else if (events.length === 0) status = 'ABSENT';
    else if (netMinutes >= fullDay * 0.75) status = 'PRESENT';
    else if (netMinutes >= fullDay * 0.4) status = 'HALF_DAY';
    else status = 'NEEDS_REVIEW';

    if (status === 'NEEDS_REVIEW' && !needsReviewReason) {
      needsReviewReason = `Only ${netMinutes} minutes recorded against a ${fullDay}-minute shift`;
    }

    const existing = await tx.attendanceDay.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });

    // A day already paid by an approved payroll run is frozen. History must not shift
    // under a payslip someone has been handed.
    if (existing?.lockedByPayrollRunId) return existing;

    const overtimeMinutes = Math.max(0, netMinutes - fullDay);

    return tx.attendanceDay.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: {
        tenantId,
        branchId: employee.branchId,
        employeeId,
        workDate,
        shiftId: shift?.id,
        firstInAt,
        lastOutAt,
        workedMinutes: netMinutes,
        breakMinutes,
        overtimeMinutes,
        lateMinutes,
        earlyOutMinutes,
        status,
        needsReviewReason,
      },
      update: {
        shiftId: shift?.id,
        firstInAt,
        lastOutAt,
        workedMinutes: netMinutes,
        breakMinutes,
        overtimeMinutes,
        lateMinutes,
        earlyOutMinutes,
        status,
        needsReviewReason,
      },
    });
  }

  /** Manager correction. The raw events stay; the derived day is overridden and audited. */
  async correct(input: {
    employeeId: string;
    workDate: string;
    firstInAt?: string | null;
    lastOutAt?: string | null;
    status?: AttendanceStatus;
    reason: string;
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const workDate = new Date(`${input.workDate}T00:00:00.000Z`);
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: input.employeeId },
        select: { branchId: true },
      });

      const before = await tx.attendanceDay.findUnique({
        where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
      });
      if (before?.lockedByPayrollRunId) {
        throw new BadRequestException('This day has already been paid and cannot be changed');
      }

      const firstInAt = input.firstInAt === undefined ? before?.firstInAt ?? null : input.firstInAt ? new Date(input.firstInAt) : null;
      const lastOutAt = input.lastOutAt === undefined ? before?.lastOutAt ?? null : input.lastOutAt ? new Date(input.lastOutAt) : null;
      const shift = await this.shiftFor(tx, input.employeeId, workDate);
      const workedMinutes =
        firstInAt && lastOutAt
          ? Math.max(0, minutesBetween(firstInAt, lastOutAt) - (shift?.breakMinutes ?? 0))
          : 0;
      const fullDay = shift?.fullDayMinutes ?? 480;

      const after = await tx.attendanceDay.upsert({
        where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
        create: {
          tenantId,
          branchId: employee.branchId,
          employeeId: input.employeeId,
          workDate,
          shiftId: shift?.id,
          firstInAt,
          lastOutAt,
          workedMinutes,
          overtimeMinutes: Math.max(0, workedMinutes - fullDay),
          status: input.status ?? 'PRESENT',
          needsReviewReason: null,
          approvedByUserId: TenantContext.actor()?.userId,
          approvedAt: new Date(),
          note: input.reason,
        },
        update: {
          firstInAt,
          lastOutAt,
          workedMinutes,
          overtimeMinutes: Math.max(0, workedMinutes - fullDay),
          status: input.status ?? before?.status ?? 'PRESENT',
          needsReviewReason: null,
          approvedByUserId: TenantContext.actor()?.userId,
          approvedAt: new Date(),
          note: input.reason,
        },
      });

      await this.audit.log(tx, {
        action: 'ATTENDANCE_CORRECTED',
        entity: 'AttendanceDay',
        entityId: after.id,
        branchId: employee.branchId,
        before: before ?? undefined,
        after: { ...after, reason: input.reason },
      });
      return after;
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async today(branchId: string) {
    return this.db.run(async (tx) => {
      const workDate = businessDate(new Date());
      const employees = await tx.employee.findMany({
        where: { branchId, isActive: true },
        select: { id: true, name: true, employeeCode: true, roleType: true },
        orderBy: { name: 'asc' },
      });
      const days = await tx.attendanceDay.findMany({ where: { branchId, workDate } });
      const byEmployee = new Map(days.map((d) => [d.employeeId, d]));

      return employees.map((e) => {
        const day = byEmployee.get(e.id);
        return {
          employee: e,
          status: day?.status ?? 'ABSENT',
          firstInAt: day?.firstInAt ?? null,
          lastOutAt: day?.lastOutAt ?? null,
          workedMinutes: day?.workedMinutes ?? 0,
          overtimeMinutes: day?.overtimeMinutes ?? 0,
          lateMinutes: day?.lateMinutes ?? 0,
          needsReviewReason: day?.needsReviewReason ?? null,
          isIn: !!day?.firstInAt && !day?.lastOutAt,
        };
      });
    });
  }

  async range(branchId: string, from: string, to: string, employeeId?: string) {
    return this.db.run((tx) =>
      tx.attendanceDay.findMany({
        where: {
          branchId,
          ...(employeeId ? { employeeId } : {}),
          workDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        include: { employee: { select: { name: true, employeeCode: true, roleType: true } } },
        orderBy: [{ workDate: 'desc' }, { employee: { name: 'asc' } }],
      }),
    );
  }

  async needsReview(branchId: string) {
    return this.db.run((tx) =>
      tx.attendanceDay.findMany({
        where: { branchId, status: 'NEEDS_REVIEW', lockedByPayrollRunId: null },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { workDate: 'desc' },
        take: 100,
      }),
    );
  }

  async eventsFor(employeeId: string, workDate: string) {
    return this.db.run((tx) =>
      tx.attendanceEvent.findMany({
        where: {
          employeeId,
          occurredAt: {
            gte: new Date(new Date(`${workDate}T00:00:00Z`).getTime() - IST_OFFSET_MINUTES * 60_000),
            lt: new Date(
              new Date(`${workDate}T00:00:00Z`).getTime() - IST_OFFSET_MINUTES * 60_000 + 30 * 3_600_000,
            ),
          },
        },
        include: { device: { select: { code: true, name: true, kind: true } } },
        orderBy: { occurredAt: 'asc' },
      }),
    );
  }

  // ─── Devices & credentials (ready for phase-3 hardware) ───────────────────

  /**
   * Registers a punch device and returns its shared secret **once**. The device signs
   * its payloads with HMAC-SHA256; we store only the hash. This is the entire
   * "hardware integration" surface — an NFC reader is just a client that knows a secret.
   */
  /**
   * The punch devices registered at a branch.
   *
   * Deliberately does not return the secret — it is stored hashed and was shown once at
   * registration. A device whose secret was lost is re-registered, not recovered, which is
   * the same rule as any other credential in the system.
   */
  async listDevices(branchId: string) {
    return this.db.run((tx) =>
      tx.attendanceDevice.findMany({
        where: { branchId },
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          location: true,
          lastSeenAt: true,
          clockSkewSeconds: true,
          isActive: true,
          createdAt: true,
          _count: { select: { events: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async registerDevice(input: { branchId: string; code: string; name: string; kind: PunchInput['source']; location?: string }) {
    const secret = randomToken(32);
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const device = await tx.attendanceDevice.create({
        data: {
          tenantId,
          branchId: input.branchId,
          code: input.code,
          name: input.name,
          kind: input.kind as never,
          location: input.location,
          secretHash: sha256(secret),
        },
      });
      await this.audit.log(tx, {
        action: 'ATTENDANCE_DEVICE_REGISTERED',
        entity: 'AttendanceDevice',
        entityId: device.id,
        branchId: input.branchId,
        after: { code: input.code, kind: input.kind },
      });
      return {
        device: { id: device.id, code: device.code, name: device.name, kind: device.kind },
        /** Shown once. Flash it onto the device; it cannot be retrieved again. */
        secret,
        exampleSignature: hmacSha256(secret, '{"example":"payload"}'),
      };
    });
  }

  async issueCredential(input: {
    employeeId: string;
    type: 'PIN' | 'NFC_CARD' | 'RFID_FOB' | 'MOBILE_DEVICE' | 'BIOMETRIC_TEMPLATE_REF';
    identifier: string;
    pin?: string;
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const { hashPassword } = await import('../../common/auth/crypto');
      const credential = await tx.employeeCredential.create({
        data: {
          tenantId,
          employeeId: input.employeeId,
          type: input.type,
          identifier: input.identifier,
          secretHash: input.pin ? await hashPassword(input.pin) : null,
        },
      });
      await this.audit.log(tx, {
        action: 'CREDENTIAL_ISSUED',
        entity: 'EmployeeCredential',
        entityId: credential.id,
        after: { employeeId: input.employeeId, type: input.type },
      });
      return { id: credential.id, type: credential.type, identifier: credential.identifier };
    });
  }

  async revokeCredential(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const credential = await tx.employeeCredential.update({
        where: { id },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      await this.audit.log(tx, {
        action: 'CREDENTIAL_REVOKED',
        entity: 'EmployeeCredential',
        entityId: id,
        after: { reason },
      });
      return credential;
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async resolveEmployee(tx: Tx, input: PunchInput) {
    if (input.employeeId) {
      const employee = await tx.employee.findFirst({
        where: { id: input.employeeId, branchId: input.branchId, isActive: true },
      });
      if (!employee) throw new BadRequestException('Unknown employee at this branch');
      if (input.pin) await this.checkPin(tx, employee.id, input.pin);
      return employee;
    }

    if (!input.credentialType || !input.credentialIdentifier) {
      throw new BadRequestException('Identify the employee, by id or by credential');
    }

    // A QR punch identifies the *branch*; the employee still has to say who they are.
    if (input.credentialType === 'QR_TOKEN') {
      throw new BadRequestException('A QR scan also needs the employee id or a PIN');
    }

    const credential = await tx.employeeCredential.findFirst({
      where: { type: input.credentialType, identifier: input.credentialIdentifier, revokedAt: null },
      include: { employee: true },
    });
    if (!credential || !credential.employee.isActive) {
      throw new ForbiddenException('That card is not recognised');
    }
    if (credential.secretHash) {
      if (!input.pin) throw new BadRequestException('PIN required');
      if (!(await verifyPassword(credential.secretHash, input.pin))) {
        throw new ForbiddenException('Wrong PIN');
      }
    }
    return credential.employee;
  }

  private async checkPin(tx: Tx, employeeId: string, pin: string): Promise<void> {
    const credential = await tx.employeeCredential.findFirst({
      where: { employeeId, type: 'PIN', revokedAt: null },
    });
    if (!credential?.secretHash) return; // No PIN issued yet — nothing to check.
    if (!(await verifyPassword(credential.secretHash, pin))) throw new ForbiddenException('Wrong PIN');
  }

  /** The shift assigned to this employee on this date, honouring the day-of-week filter. */
  private async shiftFor(tx: Tx, employeeId: string, workDate: Date) {
    const assignment = await tx.shiftAssignment.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      include: { shift: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!assignment) return null;
    if (assignment.daysOfWeek.length > 0 && !assignment.daysOfWeek.includes(workDate.getUTCDay())) {
      return null;
    }
    return assignment.shift;
  }

  /** "09:00" on a given business date, in IST, as a UTC instant. */
  private timeOn(workDate: Date, hhmm: string, nextDay = false): Date {
    const [h, m] = hhmm.split(':').map(Number);
    const base = new Date(workDate.getTime() + (nextDay ? 86_400_000 : 0));
    return new Date(base.getTime() + (h! * 60 + m! - IST_OFFSET_MINUTES) * 60_000);
  }
}
