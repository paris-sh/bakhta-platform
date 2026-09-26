-- 0034_prize_award_run_published_guard.up.sql
-- Purpose: "Only awards belonging to the selected published calculation run may become
-- current." (product owner's amendment #3). This cannot be expressed as a plain CHECK
-- because it depends on another table's current state, so it is a trigger.

CREATE OR REPLACE FUNCTION enforce_current_award_run_published()
RETURNS TRIGGER AS $$
DECLARE
  v_run_status calc_run_status_enum;
BEGIN
  IF NOT NEW.is_current THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_run_status
  FROM prize_calculation_runs
  WHERE id = NEW.calculation_run_id;

  IF v_run_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION
      'prize_awards.id=% cannot be is_current: calculation_run % has status % (must be PUBLISHED)',
      NEW.id, NEW.calculation_run_id, v_run_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prize_awards_current_requires_published_run
  BEFORE INSERT OR UPDATE ON prize_awards
  FOR EACH ROW EXECUTE FUNCTION enforce_current_award_run_published();
