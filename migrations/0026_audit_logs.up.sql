-- 0026_audit_logs.up.sql
-- Purpose: append-only sensitive-event history. Per the product owner's amendment, the actor
-- uses typed nullable columns (actor_user_id, actor_admin_id, guest_identifier_hash) instead
-- of a generic actor reference; entity_type/entity_id remains a DELIBERATE polymorphic
-- exception (see README) because an audited entity can be any business record. Made
-- append-only (no UPDATE/DELETE for the application role, plus a reject-mutation trigger)
-- in 0031 — this is the table the spec is most explicit about: "Application SUPER_ADMIN
-- accounts cannot update or delete audit or override history."

CREATE TABLE audit_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type            actor_type_enum NOT NULL,
  actor_user_id         UUID REFERENCES users (id) ON DELETE RESTRICT,
  actor_admin_id        UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  guest_identifier_hash BYTEA,
  action                VARCHAR NOT NULL,
  entity_type           VARCHAR NOT NULL,
  entity_id             UUID NOT NULL,
  changed_fields        TEXT[],
  old_values            JSONB,
  new_values            JSONB,
  reason                TEXT,
  request_id            UUID,
  ip_address            INET,
  user_agent            TEXT,
  evidence              JSONB,
  severity              VARCHAR NOT NULL DEFAULT 'INFO',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_audit_logs_actor_shape CHECK (
    (actor_type = 'SYSTEM' AND actor_user_id IS NULL AND actor_admin_id IS NULL AND guest_identifier_hash IS NULL) OR
    (actor_type = 'USER'   AND actor_user_id IS NOT NULL AND actor_admin_id IS NULL AND guest_identifier_hash IS NULL) OR
    (actor_type = 'ADMIN'  AND actor_admin_id IS NOT NULL AND actor_user_id IS NULL AND guest_identifier_hash IS NULL) OR
    (actor_type = 'GUEST'  AND guest_identifier_hash IS NOT NULL AND actor_user_id IS NULL AND actor_admin_id IS NULL)
  )
);

CREATE INDEX ix_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_logs_actor_admin ON audit_logs (actor_admin_id) WHERE actor_admin_id IS NOT NULL;
CREATE INDEX ix_audit_logs_actor_user ON audit_logs (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX ix_audit_logs_created_at ON audit_logs (created_at);

COMMENT ON TABLE audit_logs IS 'Append-only. No updated_at column: entries are immutable by design. Passwords, raw Claim Tokens, one-time codes, private keys, and payment secrets must never be written to old_values/new_values/evidence.';
COMMENT ON COLUMN audit_logs.entity_type IS 'Deliberate unenforced polymorphic reference alongside entity_id (documented referential-integrity exception): an audited entity can be any business record.';
COMMENT ON COLUMN audit_logs.guest_identifier_hash IS 'Hash of a guest-identifying value (e.g. email); never the raw value.';
