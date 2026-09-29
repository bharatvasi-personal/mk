-- Reporting helpers kept in SQL because this is what SQL is for.

-- On-hand stock straight from the ledger. `branch_inventory_items.on_hand_qty` is a
-- cache of this; if the two ever disagree, this view wins and the reconciliation job
-- repairs the cache.
CREATE OR REPLACE VIEW public.v_stock_on_hand AS
SELECT
  l.tenant_id,
  l.branch_id,
  l.inventory_item_id,
  SUM(l.qty_delta)                                         AS on_hand_qty,
  SUM(CASE WHEN l.reason = 'PURCHASE_RECEIPT' THEN l.qty_delta ELSE 0 END)      AS purchased_qty,
  SUM(CASE WHEN l.reason = 'SALE_CONSUMPTION' THEN -l.qty_delta ELSE 0 END)     AS consumed_qty,
  SUM(CASE WHEN l.reason IN ('WASTAGE','SPOILAGE') THEN -l.qty_delta ELSE 0 END) AS wasted_qty,
  SUM(CASE WHEN l.reason = 'COUNT_ADJUSTMENT' THEN l.qty_delta ELSE 0 END)      AS adjusted_qty,
  MAX(l.occurred_at)                                       AS last_movement_at
FROM public.stock_ledger_entries l
GROUP BY l.tenant_id, l.branch_id, l.inventory_item_id;

-- Module 4 in one view: bought vs should-have-used vs wasted, per item, per period.
-- The physical count comes from stock_count_lines and is joined at query time.
CREATE OR REPLACE FUNCTION public.f_stock_variance(
  p_tenant uuid, p_branch uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (
  inventory_item_id uuid,
  opening_qty numeric,
  purchased_qty numeric,
  consumed_qty numeric,
  declared_waste_qty numeric,
  closing_expected_qty numeric
) AS $$
  SELECT
    i.id,
    COALESCE((SELECT SUM(qty_delta) FROM public.stock_ledger_entries l0
              WHERE l0.branch_id = p_branch AND l0.inventory_item_id = i.id
                AND l0.occurred_at < p_from), 0),
    COALESCE(SUM(CASE WHEN l.reason = 'PURCHASE_RECEIPT' THEN l.qty_delta END), 0),
    COALESCE(SUM(CASE WHEN l.reason = 'SALE_CONSUMPTION' THEN -l.qty_delta END), 0),
    COALESCE(SUM(CASE WHEN l.reason IN ('WASTAGE','SPOILAGE','STAFF_MEAL') THEN -l.qty_delta END), 0),
    COALESCE((SELECT SUM(qty_delta) FROM public.stock_ledger_entries l1
              WHERE l1.branch_id = p_branch AND l1.inventory_item_id = i.id
                AND l1.occurred_at <= p_to), 0)
  FROM public.inventory_items i
  LEFT JOIN public.stock_ledger_entries l
    ON l.inventory_item_id = i.id
   AND l.branch_id = p_branch
   AND l.occurred_at >= p_from
   AND l.occurred_at <= p_to
  WHERE i.tenant_id = p_tenant
  GROUP BY i.id;
$$ LANGUAGE sql STABLE;

-- Vendor outstanding balance, used by the payables screen.
CREATE OR REPLACE VIEW public.v_vendor_balance AS
SELECT
  v.tenant_id,
  v.id AS vendor_id,
  v.name,
  v.credit_days,
  COALESCE(SUM(vi.total_minor - vi.paid_minor), 0)::bigint AS outstanding_minor,
  COALESCE(SUM(CASE WHEN vi.due_on < CURRENT_DATE THEN vi.total_minor - vi.paid_minor ELSE 0 END), 0)::bigint AS overdue_minor,
  MIN(CASE WHEN vi.status <> 'PAID' THEN vi.due_on END) AS next_due_on
FROM public.vendors v
LEFT JOIN public.vendor_invoices vi
  ON vi.vendor_id = v.id AND vi.status NOT IN ('PAID', 'CANCELLED')
GROUP BY v.tenant_id, v.id, v.name, v.credit_days;

-- Indexes that the report queries actually need and that Prisma does not express.
CREATE INDEX IF NOT EXISTS idx_orders_settled_day
  ON public.orders (branch_id, (settled_at AT TIME ZONE 'Asia/Kolkata'))
  WHERE status = 'SETTLED';

CREATE INDEX IF NOT EXISTS idx_payments_day_tender
  ON public.payments (tenant_id, (received_at AT TIME ZONE 'Asia/Kolkata'), tender);
