import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { TenantDb } from '../prisma/tenant-db.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Makes unsafe endpoints safe to retry blindly, which is what the offline POS does.
 *
 * An `Idempotency-Key` header plus a hash of the body is recorded with the first
 * successful response. A replay of the same key with the same body returns the stored
 * response; the same key with a *different* body is a client bug and is rejected
 * rather than silently returning the wrong answer.
 *
 * Stored in Postgres rather than Redis on purpose: the guarantee must survive a Redis
 * restart, because the thing it protects is money.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
      body?: unknown;
    }>();

    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next.handle();

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return next.handle();

    const endpoint = `${req.method} ${req.url.split('?')[0]}`;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const scopedKey = `${TenantContext.tenantId()}:${key}`;

    return from(this.lookup(scopedKey)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictException(
              'This Idempotency-Key was already used with a different request body',
            );
          }
          return of(existing.responseBody);
        }
        return next.handle().pipe(
          tap((response) => {
            void this.store(scopedKey, endpoint, requestHash, response);
          }),
        );
      }),
    );
  }

  private async lookup(key: string) {
    return this.db.run((tx) =>
      tx.idempotencyRecord.findUnique({
        where: { key },
        select: { requestHash: true, responseBody: true },
      }),
    );
  }

  private async store(key: string, endpoint: string, requestHash: string, response: unknown): Promise<void> {
    try {
      await this.db.run((tx) =>
        tx.idempotencyRecord.create({
          data: {
            key,
            tenantId: TenantContext.tenantId(),
            endpoint,
            requestHash,
            statusCode: 200,
            responseBody: (response ?? null) as never,
          },
        }),
      );
    } catch {
      // A concurrent duplicate lost the race. The winner's response stands, which is
      // the correct outcome — nothing to do.
    }
  }
}
