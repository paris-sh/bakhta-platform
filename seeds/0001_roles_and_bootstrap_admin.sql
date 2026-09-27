-- 0001_roles_and_bootstrap_admin.sql
-- Purpose: minimal prerequisite data so the game/rule-version seed (0002) has a valid
-- admin_accounts row to reference for created_by/activated_by, and so the roles table has
-- the SUPER_ADMIN/ADMIN system roles the safeguard trigger (0033) refers to by code.
--
-- SECURITY: no email, password, token, or other credential is hardcoded in this file.
--   * The bootstrap admin's identity fields (email, admin_number) are REQUIRED psql
--     variables that must be supplied from environment variables at seed time — the script
--     refuses to run without them. Example:
--
--       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--         -v bootstrap_admin_email="$BAKHTA_BOOTSTRAP_ADMIN_EMAIL" \
--         -v bootstrap_admin_number="$BAKHTA_BOOTSTRAP_ADMIN_NUMBER" \
--         -f seeds/0001_roles_and_bootstrap_admin.sql
--
--   * This script deliberately creates NO admin_credentials row. Argon2id hashing cannot be
--     done safely in plain SQL, so no SQL-only seed can produce a real credential. The
--     bootstrap admin therefore has an identity and a SUPER_ADMIN role assignment but
--     CANNOT log in — that is intentional. A separate, backend-phase secure
--     admin-init command (built once the application layer exists) computes a real
--     Argon2id hash and is the only thing that ever writes to admin_credentials for this
--     account. This is an explicit, deliberate handoff boundary between the database layer
--     and the backend layer, not an oversight.
--   * Idempotent: safe to re-run; never resets or overwrites an existing row. The bootstrap
--     admin is identified by admin_number first (stable) and email second, so changing its
--     login email later (and BAKHTA_BOOTSTRAP_ADMIN_EMAIL with it) never creates a second
--     bootstrap admin.
--   * Implementation note: psql variable interpolation (:'name') is NOT performed inside
--     dollar-quoted ($$...$$) bodies (this is documented psql behavior, to avoid clashing
--     with type casts and other uses of ':' inside function/DO-block source). Every
--     statement below that references :'bootstrap_admin_email' / :'bootstrap_admin_number'
--     is therefore plain top-level SQL, not a PL/pgSQL DO block.

\if :{?bootstrap_admin_email}
\else
  \echo 'ERROR: bootstrap_admin_email is required. Pass it via: -v bootstrap_admin_email="$BAKHTA_BOOTSTRAP_ADMIN_EMAIL"'
  DO $$ BEGIN RAISE EXCEPTION 'seeds/0001: bootstrap_admin_email psql variable was not provided'; END $$;
\endif

\if :{?bootstrap_admin_number}
\else
  \echo 'ERROR: bootstrap_admin_number is required. Pass it via: -v bootstrap_admin_number="$BAKHTA_BOOTSTRAP_ADMIN_NUMBER"'
  DO $$ BEGIN RAISE EXCEPTION 'seeds/0001: bootstrap_admin_number psql variable was not provided'; END $$;
\endif

INSERT INTO roles (code, name, is_system)
VALUES
  ('SUPER_ADMIN', 'Super Administrator', TRUE),
  ('ADMIN', 'Administrator', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Identity only — no admin_credentials row (see file header).
INSERT INTO admin_accounts (admin_number, email, status)
SELECT :'bootstrap_admin_number', :'bootstrap_admin_email', 'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM admin_accounts
  WHERE admin_number = :'bootstrap_admin_number' OR email = :'bootstrap_admin_email'
);

INSERT INTO admin_role_assignments (admin_id, role_id, assigned_by)
SELECT aa.id, r.id, aa.id
FROM admin_accounts aa
CROSS JOIN roles r
WHERE aa.id = COALESCE(
    (SELECT id FROM admin_accounts WHERE admin_number = :'bootstrap_admin_number'),
    (SELECT id FROM admin_accounts WHERE email = :'bootstrap_admin_email')
  )
  AND r.code = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM admin_role_assignments x
    WHERE x.admin_id = aa.id AND x.role_id = r.id AND x.revoked_at IS NULL
  );
