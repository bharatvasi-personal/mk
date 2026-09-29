import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ATTENDANCE_SOURCES, correctAttendanceSchema, punchSchema, uuid } from '@mk/shared';
import type { AttendanceStatus } from '@prisma/client';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('punch')
  @RequirePermissions('attendance:punch:self')
  @ApiOperation({
    summary: 'Record a punch',
    description:
      'The single punch endpoint for every source. Today: QR from the wall, a PIN, or a ' +
      'manager tap. Later: an NFC reader or a biometric terminal posting the same shape ' +
      'with a device HMAC. Adding hardware is an authentication adapter, not a new endpoint.',
  })
  punch(@Body(zodBody(punchSchema)) body: z.infer<typeof punchSchema>) {
    return this.attendance.punch(body);
  }

  @Get('qr/:branchId')
  @RequirePermissions('attendance:read:all')
  @ApiOperation({ summary: 'A 90-second rotating token to render as the wall QR code' })
  qr(@Param('branchId') branchId: string) {
    return this.attendance.issueQrToken(branchId);
  }

  @Get('today/:branchId')
  @RequirePermissions('attendance:read:all')
  today(@Param('branchId') branchId: string) {
    return this.attendance.today(branchId);
  }

  @Get('range/:branchId')
  @RequirePermissions('attendance:read:all')
  range(
    @Param('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.attendance.range(branchId, from, to, employeeId);
  }

  @Get('needs-review/:branchId')
  @RequirePermissions('attendance:read:all')
  @ApiOperation({ summary: 'Days the system will not guess at — clear these before payroll' })
  needsReview(@Param('branchId') branchId: string) {
    return this.attendance.needsReview(branchId);
  }

  @Get('events/:employeeId')
  @RequirePermissions('attendance:read:all')
  events(@Param('employeeId') employeeId: string, @Query('workDate') workDate: string) {
    return this.attendance.eventsFor(employeeId, workDate);
  }

  @Post('correct')
  @RequirePermissions('attendance:correct')
  @ApiOperation({ summary: 'Override a derived day. The raw punches are never altered.' })
  correct(@Body(zodBody(correctAttendanceSchema)) body: z.infer<typeof correctAttendanceSchema>) {
    return this.attendance.correct(body as never);
  }

  // ─── Hardware readiness (unused at launch, wired for phase 3) ─────────────

  @Post('devices')
  @RequirePermissions('attendance:device:manage')
  @ApiOperation({ summary: 'Register a punch device. Returns its shared secret once.' })
  registerDevice(
    @Body(
      zodBody(
        z.object({
          branchId: uuid,
          code: z.string().min(1).max(40),
          name: z.string().min(1).max(80),
          kind: z.enum(ATTENDANCE_SOURCES),
          location: z.string().max(80).optional(),
        }),
      ),
    )
    body: { branchId: string; code: string; name: string; kind: never; location?: string },
  ) {
    return this.attendance.registerDevice(body);
  }

  @Post('credentials')
  @RequirePermissions('attendance:device:manage')
  @ApiOperation({ summary: 'Issue a PIN or NFC card to an employee' })
  issueCredential(
    @Body(
      zodBody(
        z.object({
          employeeId: uuid,
          type: z.enum(['PIN', 'NFC_CARD', 'RFID_FOB', 'MOBILE_DEVICE', 'BIOMETRIC_TEMPLATE_REF']),
          identifier: z.string().min(1).max(200),
          pin: z.string().regex(/^\d{4,6}$/).optional(),
        }),
      ),
    )
    body: { employeeId: string; type: never; identifier: string; pin?: string },
  ) {
    return this.attendance.issueCredential(body);
  }

  @Post('credentials/:id/revoke')
  @RequirePermissions('attendance:device:manage')
  revoke(
    @Param('id') id: string,
    @Body(zodBody(z.object({ reason: z.string().min(3).max(200) }))) body: { reason: string },
  ) {
    return this.attendance.revokeCredential(id, body.reason);
  }
}
