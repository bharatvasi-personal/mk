import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/tenant-db.service';
import { TenantDb } from '../prisma/tenant-db.service';
import { TenantContext } from '../tenant/tenant-context';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Fields never written to the audit trail even if they appear in a diff.
 * The audit log is read by more people than the tables it describes.
 */
const REDACT = new Set([
  'passwordHash',
  'password',
  'totpSecret',
  'secretHash',
  'codeHash',
  'tokenHash',
  'encryptedDataKey',
  'bankAccountNumberEnc',
  'gatewaySignature',
  'pin',
]);

@Injectable()
export class AuditService {
  constructor(private readonly db: TenantDb) {}

  /**
   * Writes inside the caller's transaction, so the audit row and the change it
   * describes commit or roll back together. An audit trail that can disagree with
   * the data is worse than none, because it is trusted.
   */
  async log(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = TenantContext.peek();
    await tx.auditLog.create({
      data: {
        tenantId: ctx?.tenantId ?? (await this.tenantIdFallback(tx)),
        branchId: entry.branchId ?? null,
        userId: ctx?.actor?.userId ?? null,
        actorLabel: ctx?.actor?.name ?? 'system',
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: (redact(entry.before) as Prisma.InputJsonObject | null) ?? Prisma.DbNull,
        after: (redact(entry.after) as Prisma.InputJsonObject | null) ?? Prisma.DbNull,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
  }

  /** Convenience for a standalone entry outside an existing transaction. */
  async logStandalone(entry: AuditEntry): Promise<void> {
    await this.db.run((tx) => this.log(tx, entry));
  }

  private async tenantIdFallback(tx: Tx): Promise<string> {
    const rows = await tx.$queryRawUnsafe<{ t: string }[]>(
      `SELECT current_setting('app.tenant_id', true) AS t`,
    );
    const t = rows[0]?.t;
    if (!t) throw new Error('Cannot write an audit entry with no tenant context');
    return t;
  }
}

/** Shallow redaction of secret-bearing keys, recursing into plain objects and arrays. */
function redact(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return { value: String(value) };
  if (Array.isArray(value)) return { items: value.map((v) => redact(v)) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT.has(k)) {
      out[k] = '[redacted]';
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Only the fields that actually changed — an audit row of 40 unchanged columns is noise. */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  if (!before) return { before: {}, after };
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>) {
    const bv = before[key];
    const av = after[key];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[key] = bv;
      a[key] = av;
    }
  }
  return { before: b, after: a };
}
