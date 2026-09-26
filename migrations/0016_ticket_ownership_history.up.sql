-- 0016_ticket_ownership_history.up.sql
-- Purpose: append-only ownership attachment/reassignment/detachment history for tickets, per
-- the product owner's amendment. tickets.owner_user_id remains only the current projection;
-- this table is the durable record of every change and its actor. Made append-only (no
-- UPDATE/DELETE for the application role) in 0031.

CREATE TABLE ticket_ownership_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES tickets (id) ON DELETE RESTRICT,
  from_user_id   UUID REFERENCES users (id) ON DELETE RESTRICT,
  to_user_id     UUID REFERENCES users (id) ON DELETE RESTRICT,
  change_type    ownership_change_type_enum NOT NULL,
  actor_type     actor_type_enum NOT NULL,
  actor_user_id  UUID REFERENCES users (id) ON DELETE RESTRICT,
  actor_admin_id UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  reason         TEXT,
  request_id     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: a retried attach/reassign/detach request with the same request_id for the
  -- same ticket must not be recorded twice.
  CONSTRAINT uq_ticket_ownership_history_ticket_request UNIQUE (ticket_id, request_id),
  CONSTRAINT ck_ticket_ownership_history_actor_kind CHECK (actor_type IN ('SYSTEM', 'USER', 'ADMIN')),
  CONSTRAINT ck_ticket_ownership_history_actor_xor CHECK (
    (actor_type = 'SYSTEM' AND actor_user_id IS NULL AND actor_admin_id IS NULL) OR
    (actor_type = 'USER'   AND actor_user_id IS NOT NULL AND actor_admin_id IS NULL) OR
    (actor_type = 'ADMIN'  AND actor_admin_id IS NOT NULL AND actor_user_id IS NULL)
  ),
  CONSTRAINT ck_ticket_ownership_history_change_shape CHECK (
    (change_type = 'ATTACH'   AND from_user_id IS NULL     AND to_user_id IS NOT NULL) OR
    (change_type = 'REASSIGN' AND from_user_id IS NOT NULL AND to_user_id IS NOT NULL) OR
    (change_type = 'DETACH'   AND from_user_id IS NOT NULL AND to_user_id IS NULL)
  ),
  -- Admin-assisted attach/reassign requires a reason; ADMIN-driven changes must justify
  -- themselves even though the same rule is not asked of self-service ATTACH.
  CONSTRAINT ck_ticket_ownership_history_admin_reason CHECK (
    actor_type <> 'ADMIN' OR reason IS NOT NULL
  )
);

CREATE INDEX ix_ticket_ownership_history_ticket ON ticket_ownership_history (ticket_id, created_at);

COMMENT ON TABLE ticket_ownership_history IS 'Append-only. Every attachment, reassignment, or detachment of a ticket''s owner_user_id. request_id gives idempotent retry safety for the attachment transaction.';
