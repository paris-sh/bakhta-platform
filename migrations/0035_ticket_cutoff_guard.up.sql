-- 0035_ticket_cutoff_guard.up.sql
-- Purpose: "The server clock controls sales cutoffs. The system must not insert a
-- confirmed ticket retroactively after the applicable cutoff." Until this migration, that
-- was enforced only by application-transaction discipline (lock the draw row, compare to
-- now(), then insert/confirm) — correct under proper locking, but with no second line of
-- defense if a future code path forgets to lock. This adds the database-layer guarantee,
-- consistent with how every other invariant in this schema is enforced at this layer, not
-- just in application code.
--
-- Scope: fires only when a row is being written WITH status = 'CONFIRMED', and only on the
-- transition into that status (a row already CONFIRMED can still be updated for unrelated
-- reasons — e.g. outcome_status changing after a draw — without re-triggering this check).

CREATE OR REPLACE FUNCTION enforce_ticket_confirmation_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'CONFIRMED') THEN
    SELECT sales_closes_at INTO v_cutoff FROM draws WHERE id = NEW.draw_id;
    IF v_cutoff IS NOT NULL AND now() > v_cutoff THEN
      RAISE EXCEPTION
        'Cannot confirm ticket % for draw %: sales closed at % (now %)',
        NEW.id, NEW.draw_id, v_cutoff, now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tickets_confirmation_cutoff
  BEFORE INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION enforce_ticket_confirmation_cutoff();

COMMENT ON FUNCTION enforce_ticket_confirmation_cutoff() IS
  'Defense-in-depth: blocks confirming a ticket after its draw''s sales_closes_at has passed, even if the application forgot to lock/check first.';
