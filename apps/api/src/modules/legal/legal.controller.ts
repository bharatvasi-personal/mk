import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { legalDocumentSchema } from '@mk/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { zodBody } from '../../common/http/zod-validation.pipe';
import { LegalService } from './legal.service';

/**
 * The document vault. Read access is `legal:read` (owner, partner, accountant);
 * downloading the actual file needs `legal:download`, which only owners and partners
 * hold — a partnership deed is not something a manager needs a copy of.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('documents')
  @RequirePermissions('legal:read')
  list(
    @Query('category') category?: string,
    @Query('branchId') branchId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.legal.list({ category, branchId, includeArchived: includeArchived === 'true' });
  }

  @Get('compliance')
  @RequirePermissions('legal:read')
  @ApiOperation({ summary: 'Expired, expiring, and missing documents in one call' })
  compliance() {
    return this.legal.complianceSummary();
  }

  @Post('upload-url')
  @RequirePermissions('legal:write')
  @ApiOperation({ summary: 'Presigned PUT URL — the browser uploads straight to storage' })
  presign(
    @Body(zodBody(z.object({ fileName: z.string().min(1).max(200), mimeType: z.string().min(3).max(120) })))
    body: { fileName: string; mimeType: string },
  ) {
    return this.legal.presignUpload(body.fileName, body.mimeType);
  }

  @Post('documents')
  @RequirePermissions('legal:write')
  create(
    @Body(
      zodBody(
        legalDocumentSchema.extend({
          fileKey: z.string().min(1).max(500),
          fileName: z.string().min(1).max(200),
          mimeType: z.string().min(3).max(120),
          fileSizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
          checksumSha256: z.string().length(64).optional(),
        }),
      ),
    )
    body: never,
  ) {
    return this.legal.create(body);
  }

  @Get('documents/:id/download')
  @RequirePermissions('legal:download')
  @ApiOperation({ summary: 'Five-minute presigned URL. Every issuance is logged.' })
  download(@Param('id') id: string) {
    return this.legal.download(id);
  }

  @Get('documents/:id/access-log')
  @RequirePermissions('audit:read')
  accessLog(@Param('id') id: string) {
    return this.legal.accessLog(id);
  }
}
