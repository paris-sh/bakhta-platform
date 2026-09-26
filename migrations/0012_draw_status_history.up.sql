-- 0012_draw_status_history.up.sql
-- Purpose: append-only draw lifecycle transition log. Only ADMIN or SYSTEM ever drive a
-- draw transition (never a customer/guest), so the actor is a typed nullable FK per the
-- product owner's amendment, not a generic entity_type/entity_id pair.

CREATE TABLE draw_status_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id             UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  from_status         VARCHAR,
  to_status           VARCHAR NOT NULL,
  reason              TEXT,
  actor_type          actor_type_enum NOT NULL,
  actor_admin_id      UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  actor_role_snapshot VARCHAR,
  override_id         UUID REFERENCES admin_overrides (id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_draw_status_history_actor_kind CHECK (actor_type IN ('ADMIN', 'SYSTEM')),
  CONSTRAINT ck_draw_status_history_actor_xor CHECK (
    (actor_type = 'ADMIN'  AND actor_admin_id IS NOT NULL) OR
    (actor_type = 'SYSTEM' AND actor_admin_id IS NULL)
  )
);

CREATE INDEX ix_draw_status_history_draw ON draw_status_history (draw_id, created_at);

COMMENT ON TABLE draw_status_history IS 'Append-only. Records normal and SUPER_ADMIN-overridden lifecycle transitions.';
