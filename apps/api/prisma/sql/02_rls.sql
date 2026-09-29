-- Row-level security: layer 2 of tenant isolation.
--
-- Rather than listing 60 tables (which rots the moment someone adds one), this
-- walks every table in `public` that has a `tenant_id` column and applies the same
-- policy. Re-running it after a migration picks up new tables automatically —
-- `npm run db:security` is part of the deploy.
--
-- FORCE ROW LEVEL SECURITY is the important part: without it the table owner is
-- exempt, which would quietly exclude anyone connecting as mk_owner.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.table_name);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t.table_name);
    RAISE NOTICE 'RLS enabled on %', t.table_name;
  END LOOP;
END $$;

-- The tenants table itself: a tenant may read only its own row. The pre-auth
-- lookup by slug runs as mk_owner through runWithoutTenantScope().
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON public.tenants;
CREATE POLICY tenant_self ON public.tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Bootstrap functions ─────────────────────────────────────────────────────
--
-- Three operations genuinely have to happen before a tenant scope exists:
--   1. resolving a tenant by slug, so a request can be scoped at all;
--   2. a payment webhook, which arrives from the gateway carrying no tenant;
--   3. a scheduled job, which has to enumerate tenants to iterate them.
--
-- Rather than weakening the policies or connecting as a privileged role, each is a
-- narrow SECURITY DEFINER function that returns *only* an id. The application role
-- gains no ability to read another tenant's data — only to learn which tenant a
-- known slug or a known gateway order belongs to.

CREATE OR REPLACE FUNCTION public.resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id FROM public.tenants WHERE slug = p_slug AND is_active;
$$;

CREATE OR REPLACE FUNCTION public.resolve_tenant_by_gateway_order(
  p_provider text, p_gateway_order_id text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT tenant_id FROM public.payments
  WHERE gateway_provider = p_provider AND gateway_order_id = p_gateway_order_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_active_tenants()
RETURNS TABLE (id uuid, slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, slug FROM public.tenants WHERE is_active ORDER BY slug;
$$;

REVOKE ALL ON FUNCTION public.resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_tenant_by_gateway_order(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_active_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_slug(text) TO mk_app;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_gateway_order(text, text) TO mk_app;
GRANT EXECUTE ON FUNCTION public.list_active_tenants() TO mk_app;

-- Platform metrics.
--
-- A Prometheus scrape has no tenant, and row-level security correctly hides every
-- tenant-owned row from a connection that has not declared one — so a naive metrics
-- query returns zeroes and looks like a dead shop.
--
-- This returns AGGREGATE COUNTS ONLY across all tenants. No row, name, amount or
-- identifier crosses the boundary, so an operator scraping it learns how busy the
-- platform is and nothing about anyone's business.
CREATE OR REPLACE FUNCTION public.platform_metrics()
RETURNS TABLE (
  orders_last_hour bigint,
  orders_today bigint,
  revenue_today_minor bigint,
  queued_notifications bigint,
  failed_notifications bigint,
  open_cash_sessions bigint,
  attendance_needs_review bigint,
  expired_documents bigint,
  overdue_payables_minor bigint,
  active_tenants bigint,
  active_branches bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (SELECT COUNT(*) FROM orders
       WHERE status = 'SETTLED' AND settled_at > now() - interval '1 hour'),
    (SELECT COUNT(*) FROM orders
       WHERE status = 'SETTLED'
         AND (settled_at AT TIME ZONE 'Asia/Kolkata')::date
             = (now() AT TIME ZONE 'Asia/Kolkata')::date),
    (SELECT COALESCE(SUM(total_minor), 0)::bigint FROM orders
       WHERE status = 'SETTLED'
         AND (settled_at AT TIME ZONE 'Asia/Kolkata')::date
             = (now() AT TIME ZONE 'Asia/Kolkata')::date),
    (SELECT COUNT(*) FROM notification_outbox WHERE status = 'PENDING'),
    (SELECT COUNT(*) FROM notification_outbox WHERE status = 'FAILED'),
    (SELECT COUNT(*) FROM cash_sessions WHERE closed_at IS NULL),
    (SELECT COUNT(*) FROM attendance_days WHERE status = 'NEEDS_REVIEW'),
    (SELECT COUNT(*) FROM legal_documents WHERE expires_on < CURRENT_DATE AND NOT is_archived),
    (SELECT COALESCE(SUM(total_minor - paid_minor), 0)::bigint FROM vendor_invoices
       WHERE status NOT IN ('PAID','CANCELLED') AND due_on < CURRENT_DATE),
    (SELECT COUNT(*) FROM tenants WHERE is_active),
    (SELECT COUNT(*) FROM branches WHERE is_active);
$$;

REVOKE ALL ON FUNCTION public.platform_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_metrics() TO mk_app;
