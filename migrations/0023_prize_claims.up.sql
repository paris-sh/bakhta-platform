-- 0023_prize_claims.up.sql
-- Purpose: the single continuing claim record per ticket. Per the product owner's amendment:
--   * current_award_id is nullable — a result correction can remove a ticket's entitlement
--     entirely (see 0025's SUPERSEDED-to-non-winner transition notes), in which case
--     current_award_id is set to NULL while the claim record itself (and its status/award
--     history) is preserved.
--   * A claim can only ever be *submitted* while the ticket has an eligible current award;
--     that precondition is an application/transaction concern (Critical Transactions,
--     Guest Claim Submission step 2), not a table CHECK, because it depends on award
--     expiry/eligibility logic beyond simple column comparison.
--   * Statuses representing an active payable entitlement normally require a non-null
--     current_award_id (ck_prize_claims_payable_requires_award below).

CREATE TABLE prize_claims (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number             VARCHAR NOT NULL,
  ticket_id                UUID NOT NULL REFERENCES tickets (id) ON DELETE RESTRICT,
  current_award_id         UUID,
  claimant_type            claimant_type_enum NOT NULL,
  claimant_user_id         UUID REFERENCES users (id) ON DELETE RESTRICT,
  claim_credential_id      UUID,
  contact_email_snapshot   CITEXT,
  submission_method        claim_submission_method_enum NOT NULL,
  status                   claim_status_enum NOT NULL DEFAULT 'PENDING_REVIEW',
  decision_reason          TEXT,
  requires_manual_reconciliation BOOLEAN NOT NULL DEFAULT FALSE,
  manual_reconciliation_notes    TEXT,
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at              TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  paid_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_prize_claims_claim_number UNIQUE (claim_number),
  -- Appendix Key PostgreSQL Constraints: UNIQUE (ticket_id) -- prize_claims
  CONSTRAINT uq_prize_claims_ticket UNIQUE (ticket_id),
  CONSTRAINT uq_prize_claims_id_ticket UNIQUE (id, ticket_id),
  CONSTRAINT uq_prize_claims_claim_credential UNIQUE (claim_credential_id),
  -- The award linked as current must belong to this same ticket (prize_awards has
  -- UNIQUE(id, ticket_id) from 0022).
  CONSTRAINT fk_prize_claims_current_award_ticket
    FOREIGN KEY (current_award_id, ticket_id) REFERENCES prize_awards (id, ticket_id),
  -- A guest credential referenced by a claim must belong to this same ticket
  -- (claim_credentials has UNIQUE(id, ticket_id) from 0018).
  CONSTRAINT fk_prize_claims_credential_ticket
    FOREIGN KEY (claim_credential_id, ticket_id) REFERENCES claim_credentials (id, ticket_id),
  CONSTRAINT ck_prize_claims_claimant_xor CHECK (
    (claimant_type = 'USER'  AND claimant_user_id IS NOT NULL AND claim_credential_id IS NULL) OR
    (claimant_type = 'GUEST' AND claimant_user_id IS NULL AND claim_credential_id IS NOT NULL)
  ),
  -- Amendment: payable-entitlement statuses normally require a live current_award_id.
  CONSTRAINT ck_prize_claims_payable_requires_award CHECK (
    status NOT IN ('APPROVED', 'READY_FOR_PAYMENT', 'PAYMENT_PENDING', 'PAID') OR
    current_award_id IS NOT NULL
  ),
  CONSTRAINT ck_prize_claims_decision_reason CHECK (
    status NOT IN ('REJECTED', 'FROZEN', 'DISPUTED') OR decision_reason IS NOT NULL
  ),
  CONSTRAINT ck_prize_claims_reconciliation_notes CHECK (
    NOT requires_manual_reconciliation OR manual_reconciliation_notes IS NOT NULL
  )
);

CREATE TRIGGER trg_prize_claims_set_updated_at
  BEFORE UPDATE ON prize_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_prize_claims_status ON prize_claims (status);
CREATE INDEX ix_prize_claims_claimant_user ON prize_claims (claimant_user_id) WHERE claimant_user_id IS NOT NULL;
CREATE INDEX ix_prize_claims_manual_reconciliation ON prize_claims (id) WHERE requires_manual_reconciliation;

COMMENT ON TABLE prize_claims IS 'One continuing claim record per ticket. Additional information, rejection, appeal, reopening, or a corrected award all continue on this same row via status and award-link history; current_award_id can go NULL when a correction removes the entitlement entirely, without requiring another Claim Token to re-open review.';
COMMENT ON COLUMN prize_claims.current_award_id IS 'Nullable: a result correction may supersede the ticket''s entitlement to nothing. A PAID claim whose award is later superseded keeps its PAID history untouched and is flagged for manual reconciliation (see prize_claim_status_history), never automatically reversed.';
