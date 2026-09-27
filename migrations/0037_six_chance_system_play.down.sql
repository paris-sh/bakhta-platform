-- 0037_six_chance_system_play.down.sql
-- Reverses 0037. Like the other down migrations, this is destructive for data created under
-- it: system-play selection rows are dropped with their table. Run only where no system
-- tickets exist (a system ticket left behind would have no selection row at all).

DROP TRIGGER IF EXISTS trg_six_chance_system_selections_ticket_cardinality ON six_chance_system_ticket_selections;
DROP TRIGGER IF EXISTS trg_six_chance_selections_ticket_cardinality ON six_chance_ticket_selections;
DROP TRIGGER IF EXISTS trg_four_leaf_selections_ticket_cardinality ON four_leaf_ticket_selections;
DROP FUNCTION IF EXISTS validate_selection_row_ticket_cardinality();

DROP TABLE IF EXISTS six_chance_system_ticket_selections;

-- Restore the 0017 body of the tickets-side check verbatim.
CREATE OR REPLACE FUNCTION validate_ticket_selection_cardinality()
RETURNS TRIGGER AS $$
DECLARE
  v_game_type game_type_enum;
  v_count     INTEGER;
BEGIN
  SELECT game_type INTO v_game_type FROM tickets WHERE id = NEW.id;

  IF v_game_type = 'FOUR_LEAF' THEN
    SELECT count(*) INTO v_count FROM four_leaf_ticket_selections WHERE ticket_id = NEW.id;
  ELSE
    SELECT count(*) INTO v_count FROM six_chance_ticket_selections WHERE ticket_id = NEW.id;
  END IF;

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Ticket % (game_type %) must have exactly one matching selection row, found %',
      NEW.id, v_game_type, v_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_ticket_selection_cardinality() IS
  'Deferred constraint check: a ticket must have exactly one row in the selection table matching its game_type. Requires the ticket and its selection row to be inserted in the same transaction.';

DROP FUNCTION IF EXISTS assert_ticket_selection_cardinality(UUID);

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS uq_tickets_id_combination_count;
ALTER TABLE tickets DROP COLUMN IF EXISTS line_total_toman;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ck_tickets_combination_count_positive;
ALTER TABLE tickets DROP COLUMN IF EXISTS combination_count;
COMMENT ON COLUMN tickets.unit_price_toman IS NULL;

DROP FUNCTION IF EXISTS smallint_array_is_sorted_set(SMALLINT[], INTEGER, INTEGER);
DROP FUNCTION IF EXISTS six_chance_combination_count(INTEGER, INTEGER);
