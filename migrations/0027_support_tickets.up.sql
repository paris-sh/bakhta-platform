-- 0027_support_tickets.up.sql
-- Purpose: support case. related_entity_type/related_entity_id is a DELIBERATE polymorphic
-- reference (accepted exception per the product owner's amendment: "generic support-ticket
-- related-entity references") because a case can concern an order, a ticket, a claim, or an
-- account. The requester, by contrast, is always exactly a user or a guest, so it uses a
-- typed discriminator instead.

CREATE TABLE support_tickets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number            VARCHAR NOT NULL,
  requester_type         requester_type_enum NOT NULL,
  requester_user_id      UUID REFERENCES users (id) ON DELETE RESTRICT,
  requester_guest_email  CITEXT,
  category               support_category_enum NOT NULL,
  status                 support_status_enum NOT NULL DEFAULT 'OPEN',
  related_entity_type    VARCHAR,
  related_entity_id      UUID,
  assigned_admin_id      UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at              TIMESTAMPTZ,
  CONSTRAINT uq_support_tickets_case_number UNIQUE (case_number),
  CONSTRAINT ck_support_tickets_requester_xor CHECK (
    (requester_type = 'USER'  AND requester_user_id IS NOT NULL AND requester_guest_email IS NULL) OR
    (requester_type = 'GUEST' AND requester_user_id IS NULL AND requester_guest_email IS NOT NULL)
  ),
  CONSTRAINT ck_support_tickets_related_entity_pair CHECK (
    (related_entity_type IS NULL) = (related_entity_id IS NULL)
  )
);

CREATE TRIGGER trg_support_tickets_set_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_support_tickets_requester_user ON support_tickets (requester_user_id) WHERE requester_user_id IS NOT NULL;
CREATE INDEX ix_support_tickets_related_entity ON support_tickets (related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;
CREATE INDEX ix_support_tickets_status ON support_tickets (status);

COMMENT ON TABLE support_tickets IS 'Support case. related_entity_type/related_entity_id is a deliberate unenforced polymorphic reference (documented exception).';
