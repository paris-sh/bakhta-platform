-- 0001_extensions_and_roles.up.sql
-- Purpose: enable required extensions and create the restricted runtime application role.
--
-- This migration must be run by a privileged owner/migrator role (e.g. the database owner
-- or a dedicated "bakhta_migrator" role granted CREATEROLE/CREATEDB as appropriate by
-- infrastructure). That owner role is never used by the running application. All tables in
-- this schema are owned by the migrator role; the application connects as bakhta_app, whose
-- privileges are restricted below and further restricted in 0031_append_only_enforcement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Restricted runtime application role. Password/authentication configuration is an
-- infrastructure responsibility handled outside migrations (e.g. ALTER ROLE ... PASSWORD
-- via a secrets-managed out-of-band step). Never embed credentials in migration files.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bakhta_app') THEN
    CREATE ROLE bakhta_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- The deploying platform grants LOGIN and a password to bakhta_app (or issues short-lived
-- credentials) outside of migrations. NOLOGIN here is a safe default for freshly created
-- roles; infrastructure enables login separately.

GRANT USAGE ON SCHEMA public TO bakhta_app;

-- Every table created from here on by the migrator role automatically grants the baseline
-- CRUD set to bakhta_app. Append-only tables have UPDATE/DELETE revoked explicitly in
-- 0031_append_only_enforcement once they exist.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bakhta_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bakhta_app;
