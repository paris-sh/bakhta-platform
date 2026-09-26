-- 0028_support_messages.up.sql
-- Purpose: case conversation and internal notes. is_internal_note rows must never be
-- rendered to the requester by the application; the sender is always a known user, admin,
-- guest (the requester replying), or the system (automated message).

CREATE TABLE support_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  support_ticket_id UUID NOT NULL REFERENCES support_tickets (id) ON DELETE RESTRICT,
  sender_type       actor_type_enum NOT NULL,
  sender_user_id    UUID REFERENCES users (id) ON DELETE RESTRICT,
  sender_admin_id   UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  body              TEXT NOT NULL,
  is_internal_note  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_support_messages_sender_shape CHECK (
    (sender_type = 'SYSTEM' AND sender_user_id IS NULL AND sender_admin_id IS NULL) OR
    (sender_type = 'USER'   AND sender_user_id IS NOT NULL AND sender_admin_id IS NULL) OR
    (sender_type = 'ADMIN'  AND sender_admin_id IS NOT NULL AND sender_user_id IS NULL) OR
    (sender_type = 'GUEST'  AND sender_user_id IS NULL AND sender_admin_id IS NULL)
  ),
  -- Only ADMIN/SYSTEM senders may write an internal note; a requester (USER/GUEST) message
  -- is never internal.
  CONSTRAINT ck_support_messages_internal_note_sender CHECK (
    NOT is_internal_note OR sender_type IN ('ADMIN', 'SYSTEM')
  )
);

CREATE INDEX ix_support_messages_ticket ON support_messages (support_ticket_id, created_at);

COMMENT ON TABLE support_messages IS 'Case conversation and internal notes. is_internal_note visibility must be enforced by the API layer in addition to this constraint; Claim Tokens pasted into body should be detected and masked before storage.';
