-- 0025_prize_claim_status_history.up.sql
-- Purpose: append-only claim status transition log. Actors here include the claimant
-- themselves (USER submitting more information, or GUEST via a bearer credential — recorded
-- without a user/admin FK), ADMIN/SUPER_ADMIN decisions, and SYSTEM transitions (e.g. an
-- automatic EXPIRED transition, or a correction-driven move to PENDING_REVIEW). Made
-- append-only (no UPDATE/DELETE for the application role) in 0031.

CREATE TABLE prize_claim_status_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       UUID NOT NULL REFERENCES prize_claims (id) ON DELETE RESTRICT,
  from_status    VARCHAR,
  to_status      VARCHAR NOT NULL,
  reason         TEXT,
  actor_type     actor_type_enum NOT NULL,
  actor_admin_id UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  actor_user_id  UUID REFERENCES users (id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_prize_claim_status_history_actor_xor CHECK (
    (actor_type = 'SYSTEM' AND actor_admin_id IS NULL AND actor_user_id IS NULL) OR
    (actor_type = 'ADMIN'  AND actor_admin_id IS NOT NULL AND actor_user_id IS NULL) OR
    (actor_type = 'USER'   AND actor_user_id IS NOT NULL AND actor_admin_id IS NULL) OR
    (actor_type = 'GUEST'  AND actor_admin_id IS NULL AND actor_user_id IS NULL)
  ),
  -- A result correction that removes or changes an entitlement must explain itself.
  CONSTRAINT ck_prize_claim_status_history_correction_reason CHECK (
    to_status <> 'PENDING_REVIEW' OR from_status IS NULL OR reason IS NOT NULL
  )
);

CREATE INDEX ix_prize_claim_status_history_claim ON prize_claim_status_history (claim_id, created_at);

COMMENT ON TABLE prize_claim_status_history IS 'Append-only. Includes the correction-driven transition back to PENDING_REVIEW when current_award_id is cleared, and the manual-reconciliation note for a previously PAID claim whose award was superseded.';
