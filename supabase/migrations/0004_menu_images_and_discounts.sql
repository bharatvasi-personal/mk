-- Let admins attach a sale price and a photo to each menu item.

alter table public.items
  add column if not exists image_url text,
  add column if not exists discount_price_paise integer;

alter table public.items drop constraint if exists items_discount_price_check;
alter table public.items add constraint items_discount_price_check
  check (discount_price_paise is null or (discount_price_paise > 0 and discount_price_paise < price_paise));

-- Storage bucket for menu item photos. Public read (so <img> tags work without
-- auth), writes restricted to admins.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

drop policy if exists "public read menu images" on storage.objects;
create policy "public read menu images" on storage.objects
  for select using (bucket_id = 'menu-images');

drop policy if exists "admins upload menu images" on storage.objects;
create policy "admins upload menu images" on storage.objects
  for insert with check (
    bucket_id = 'menu-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

drop policy if exists "admins update menu images" on storage.objects;
create policy "admins update menu images" on storage.objects
  for update using (
    bucket_id = 'menu-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

drop policy if exists "admins delete menu images" on storage.objects;
create policy "admins delete menu images" on storage.objects
  for delete using (
    bucket_id = 'menu-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

-- Admins already have a blanket "admins manage items" policy from 0001_init.sql
-- covering insert/update/delete on public.items, so no changes needed there.
