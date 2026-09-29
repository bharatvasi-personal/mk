import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TenantContext, type RequestContext } from '../tenant/tenant-context';
import { TenantDb } from '../prisma/tenant-db.service';

/**
 * Establishes the per-request AsyncLocalStorage context before anything else runs.
 *
 * Tenant resolution happens here, *before* authentication, because unauthenticated
 * requests need it too: the public menu, the login endpoint, and the customer OTP
 * flow are all tenant-scoped. Resolution is by `X-Tenant` header (or `?tenant=`),
 * not by hostname, so the same deployment serves a custom domain, a subdomain and a
 * mobile app with one code path.
 *
 * The context object is mutable: AuthGuard fills in `actor` after verifying the JWT.
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  /** Slug → id. Tenants are created roughly never, so a plain Map is the right cache. */
  private readonly slugCache = new Map<string, string>();

  constructor(private readonly db: TenantDb) {}

  async use(req: FastifyRequest['raw'], _res: FastifyReply['raw'], next: () => void): Promise<void> {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const header = (name: string): string | undefined => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };

    const requestId = header('x-request-id') ?? randomUUID();
    const slug = header('x-tenant') ?? this.slugFromQuery(req.url) ?? process.env.DEFAULT_TENANT_SLUG ?? 'mithilakitchen';

    const ctx: RequestContext = {
      requestId,
      tenantId: await this.resolveTenant(slug),
      tenantSlug: slug,
      ip: header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.socket?.remoteAddress,
      userAgent: header('user-agent'),
    };

    TenantContext.run(ctx, () => next());
  }

  private slugFromQuery(url?: string): string | undefined {
    if (!url) return undefined;
    const q = url.indexOf('?');
    if (q < 0) return undefined;
    return new URLSearchParams(url.slice(q + 1)).get('tenant') ?? undefined;
  }

  private async resolveTenant(slug: string): Promise<string> {
    const cached = this.slugCache.get(slug);
    if (cached) return cached;

    // No tenant scope exists yet, by definition, so row-level security would hide the
    // tenants table from us. `resolve_tenant_by_slug` is a narrow SECURITY DEFINER
    // function that returns only an id — see prisma/sql/02_rls.sql.
    const rows = await this.db.runWithoutTenantScope('resolve tenant by slug before auth', (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`SELECT public.resolve_tenant_by_slug(${slug}) AS id`,
    );
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException(`Unknown tenant "${slug}"`);
    this.slugCache.set(slug, id);
    return id;
  }
}
