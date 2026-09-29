import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { uuid } from '@mk/shared';
import { ForbiddenException } from '@nestjs/common';
import { CurrentActor, RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import type { RequestActor } from '../../common/tenant/tenant-context';
import { ImportsService, type ImportEntity } from './imports.service';

const ENTITIES = ['inventory', 'menu', 'vendors', 'employees'] as const;

const importBodySchema = z.object({
  branchId: uuid,
  /** The file's text, read in the browser. 2 MB is ~20,000 rows of inventory. */
  csv: z.string().min(1).max(2_000_000),
});

@ApiTags('import')
@Controller('import')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('entities')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'What can be imported, and the columns each file needs' })
  entities() {
    return this.imports.describe();
  }

  @Get(':entity/template')
  @RequirePermissions('inventory:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'A CSV template with the right headers and a worked example row' })
  template(@Param('entity') entity: string) {
    return this.imports.template(this.assertEntity(entity));
  }

  @Post(':entity/preview')
  @ApiOperation({
    summary: 'Validate a file without changing anything',
    description:
      'Reports every problem in the file at once. An importer that stops at the first ' +
      'bad row makes someone fix a fifty-row file fifty times.',
  })
  preview(
    @Param('entity') entity: string,
    @Body(zodBody(importBodySchema)) body: z.infer<typeof importBodySchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const kind = this.assertEntity(entity);
    this.assertPermission(kind, actor, body.branchId);
    return this.imports.preview(kind, body.csv, body.branchId);
  }

  @Post(':entity/commit')
  @ApiOperation({ summary: 'Apply the file. All rows or none.' })
  commit(
    @Param('entity') entity: string,
    @Body(zodBody(importBodySchema)) body: z.infer<typeof importBodySchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    const kind = this.assertEntity(entity);
    this.assertPermission(kind, actor, body.branchId);
    return this.imports.commit(kind, body.csv, body.branchId);
  }

  private assertEntity(value: string): ImportEntity {
    if (!(ENTITIES as readonly string[]).includes(value)) {
      throw new ForbiddenException(`Cannot import "${value}"`);
    }
    return value as ImportEntity;
  }

  /**
   * Each entity carries its own permission, checked here rather than by a decorator
   * because the required permission depends on the URL parameter — a manager who may
   * edit the menu should not gain the ability to bulk-create staff.
   */
  private assertPermission(entity: ImportEntity, actor: RequestActor, branchId: string): void {
    const required = ImportsService.SPECS[entity].permission;
    if (!actor.permissions.has(required as never)) {
      throw new ForbiddenException(`Importing ${entity} requires "${required}"`);
    }
    void branchId;
  }
}
