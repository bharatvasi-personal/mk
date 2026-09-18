# Database setup

1. Create a Supabase project and note the project URL, anon key, and service role key.
2. Run the SQL migrations in order against your project (via the Supabase SQL editor,
   or `supabase db push` if you use the Supabase CLI):
   - `migrations/0001_init.sql` — tables, RLS policies, triggers
   - `migrations/0002_seed_menu.sql` — seeds the initial thali menu
   - `migrations/0003_fix_admin_users_rls_recursion.sql` — fixes a self-referencing
     RLS policy that silently breaks admin login (only needed if you ran migrations
     before this fix landed; new setups get the corrected policy directly from
     `0001_init.sql`)
3. Create your first admin user:
   - In the Supabase dashboard, go to **Authentication → Users → Add user** and create
     an account with an email/password for yourself (or a staff member).
   - Then run this SQL, substituting the user's UUID (copy it from the Users table):

     ```sql
     insert into public.admin_users (user_id, display_name, role)
     values ('00000000-0000-0000-0000-000000000000', 'Your Name', 'owner');
     ```

   Anyone signed in without a matching row in `admin_users` is redirected away from
   `/admin` and `/delivery` — this is what replaces the prototype's hardcoded PIN.
4. Repeat step 3 for delivery staff accounts (use `role = 'staff'`).
