import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ROLES, uuid } from '@mk/shared';
import type { Role } from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { BranchesService } from './branches.service';

const branchSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(60),
  state: z.string().min(1).max(60),
  pincode: z.string().regex(/^\d{6}$/),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().max(20).optional(),
  gstin: z.string().max(20).optional(),
  geofenceRadiusM: z.number().int().min(20).max(1000).default(100),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  operatingHours: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('branch:read')
  @ApiOperation({ summary: 'Branches this user may see — drives the branch picker' })
  list() {
    return this.branches.listForActor();
  }

  @Get(':id')
  @RequirePermissions('branch:read')
  get(@Param('id') id: string) {
    return this.branches.get(id);
  }

  @Post()
  @RequirePermissions('branch:write')
  create(@Body(zodBody(branchSchema)) body: z.infer<typeof branchSchema>) {
    return this.branches.upsert(body);
  }

  @Put(':id')
  @RequirePermissions('branch:write')
  update(@Param('id') id: string, @Body(zodBody(branchSchema)) body: z.infer<typeof branchSchema>) {
    return this.branches.upsert(body, id);
  }

  @Post('tables')
  @RequirePermissions('branch:write')
  table(
    @Body(
      zodBody(
        z.object({
          branchId: uuid,
          label: z.string().min(1).max(20),
          seats: z.number().int().min(1).max(20).default(4),
          isActive: z.boolean().default(true),
        }),
      ),
    )
    body: { branchId: string; label: string; seats: number; isActive: boolean },
  ) {
    return this.branches.upsertTable(body);
  }
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('user:read')
  list() {
    return this.branches.listUsers();
  }

  @Post()
  @RequirePermissions('user:write')
  @ApiOperation({ summary: 'Create a staff login. Returns a one-time temporary password.' })
  create(
    @Body(
      zodBody(
        z
          .object({
            name: z.string().min(1).max(120),
            email: z.string().email().optional(),
            phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/).optional(),
            role: z.enum(ROLES),
            branchId: uuid.nullable().default(null),
            employeeId: uuid.optional(),
          })
          .refine((v) => !!v.email || !!v.phone, { message: 'Provide an e-mail or a phone number' }),
      ),
    )
    body: { name: string; email?: string; phone?: string; role: Role; branchId: string | null; employeeId?: string },
  ) {
    return this.branches.createUser(body);
  }

  @Post('grants')
  @RequirePermissions('role:grant')
  grant(
    @Body(zodBody(z.object({ userId: uuid, role: z.enum(ROLES), branchId: uuid.nullable().default(null) })))
    body: { userId: string; role: Role; branchId: string | null },
  ) {
    return this.branches.grantRole(body);
  }

  @Post('grants/:id/revoke')
  @RequirePermissions('role:grant')
  revoke(@Param('id') id: string) {
    return this.branches.revokeRole(id);
  }

  @Patch(':id/active')
  @RequirePermissions('user:write')
  setActive(
    @Param('id') id: string,
    @Body(zodBody(z.object({ isActive: z.boolean() }))) body: { isActive: boolean },
  ) {
    return this.branches.setUserActive(id, body.isActive);
  }
}
