-- 0038_prize_award_components.up.sql
-- Purpose: a Six Chance system ticket can win several cash tiers AND free rows in one draw.
-- The ticket keeps exactly ONE parent prize_award per calculation run (unchanged uniqueness),
-- and the parent's per-tier composition is normalized into prize_award_components:
--   * one component per (award, tier) with its component type, cash amount or free-row
--     quantity, the number of winning combinations and the calculation evidence;
--   * expanded combinations are never persisted — match counts are stored, not combinations.
-- The parent summarizes: amount_toman = total cash, free_ticket_quantity = total free rows,
-- tier_code = best tier, award_type = CASH, FREE_TICKET or (new) MIXED.

-- Adding an enum value must commit before the value can be used, so it runs on its own,
-- outside the transaction below (psql autocommits a statement outside BEGIN/COMMIT).
ALTER TYPE award_type_enum ADD VALUE IF NOT EXISTS 'MIXED';

BEGIN;

ALTER TABLE prize_awards DROP CONSTRAINT ck_prize_awards_type_shape;
ALTER TABLE prize_awards ADD CONSTRAINT ck_prize_awards_type_shape CHECK (
  (award_type = 'CASH'        AND amount_toman IS NOT NULL AND free_ticket_quantity IS NULL) OR
  (award_type = 'FREE_TICKET' AND free_ticket_quantity IS NOT NULL AND amount_toman IS NULL) OR
  (award_type = 'MIXED'       AND amount_toman IS NOT NULL AND amount_toman > 0
                              AND free_ticket_quantity IS NOT NULL AND free_ticket_quantity >= 1)
);

CREATE TABLE prize_award_components (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id               UUID NOT NULL REFERENCES prize_awards (id) ON DELETE RESTRICT,
  tier_code              VARCHAR NOT NULL,
  component_type         award_type_enum NOT NULL,
  amount_toman           toman_amount,
  free_ticket_quantity   nonneg_int,
  matched_combinations   INTEGER NOT NULL,
  calculation_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_prize_award_components_award_tier UNIQUE (award_id, tier_code),
  CONSTRAINT ck_prize_award_components_matched_positive CHECK (matched_combinations >= 1),
  CONSTRAINT ck_prize_award_components_shape CHECK (
    (component_type = 'CASH'        AND amount_toman IS NOT NULL AND free_ticket_quantity IS NULL) OR
    (component_type = 'FREE_TICKET' AND free_ticket_quantity IS NOT NULL AND free_ticket_quantity >= 1
                                    AND amount_toman IS NULL)
  )
);

CREATE INDEX ix_prize_award_components_award ON prize_award_components (award_id);

COMMENT ON TABLE prize_award_components IS
  'Append-only per-tier composition of one parent prize_award (see 0038 header). A component records a match COUNT, never an expanded combination.';

-- Append-only, like the other history tables (0031): corrections supersede the parent award
-- and write new components; existing components are never edited or deleted.
REVOKE UPDATE, DELETE ON TABLE prize_award_components FROM bakhta_app;
CREATE TRIGGER trg_prize_award_components_append_only
  BEFORE UPDATE OR DELETE ON prize_award_components
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A parent award created from now on must be exactly the sum of its components. Checked at
-- commit (components are inserted after their parent in the same transaction).
CREATE OR REPLACE FUNCTION validate_prize_award_components()
RETURNS TRIGGER AS $$
DECLARE
  v_cash  BIGINT;
  v_free  BIGINT;
  v_count INTEGER;
BEGIN
  SELECT count(*),
         COALESCE(sum(amount_toman), 0),
         COALESCE(sum(free_ticket_quantity), 0)
    INTO v_count, v_cash, v_free
    FROM prize_award_components
   WHERE award_id = NEW.id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'prize_awards.id=% has no components', NEW.id;
  END IF;
  IF v_cash <> COALESCE(NEW.amount_toman, 0) OR v_free <> COALESCE(NEW.free_ticket_quantity, 0) THEN
    RAISE EXCEPTION 'prize_awards.id=% totals (cash %, free %) do not match its components (cash %, free %)',
      NEW.id, COALESCE(NEW.amount_toman, 0), COALESCE(NEW.free_ticket_quantity, 0), v_cash, v_free;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_prize_awards_components_match
  AFTER INSERT ON prize_awards
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_prize_award_components();

COMMIT;
