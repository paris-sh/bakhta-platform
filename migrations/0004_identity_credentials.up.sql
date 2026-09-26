-- 0004_identity_credentials.up.sql
-- Purpose: password credential storage, one row per account. Kept separate from the
-- identity tables so credential rotation/history can evolve independently and so a
-- credential row can be deleted/rekeyed without touching the identity record.

CREATE TABLE user_credentials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  password_hash        TEXT NOT NULL,
  password_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_credentials_user_id UNIQUE (user_id)
);

CREATE TRIGGER trg_user_credentials_set_updated_at
  BEFORE UPDATE ON user_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE user_credentials IS 'Argon2id password hash, one row per user. Never a plaintext password.';
COMMENT ON COLUMN user_credentials.password_hash IS 'Argon2id encoded hash string, not a raw password.';

CREATE TABLE admin_credentials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  password_hash        TEXT NOT NULL,
  password_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_admin_credentials_admin_id UNIQUE (admin_id)
);

CREATE TRIGGER trg_admin_credentials_set_updated_at
  BEFORE UPDATE ON admin_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE admin_credentials IS 'Argon2id password hash, one row per administrator.';
