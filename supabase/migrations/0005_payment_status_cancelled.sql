-- Track cancelled (Razorpay modal dismissed) separately from failed (signature
-- invalid / card declined), and capture why, so admin can see both in a
-- "payment issues" view instead of mixed into the normal order list.

alter table public.orders
  add column if not exists payment_failure_reason text;

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'cancelled'));
