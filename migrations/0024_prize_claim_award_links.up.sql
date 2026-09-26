-- 0024_prize_claim_award_links.up.sql
-- Purpose: append-only claim-to-award version history. Per the product owner's amendment,
-- linked_by uses a typed actor pair (ADMIN/SYSTEM) instead of a generic reference, and
-- ticket_id is denormalized and pinned by composite foreign keys to both the claim and the
-- award, enforcing "every link's award must belong to the same ticket as its claim" as a
-- real constraint. Made append-only (no UPDATE/DELETE for the application role) in 0031.

CREATE TABLE prize_claim_award_links (
  claim_id            UUID NOT NULL REFERENCES prize_claims (id) ON DELETE RESTRICT,
  award_id            UUID NOT NULL REFERENCES prize_awards (id) ON DELETE RESTRICT,
  ticket_id           UUID NOT NULL,
  link_reason         claim_award_link_reason_enum NOT NULL,
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by_type      actor_type_enum NOT NULL,
  linked_by_admin_id  UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  PRIMARY KEY (claim_id, award_id),
  -- The claim referenced must actually anchor this same ticket (prize_claims has
  -- UNIQUE(id, ticket_id) from 0023).
  CONSTRAINT fk_prize_claim_award_links_claim_ticket
    FOREIGN KEY (claim_id, ticket_id) REFERENCES prize_claims (id, ticket_id),
  -- The award referenced must actually belong to this same ticket (prize_awards has
  -- UNIQUE(id, ticket_id) from 0022).
  CONSTRAINT fk_prize_claim_award_links_award_ticket
    FOREIGN KEY (award_id, ticket_id) REFERENCES prize_awards (id, ticket_id),
  CONSTRAINT ck_prize_claim_award_links_actor_kind CHECK (linked_by_type IN ('ADMIN', 'SYSTEM')),
  CONSTRAINT ck_prize_claim_award_links_actor_xor CHECK (
    (linked_by_type = 'ADMIN'  AND linked_by_admin_id IS NOT NULL) OR
    (linked_by_type = 'SYSTEM' AND linked_by_admin_id IS NULL)
  )
);

CREATE INDEX ix_prize_claim_award_links_award ON prize_claim_award_links (award_id);
CREATE INDEX ix_prize_claim_award_links_ticket ON prize_claim_award_links (ticket_id);

COMMENT ON TABLE prize_claim_award_links IS 'Append-only. Records every award version a claim has ever pointed to (INITIAL_CLAIM, then RESULT_CORRECTION on each correction), including the correction that removed current_award_id to NULL.';
