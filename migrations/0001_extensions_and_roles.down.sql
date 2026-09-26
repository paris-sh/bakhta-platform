-- 0001_extensions_and_roles.down.sql
-- Safe only if no tables have been created yet (i.e. this is the last migration reverted).

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM bakhta_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM bakhta_app;

REVOKE USAGE ON SCHEMA public FROM bakhta_app;

DROP ROLE IF EXISTS bakhta_app;

-- Extensions are intentionally not dropped here: other schemas/roles in the same database
-- may depend on pgcrypto/citext. Drop manually if this is truly a fresh, isolated database.
