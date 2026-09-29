import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { LegalDocumentInput } from '@mk/shared';
import { RENEWABLE_DOCUMENT_CATEGORIES } from '@mk/shared';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationService } from '../../common/notifications/notification.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { StorageService } from '../../common/storage/storage.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { currentTenant } from '../menu/menu.service';

/** Reminder ladder. Escalating, because the failure mode is a sealed shop. */
const REMINDER_OFFSETS = [60, 30, 14, 7, 3, 1, 0];

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class LegalService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
  ) {}

  /**
   * Step 1 of upload: the browser gets a short-lived presigned PUT URL and sends the
   * bytes straight to object storage. The API never handles a 12 MB scan of a rent
   * agreement, which keeps a Node process free and the memory profile flat.
   */
  async presignUpload(fileName: string, mimeType: string) {
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new ForbiddenException(
        'Only PDF, JPEG, PNG, WebP and DOCX files can be stored in the document vault',
      );
    }
    const tenantId = TenantContext.tenantId();
    const key = this.storage.buildKey(tenantId, 'legal', fileName);
    return { key, uploadUrl: await this.storage.presignUpload(key, mimeType), expiresInSeconds: 900 };
  }

  /** Step 2: record the metadata and materialise the reminder ladder. */
  async create(
    input: LegalDocumentInput & {
      fileKey: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: number;
      checksumSha256?: string;
    },
  ) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);

      // Verify what actually landed in the bucket rather than trusting the client's
      // claim about it. The file we may one day need is a partnership deed.
      let checksum = input.checksumSha256;
      if (!checksum) {
        const bytes = await this.storage.getBuffer(input.fileKey);
        checksum = createHash('sha256').update(bytes).digest('hex');
      }

      const doc = await tx.legalDocument.create({
        data: {
          tenantId,
          branchId: input.branchId,
          employeeId: input.employeeId,
          category: input.category,
          title: input.title,
          documentNumber: input.documentNumber,
          issuingAuthority: input.issuingAuthority,
          issuedOn: input.issuedOn ? new Date(input.issuedOn) : null,
          expiresOn: input.expiresOn ? new Date(input.expiresOn) : null,
          renewalLeadDays: input.renewalLeadDays,
          renewalFeeMinor: input.renewalFeeMinor,
          supersedesDocumentId: input.supersedesDocumentId,
          fileKey: input.fileKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes,
          checksumSha256: checksum,
          tags: input.tags,
          notes: input.notes,
          uploadedByUserId: TenantContext.actor()?.userId,
        },
      });

      if (doc.expiresOn) await this.materialiseReminders(tx, doc.id, doc.expiresOn, doc.renewalLeadDays);

      // A renewal supersedes rather than replaces: last year's FSSAI certificate is the
      // proof of continuity you will be asked for.
      if (input.supersedesDocumentId) {
        await tx.legalDocument.update({
          where: { id: input.supersedesDocumentId },
          data: { isArchived: true },
        });
      }

      await this.audit.log(tx, {
        action: 'LEGAL_DOCUMENT_UPLOADED',
        entity: 'LegalDocument',
        entityId: doc.id,
        branchId: doc.branchId,
        after: { category: doc.category, title: doc.title, expiresOn: doc.expiresOn },
      });

      return doc;
    });
  }

  async list(opts: { category?: string; branchId?: string; includeArchived?: boolean } = {}) {
    return this.db.run(async (tx) => {
      const docs = await tx.legalDocument.findMany({
        where: {
          ...(opts.category ? { category: opts.category as never } : {}),
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
          ...(opts.includeArchived ? {} : { isArchived: false }),
        },
        include: {
          branch: { select: { id: true, name: true } },
          employee: { select: { id: true, name: true } },
          reminders: { where: { sentAt: { not: null } }, orderBy: { dueOn: 'desc' }, take: 1 },
        },
        orderBy: [{ expiresOn: 'asc' }, { category: 'asc' }],
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return docs.map((d) => {
        const daysToExpiry =
          d.expiresOn === null
            ? null
            : Math.floor((d.expiresOn.getTime() - today.getTime()) / 86_400_000);
        return {
          ...d,
          // No file key or URL in a list response. Downloads are a separate, logged action.
          fileKey: undefined,
          daysToExpiry,
          status:
            daysToExpiry === null
              ? 'NO_EXPIRY'
              : daysToExpiry < 0
                ? 'EXPIRED'
                : daysToExpiry <= d.renewalLeadDays
                  ? 'EXPIRING_SOON'
                  : 'VALID',
          isRenewable: RENEWABLE_DOCUMENT_CATEGORIES.includes(d.category as never),
        };
      });
    });
  }

  /**
   * A presigned download URL, valid for five minutes, with the access logged.
   * A link that lives for hours is a link that gets forwarded.
   */
  async download(documentId: string) {
    return this.db.run(async (tx) => {
      const doc = await tx.legalDocument.findUniqueOrThrow({ where: { id: documentId } });
      const ctx = TenantContext.peek();

      await tx.documentAccessLog.create({
        data: {
          tenantId: doc.tenantId,
          documentId,
          userId: ctx?.actor?.userId,
          action: 'DOWNLOAD',
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
        },
      });

      return {
        url: await this.storage.presignDownload(doc.fileKey, doc.fileName),
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        expiresInSeconds: 300,
      };
    });
  }

  async accessLog(documentId: string) {
    return this.db.run((tx) =>
      tx.documentAccessLog.findMany({
        where: { documentId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  /** The compliance dashboard: what is expired, what is about to be, what is missing. */
  async complianceSummary() {
    return this.db.run(async (tx) => {
      const docs = await this.list({});
      const present = new Set(docs.map((d) => d.category));

      // Categories a single-branch food business in Telangana is expected to hold. An
      // absent document is a risk that no expiry-date query can surface.
      const expected = [
        'PARTNERSHIP_DEED',
        'FSSAI_REGISTRATION',
        'TRADE_LICENSE',
        'SHOP_ESTABLISHMENT',
        'RENT_AGREEMENT',
        'PAN_TAN',
      ] as const;

      return {
        expired: docs.filter((d) => d.status === 'EXPIRED'),
        expiringSoon: docs.filter((d) => d.status === 'EXPIRING_SOON'),
        missing: expected.filter((c) => !present.has(c)),
        total: docs.length,
      };
    });
  }

  /**
   * Called nightly by the worker. Queues every reminder that has come due.
   * Idempotent: `sentAt` is the guard, so a double run does not double-nag.
   */
  async dispatchDueReminders(): Promise<{ queued: number }> {
    return this.db.run(async (tx) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const due = await tx.documentReminder.findMany({
        where: { sentAt: null, dueOn: { lte: today } },
        include: { document: { select: { title: true, category: true, expiresOn: true, documentNumber: true } } },
      });

      const recipients = await tx.user.findMany({
        where: { isActive: true, branchRoles: { some: { role: { in: ['OWNER', 'PARTNER'] } } } },
        select: { email: true, phone: true, name: true },
      });

      let queued = 0;
      for (const reminder of due) {
        for (const r of recipients) {
          if (!r.email) continue;
          await this.notify.enqueue(
            {
              channel: 'EMAIL',
              recipient: r.email,
              template: reminder.offsetDays === 0 ? 'document-expired' : 'document-expiring',
              payload: {
                name: r.name,
                title: reminder.document.title,
                category: reminder.document.category,
                documentNumber: reminder.document.documentNumber,
                expiresOn: reminder.document.expiresOn?.toISOString().slice(0, 10),
                daysLeft: reminder.offsetDays,
              },
            },
            tx,
          );
          queued += 1;
        }
        await tx.documentReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date() } });
      }
      return { queued };
    });
  }

  private async materialiseReminders(tx: Tx, documentId: string, expiresOn: Date, leadDays: number) {
    const tenantId = await currentTenant(tx);
    const offsets = REMINDER_OFFSETS.filter((o) => o <= leadDays || o === 0);
    for (const offsetDays of offsets) {
      const dueOn = new Date(expiresOn.getTime() - offsetDays * 86_400_000);
      await tx.documentReminder.upsert({
        where: { documentId_offsetDays: { documentId, offsetDays } },
        create: { tenantId, documentId, offsetDays, dueOn },
        update: { dueOn, sentAt: null },
      });
    }
  }
}
