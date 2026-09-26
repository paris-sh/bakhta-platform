-- 0018_claim_credentials.up.sql
-- Purpose: hashed guest bearer credential (Claim Token digest only — the raw token is never
-- stored, queued, or logged anywhere). The global unique index on token_digest is the final
-- collision/race-condition protection: generation retries only on a unique-violation, never
-- a SELECT-before-INSERT check.

CREATE TABLE claim_credentials (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id               UUID NOT NULL REFERENCES tickets (id) ON DELETE RESTRICT,
  token_digest            sha256_digest NOT NULL,
  status                  credential_status_enum NOT NULL DEFAULT 'ACTIVE',
  replaces_credential_id  UUID REFERENCES claim_credentials (id) ON DELETE RESTRICT,
  created_reason          credential_reason_enum NOT NULL DEFAULT 'INITIAL',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at                 TIMESTAMPTZ,
  rotated_at              TIMESTAMPTZ,
  revoked_at              TIMESTAMPTZ,
  revocation_reason       TEXT,
  CONSTRAINT uq_claim_credentials_token_digest UNIQUE (token_digest),
  CONSTRAINT uq_claim_credentials_id_ticket UNIQUE (id, ticket_id),
  CONSTRAINT ck_claim_credentials_revocation_reason CHECK (
    revoked_at IS NULL OR revocation_reason IS NOT NULL
  ),
  CONSTRAINT ck_claim_credentials_used_at CHECK (
    (status = 'USED') = (used_at IS NOT NULL)
  ),
  CONSTRAINT ck_claim_credentials_rotated_at CHECK (
    (status = 'ROTATED') = (rotated_at IS NOT NULL)
  ),
  CONSTRAINT ck_claim_credentials_revoked_at CHECK (
    (status = 'REVOKED') = (revoked_at IS NOT NULL)
  )
);

-- Appendix Key PostgreSQL Constraints: one_active_claim_token_per_ticket
CREATE UNIQUE INDEX one_active_claim_token_per_ticket
  ON claim_credentials (ticket_id) WHERE status = 'ACTIVE';

CREATE INDEX ix_claim_credentials_ticket ON claim_credentials (ticket_id);

COMMENT ON TABLE claim_credentials IS 'Hashed guest bearer credential. token_digest is a SHA-256 digest (BYTEA, 32 bytes); the raw token is generated in memory, delivered once, and never persisted, queued, or logged.';
COMMENT ON COLUMN claim_credentials.token_digest IS 'SHA-256 digest of the raw Claim Token. Lookup hashes the submitted token then queries this unique index.';
