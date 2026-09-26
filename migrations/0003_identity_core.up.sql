-- 0003_identity_core.up.sql
-- Purpose: customer and administrator account identity tables. Kept as two separate
-- identity domains per the spec (no shared "accounts" table), since roles, session
-- policy, and audit meaning differ between customers and administrators.

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_number       VARCHAR NOT NULL,
  email             CITEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  status            account_status_enum NOT NULL DEFAULT 'ACTIVE',
  auth_version      INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_user_number UNIQUE (user_number),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT ck_users_auth_version_positive CHECK (auth_version >= 1)
);

CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE users IS 'Registered customer account. Public identifiers only (user_number); id is internal.';
COMMENT ON COLUMN users.auth_version IS 'Incremented to force global logout of all sessions for this user.';

CREATE TABLE admin_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_number VARCHAR NOT NULL,
  email        CITEXT NOT NULL,
  status       account_status_enum NOT NULL DEFAULT 'ACTIVE',
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_admin_accounts_admin_number UNIQUE (admin_number),
  CONSTRAINT uq_admin_accounts_email UNIQUE (email),
  CONSTRAINT ck_admin_accounts_auth_version_positive CHECK (auth_version >= 1)
);

CREATE TRIGGER trg_admin_accounts_set_updated_at
  BEFORE UPDATE ON admin_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE admin_accounts IS 'Administrator account, entirely separate identity domain from customer users.';

-- Database-owner / infrastructure access is separate from this application identity model;
-- no table here grants database-level roles based on admin_accounts rows.
