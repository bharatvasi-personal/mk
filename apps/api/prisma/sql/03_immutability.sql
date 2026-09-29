-- Append-only and immutability guarantees, enforced by the database rather than by
-- convention. Application code can have a bug; a trigger cannot be forgotten.

CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not permitted. Record a correcting entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

-- Audit trail: a tamper-evident log is worthless if it can be edited.
DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Stock ledger: on-hand quantity is SUM(qty_delta). Editing history would make
-- every historical stock position and every food-cost figure retroactively wrong.
DROP TRIGGER IF EXISTS stock_ledger_append_only ON public.stock_ledger_entries;
CREATE TRIGGER stock_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.stock_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Document access log: who downloaded the partnership deed must not be erasable.
DROP TRIGGER IF EXISTS document_access_append_only ON public.document_access_logs;
CREATE TRIGGER document_access_append_only
  BEFORE UPDATE OR DELETE ON public.document_access_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Order status history.
DROP TRIGGER IF EXISTS order_status_append_only ON public.order_status_events;
CREATE TRIGGER order_status_append_only
  BEFORE UPDATE OR DELETE ON public.order_status_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Attendance events are raw, low-trust, immutable evidence. A correction is a new
-- event with corrects_event_id set; only the `is_voided` flag may ever change.
CREATE OR REPLACE FUNCTION public.attendance_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_events is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'is_voided' - 'reason') <> (to_jsonb(OLD) - 'is_voided' - 'reason') THEN
    RAISE EXCEPTION
      'attendance_events may only be voided, not edited. Post a correcting event instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_events_guard ON public.attendance_events;
CREATE TRIGGER attendance_events_guard
  BEFORE UPDATE OR DELETE ON public.attendance_events
  FOR EACH ROW EXECUTE FUNCTION public.attendance_event_guard();

-- Invoices: a GST invoice, once issued, is a legal document. Only the generated-PDF
-- pointer may be filled in afterwards.
CREATE OR REPLACE FUNCTION public.invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted. Issue a credit note.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'pdf_key') <> (to_jsonb(OLD) - 'pdf_key') THEN
    RAISE EXCEPTION 'Invoices are immutable. Issue a credit note to correct one.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_guard ON public.invoices;
CREATE TRIGGER invoices_guard
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_guard();

-- Cross-tenant reference guard on the highest-risk parent/child pairs. RLS already
-- makes this near-impossible; this makes it actually impossible.
CREATE OR REPLACE FUNCTION public.assert_branch_tenant() RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM public.branches WHERE id = NEW.branch_id;
  IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant reference: % row would point at a branch in another tenant',
      TG_TABLE_NAME USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_tenant_guard ON public.orders;
CREATE TRIGGER orders_tenant_guard
  BEFORE INSERT OR UPDATE OF branch_id, tenant_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assert_branch_tenant();

DROP TRIGGER IF EXISTS stock_ledger_tenant_guard ON public.stock_ledger_entries;
CREATE TRIGGER stock_ledger_tenant_guard
  BEFORE INSERT ON public.stock_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.assert_branch_tenant();
