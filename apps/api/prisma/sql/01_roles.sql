-- Database roles.
--
-- Two roles on purpose:
--   mk_owner : owns the schema, runs migrations. Never used by the running app.
--   mk_app   : what the API connects as. No SUPERUSER, no BYPASSRLS, so row-level
--              security actually applies to it.
--
-- Run as a superuser once per database. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mk_app') THEN
    EXECUTE format('CREATE ROLE mk_app LOGIN PASSWORD %L', current_setting('mk.app_password', true));
  END IF;
END $$;

-- Explicitly strip the two attributes that would silently defeat tenant isolation.
ALTER ROLE mk_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- GRANT ... ON DATABASE needs a literal name, so it goes through format().
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO mk_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO mk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mk_app;

-- Tables created by future migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mk_app;
