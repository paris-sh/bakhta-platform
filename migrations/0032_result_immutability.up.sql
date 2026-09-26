-- 0032_result_immutability.up.sql
-- Purpose: published result values must be immutable; corrections create new versions
-- instead of editing in place. Unlike the six purely append-only tables (0031), `results`
-- legitimately receives UPDATEs during its draft lifecycle (ENTERED -> PENDING_REVIEW, and
-- edits to a draft before publication per the Critical Transactions section), so this is a
-- conditional guard rather than a blanket reject: mutation is free while status is ENTERED
-- or PENDING_REVIEW, and frozen (except for the narrow PUBLISHED -> SUPERSEDED/VOID
-- transition and the is_public_current flip that a correction performs) once PUBLISHED.

CREATE OR REPLACE FUNCTION prevent_published_result_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'VOID') THEN
    RETURN NEW; -- still a draft; free to edit
  END IF;

  IF NEW.draw_id             IS DISTINCT FROM OLD.draw_id OR
     NEW.game_type           IS DISTINCT FROM OLD.game_type OR
     NEW.version_number      IS DISTINCT FROM OLD.version_number OR
     NEW.correction_reason   IS DISTINCT FROM OLD.correction_reason OR
     NEW.entered_by          IS DISTINCT FROM OLD.entered_by OR
     NEW.reviewed_by         IS DISTINCT FROM OLD.reviewed_by OR
     NEW.published_by        IS DISTINCT FROM OLD.published_by OR
     NEW.draw_evidence_id    IS DISTINCT FROM OLD.draw_evidence_id OR
     NEW.publication_reason  IS DISTINCT FROM OLD.publication_reason OR
     NEW.entered_at          IS DISTINCT FROM OLD.entered_at OR
     NEW.reviewed_at         IS DISTINCT FROM OLD.reviewed_at OR
     NEW.published_at        IS DISTINCT FROM OLD.published_at
  THEN
    RAISE EXCEPTION 'results.id=% is immutable once published: only status (PUBLISHED->SUPERSEDED/VOID) and is_public_current (TRUE->FALSE) may change', OLD.id;
  END IF;

  IF OLD.status IN ('SUPERSEDED', 'VOID') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'results.id=% status % is terminal', OLD.id, OLD.status;
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'VOID') THEN
    RAISE EXCEPTION 'results.id=% cannot transition from PUBLISHED to %', OLD.id, NEW.status;
  END IF;

  IF NEW.is_public_current AND NOT OLD.is_public_current THEN
    RAISE EXCEPTION 'results.id=% cannot re-activate is_public_current after publication; a correction publishes a new version instead', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_results_prevent_published_mutation
  BEFORE UPDATE ON results
  FOR EACH ROW EXECUTE FUNCTION prevent_published_result_mutation();

-- results is never hard-deleted (Data Architecture Principles: result history is append-only
-- new versions).
CREATE TRIGGER trg_results_reject_delete
  BEFORE DELETE ON results
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Value-table immutability follows the parent result's own draft/published boundary.
CREATE OR REPLACE FUNCTION prevent_published_result_value_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_result_id UUID;
  v_status    result_status_enum;
BEGIN
  v_result_id := COALESCE(NEW.result_id, OLD.result_id);
  SELECT status INTO v_status FROM results WHERE id = v_result_id;

  IF v_status IN ('PUBLISHED', 'SUPERSEDED', 'VOID') THEN
    RAISE EXCEPTION '% on % is rejected: parent result % is % (published values are immutable)',
      TG_OP, TG_TABLE_NAME, v_result_id, v_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_four_leaf_results_immutability
  BEFORE UPDATE OR DELETE ON four_leaf_results
  FOR EACH ROW EXECUTE FUNCTION prevent_published_result_value_mutation();

CREATE TRIGGER trg_six_chance_results_immutability
  BEFORE UPDATE OR DELETE ON six_chance_results
  FOR EACH ROW EXECUTE FUNCTION prevent_published_result_value_mutation();
