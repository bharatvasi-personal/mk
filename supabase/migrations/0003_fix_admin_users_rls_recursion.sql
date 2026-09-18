-- The original "admins read admin_users" policy queried admin_users from within
-- its own USING clause, which Postgres cannot resolve (infinite recursion) and
-- fails the query outright — silently breaking the admin login check, since
-- callers treat a failed lookup the same as "not an admin". Replace it with a
-- direct, non-recursive check: a signed-in user can read their own row.
drop policy if exists "admins read admin_users" on public.admin_users;

create policy "admins read own admin_users row" on public.admin_users
  for select using (user_id = auth.uid());
