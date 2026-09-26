-- 0007_sessions_auth.up.sql
-- Purpose: opaque session tokens (digest-only) for both principal kinds, and login/rate-limit
-- evidence. Administrator sessions must use shorter idle/absolute policies than customer
-- sessions; that policy is enforced by the application when it issues idle_expires_at /
-- absolute_expires_at, not by a schema-level difference between the two principal kinds.

CREATE TABLE sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type        session_principal_enum NOT NULL,
  user_id               UUID REFERENCES users (id) ON DELETE RESTRICT,
  admin_id              UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  token_digest          sha256_digest NOT NULL,
  auth_version_at_issue INTEGER NOT NULL,
  status                session_status_enum NOT NULL DEFAULT 'ACTIVE',
  ip_address            INET,
  user_agent            TEXT,
  device_hash           BYTEA,
  idle_expires_at       TIMESTAMPTZ NOT NULL,
  absolute_expires_at   TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  CONSTRAINT uq_sessions_token_digest UNIQUE (token_digest),
  CONSTRAINT ck_sessions_principal_xor CHECK (
    (principal_type = 'USER'  AND user_id  IS NOT NULL AND admin_id IS NULL) OR
    (principal_type = 'ADMIN' AND admin_id IS NOT NULL AND user_id IS NULL)
  ),
  CONSTRAINT ck_sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE INDEX ix_sessions_user_active ON sessions (user_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_sessions_admin_active ON sessions (admin_id) WHERE status = 'ACTIVE';

COMMENT ON TABLE sessions IS 'Opaque bearer session. Only the SHA-256 digest of the token is stored.';
COMMENT ON COLUMN sessions.auth_version_at_issue IS 'Snapshot of users.auth_version/admin_accounts.auth_version at issue time; a mismatch means the session is stale after a forced global logout.';

CREATE TABLE auth_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type   session_principal_enum NOT NULL,
  identifier_hash  sha256_digest NOT NULL,
  result           auth_attempt_result_enum NOT NULL,
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_auth_attempts_identifier_time ON auth_attempts (identifier_hash, created_at DESC);
CREATE INDEX ix_auth_attempts_ip_time ON auth_attempts (ip_address, created_at DESC);

COMMENT ON TABLE auth_attempts IS 'Login attempt / rate-limit evidence. identifier_hash never stores a raw email; no FK to users/admin_accounts is required or attempted, since unknown identifiers must also be recorded.';
