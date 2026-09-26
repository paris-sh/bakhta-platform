-- 0029_notifications.up.sql
-- Purpose: one delivery per recipient and channel. Per the product owner's amendment, the
-- recipient uses typed nullable columns instead of a generic reference, with exactly one
-- populated according to recipient_type.

CREATE TABLE notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type            VARCHAR NOT NULL,
  recipient_type        recipient_type_enum NOT NULL,
  recipient_user_id     UUID REFERENCES users (id) ON DELETE RESTRICT,
  recipient_admin_id    UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  recipient_guest_email CITEXT,
  channel               notification_channel_enum NOT NULL,
  template_key          VARCHAR NOT NULL,
  template_version      INTEGER NOT NULL,
  language              VARCHAR NOT NULL DEFAULT 'fa',
  rendered_subject       TEXT,
  rendered_body          TEXT,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                notification_status_enum NOT NULL DEFAULT 'QUEUED',
  idempotency_key       VARCHAR NOT NULL,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at       TIMESTAMPTZ,
  provider_status       VARCHAR,
  provider_message_id   VARCHAR,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notifications_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT ck_notifications_recipient_xor CHECK (
    (recipient_type = 'USER'  AND recipient_user_id  IS NOT NULL AND recipient_admin_id IS NULL AND recipient_guest_email IS NULL) OR
    (recipient_type = 'ADMIN' AND recipient_admin_id IS NOT NULL AND recipient_user_id  IS NULL AND recipient_guest_email IS NULL) OR
    (recipient_type = 'GUEST' AND recipient_guest_email IS NOT NULL AND recipient_user_id IS NULL AND recipient_admin_id IS NULL)
  ),
  CONSTRAINT ck_notifications_attempt_count_nonneg CHECK (attempt_count >= 0),
  CONSTRAINT ck_notifications_template_version_positive CHECK (template_version >= 1)
);

CREATE TRIGGER trg_notifications_set_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_notifications_recipient_user ON notifications (recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX ix_notifications_status ON notifications (status);

COMMENT ON TABLE notifications IS 'rendered_subject/rendered_body/payload are a sanitized snapshot that can never contain a raw Claim Token. A winning email subject must not reveal the prize amount (enforced by template content, not by this schema).';
