-- MithilaKitchen initial schema

create extension if not exists "pgcrypto";

-- Menu items (source of truth for today's menu; sold_out toggled by admin)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  price_paise integer not null check (price_paise > 0),
  is_veg boolean not null default true,
  sold_out boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Orders placed by customers
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique, -- short human-friendly trackable code, e.g. MK-A1B2C3
  customer_name text not null,
  customer_phone text not null,
  delivery_address text not null,
  notes text not null default '',
  status text not null default 'new' check (status in ('new', 'preparing', 'out_for_delivery', 'delivered')),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  total_paise integer not null check (total_paise >= 0),
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_order_code_idx on public.orders (order_code);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Line items for each order (denormalized name/price so historical orders stay accurate
-- even if menu items change later)
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  item_name text not null,
  unit_price_paise integer not null check (unit_price_paise > 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- Admins: rows here (keyed by Supabase Auth user id) mark a signed-in user as staff.
-- Creation of admin_users rows is done manually / via service role, never via the app.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('staff', 'owner')),
  created_at timestamptz not null default now()
);

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;

-- Anyone can read the menu (sold-out items filtered client-side / in API)
create policy "items are publicly readable" on public.items
  for select using (true);

-- Only admins can write to items
create policy "admins manage items" on public.items
  for all using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Orders and order_items are NOT directly readable/writable by anon/auth roles.
-- All customer-facing reads/writes go through server-side API routes using the
-- service role key, which bypasses RLS. This keeps order data (phone numbers,
-- addresses) from being queryable directly from the browser.
create policy "admins read orders" on public.orders
  for select using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admins update orders" on public.orders
  for update using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admins read order_items" on public.order_items
  for select using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- Non-recursive: a self-referencing subquery on admin_users here would fail
-- (Postgres can't resolve it), silently breaking every admin auth check.
create policy "admins read own admin_users row" on public.admin_users
  for select using (user_id = auth.uid());
