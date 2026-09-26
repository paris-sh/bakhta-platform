-- 0011_admin_overrides.up.sql
-- Purpose: append-only record of every SUPER_ADMIN business override. entity_type/entity_id
-- is a DELIBERATE referential-integrity exception (see README "Polymorphic reference
-- exceptions"): an override can target a draw, a result, a rule version, a schedule, a
-- claim, or any other business record, so a single enforceable FK is not possible here.
-- Made append-only (no UPDATE/DELETE for the application role) in 0031.

CREATE TABLE admin_overrides (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  entity_type           VARCHAR NOT NULL,
  entity_id             UUID NOT NULL,
  action_type           VARCHAR NOT NULL,
  scope                 override_scope_enum NOT NULL,
  reason                TEXT NOT NULL,
  board_decision_reference TEXT,
  before_snapshot       JSONB NOT NULL,
  after_snapshot        JSONB NOT NULL,
  impact_snapshot       JSONB NOT NULL,
  confirmation_method   VARCHAR NOT NULL,
  effective_at          TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id            UUID NOT NULL,
  CONSTRAINT uq_admin_overrides_request_id UNIQUE (request_id)
);

CREATE INDEX ix_admin_overrides_entity ON admin_overrides (entity_type, entity_id);
CREATE INDEX ix_admin_overrides_admin ON admin_overrides (admin_id);

COMMENT ON TABLE admin_overrides IS 'Append-only SUPER_ADMIN override history. entity_type/entity_id is a deliberate unenforced polymorphic reference (documented referential-integrity exception). confirmation_method never stores the raw confirmation code.';
