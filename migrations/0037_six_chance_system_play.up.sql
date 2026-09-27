-- 0037_six_chance_system_play.up.sql
-- Purpose: Six Chance "system play". One user-created line may select a POOL of 6+ main
-- numbers and 1+ chance symbols; it covers every 6-number combination of the pool with every
-- selected symbol:
--
--     combination_count = C(numbers in pool, 6) × symbols in pool
--
-- A system line is still exactly ONE ticket (one public code, one guest Claim Token). The
-- generated combinations are never materialized as rows: they are derived deterministically
-- from the stored, sorted pools whenever they are needed (e.g. future prize calculation).
--
-- Representation (one canonical form per selection):
--   * exact pick (6 numbers × 1 symbol, combination_count = 1)
--       → the existing six_chance_ticket_selections row, unchanged. All existing tickets are
--         exact picks and need no data change.
--   * system pick (combination_count > 1)
--       → a row in the new six_chance_system_ticket_selections table.
--
-- Pricing: tickets.unit_price_toman stays the per-combination price snapshotted from the
-- draw's rule version. tickets.combination_count (new, default 1) and the stored generated
-- tickets.line_total_toman (= unit_price_toman × combination_count) make every line's charge
-- auditable in the row itself; existing tickets backfill to combination_count 1 and
-- line_total_toman = unit_price_toman without any UPDATE (so no row triggers fire).
--
-- Rule-version LIMITS (maximum numbers/symbols per line, combination caps) vary per rule
-- version and are enforced in the application from the draw's snapshot. This migration only
-- enforces what is structurally true for every Six Chance line: numbers 1–33, symbols 1–5,
-- sorted and distinct, at least 6 numbers and 1 symbol, and a combination_count that matches
-- the pools exactly.

-- -------------------------------------------------------------------------
-- Pure helpers (IMMUTABLE so they can back CHECK constraints)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION six_chance_combination_count(p_number_count INTEGER, p_symbol_count INTEGER)
RETURNS BIGINT AS $$
DECLARE
  v_result BIGINT := 1;
  i        INTEGER;
BEGIN
  IF p_number_count IS NULL OR p_symbol_count IS NULL OR p_number_count < 6 OR p_symbol_count < 1 THEN
    RETURN 0;
  END IF;
  -- C(n, 6) computed incrementally; every intermediate value is an exact integer.
  FOR i IN 1..6 LOOP
    v_result := v_result * (p_number_count - 6 + i) / i;
  END LOOP;
  RETURN v_result * p_symbol_count;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

COMMENT ON FUNCTION six_chance_combination_count(INTEGER, INTEGER) IS
  'C(p_number_count, 6) × p_symbol_count — the number of (6 numbers, 1 symbol) combinations a Six Chance system line covers. 0 for an invalid pool size.';

CREATE OR REPLACE FUNCTION smallint_array_is_sorted_set(p_values SMALLINT[], p_min INTEGER, p_max INTEGER)
RETURNS BOOLEAN AS $$
  SELECT array_ndims(p_values) = 1
     AND array_lower(p_values, 1) = 1
     AND NOT EXISTS (
       SELECT 1
       FROM generate_subscripts(p_values, 1) AS i
       WHERE p_values[i] IS NULL
          OR p_values[i] < p_min
          OR p_values[i] > p_max
          OR (i > 1 AND p_values[i] <= p_values[i - 1])
     );
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON FUNCTION smallint_array_is_sorted_set(SMALLINT[], INTEGER, INTEGER) IS
  'True when the array is one-dimensional, 1-based, NULL-free, strictly increasing (so distinct) and every element lies in [p_min, p_max].';

-- -------------------------------------------------------------------------
-- tickets: per-line combination count and auditable line total
-- -------------------------------------------------------------------------

ALTER TABLE tickets
  ADD COLUMN combination_count INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT ck_tickets_combination_count_positive CHECK (combination_count >= 1);

ALTER TABLE tickets
  ADD COLUMN line_total_toman toman_amount
    GENERATED ALWAYS AS (unit_price_toman * combination_count) STORED;

-- Lets the system-selection row pin its own combination_count to its ticket's with a real
-- foreign key (same composite-FK pattern as uq_tickets_id_game_type).
ALTER TABLE tickets
  ADD CONSTRAINT uq_tickets_id_combination_count UNIQUE (id, combination_count);

COMMENT ON COLUMN tickets.unit_price_toman IS
  'Price of ONE combination, snapshotted from the draw''s rule version at purchase time.';
COMMENT ON COLUMN tickets.combination_count IS
  'Number of (6 numbers, 1 symbol) combinations this line covers: 1 for Four Leaf and exact Six Chance picks; C(n,6)×symbols for a Six Chance system line.';
COMMENT ON COLUMN tickets.line_total_toman IS
  'Generated: unit_price_toman × combination_count — the amount this line contributes to its order.';

-- -------------------------------------------------------------------------
-- Six Chance system selections
-- -------------------------------------------------------------------------

CREATE TABLE six_chance_system_ticket_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL,
  ticket_game_type  game_type_enum NOT NULL DEFAULT 'SIX_CHANCE',
  numbers           SMALLINT[] NOT NULL,
  symbols           SMALLINT[] NOT NULL,
  combination_count INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_six_chance_system_ticket_selections_ticket UNIQUE (ticket_id),
  CONSTRAINT ck_six_chance_system_ticket_selections_game_type CHECK (ticket_game_type = 'SIX_CHANCE'),
  CONSTRAINT fk_six_chance_system_ticket_selections_ticket
    FOREIGN KEY (ticket_id, ticket_game_type) REFERENCES tickets (id, game_type) ON DELETE RESTRICT,
  -- The ticket's own combination_count (which prices the line) must equal this row's.
  CONSTRAINT fk_six_chance_system_ticket_selections_combination_count
    FOREIGN KEY (ticket_id, combination_count) REFERENCES tickets (id, combination_count) ON DELETE RESTRICT,
  CONSTRAINT ck_six_chance_system_ticket_selections_numbers CHECK (
    smallint_array_is_sorted_set(numbers, 1, 33) AND cardinality(numbers) >= 6
  ),
  CONSTRAINT ck_six_chance_system_ticket_selections_symbols CHECK (
    smallint_array_is_sorted_set(symbols, 1, 5) AND cardinality(symbols) >= 1
  ),
  CONSTRAINT ck_six_chance_system_ticket_selections_combination_count CHECK (
    combination_count = six_chance_combination_count(cardinality(numbers), cardinality(symbols))
  ),
  -- A single combination is an exact pick and must use six_chance_ticket_selections, so
  -- every selection has exactly one canonical representation.
  CONSTRAINT ck_six_chance_system_ticket_selections_is_system CHECK (combination_count > 1)
);

COMMENT ON TABLE six_chance_system_ticket_selections IS
  'Six Chance system line: a sorted pool of 6–33 distinct main numbers and 1–5 distinct chance symbols covering C(numbers,6)×symbols combinations. Combinations are derived from the pools, never stored individually. Exact (single-combination) picks live in six_chance_ticket_selections.';

-- -------------------------------------------------------------------------
-- Exactly-one-valid-selection enforcement (replaces the 0017 function body)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_ticket_selection_cardinality(p_ticket_id UUID)
RETURNS VOID AS $$
DECLARE
  v_game_type         game_type_enum;
  v_combination_count INTEGER;
  v_four_leaf         INTEGER;
  v_exact             INTEGER;
  v_system            INTEGER;
BEGIN
  SELECT game_type, combination_count INTO v_game_type, v_combination_count
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN; -- ticket gone (only reachable via RESTRICT-protected deletes); nothing to check
  END IF;

  SELECT count(*) INTO v_four_leaf FROM four_leaf_ticket_selections WHERE ticket_id = p_ticket_id;
  SELECT count(*) INTO v_exact FROM six_chance_ticket_selections WHERE ticket_id = p_ticket_id;
  SELECT count(*) INTO v_system FROM six_chance_system_ticket_selections WHERE ticket_id = p_ticket_id;

  IF v_game_type = 'FOUR_LEAF' THEN
    IF v_four_leaf <> 1 OR v_exact + v_system <> 0 OR v_combination_count <> 1 THEN
      RAISE EXCEPTION
        'Ticket % (FOUR_LEAF) must have exactly one four_leaf selection and combination_count 1 (found four_leaf=%, six_chance=%, combination_count=%)',
        p_ticket_id, v_four_leaf, v_exact + v_system, v_combination_count;
    END IF;
  ELSE
    IF v_four_leaf <> 0 OR v_exact + v_system <> 1 THEN
      RAISE EXCEPTION
        'Ticket % (SIX_CHANCE) must have exactly one exact OR system selection (found exact=%, system=%, four_leaf=%)',
        p_ticket_id, v_exact, v_system, v_four_leaf;
    END IF;
    IF v_exact = 1 AND v_combination_count <> 1 THEN
      RAISE EXCEPTION
        'Ticket % has an exact Six Chance selection but combination_count %', p_ticket_id, v_combination_count;
    END IF;
    -- A system row's combination_count is pinned to the ticket's by
    -- fk_six_chance_system_ticket_selections_combination_count.
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_ticket_selection_cardinality(UUID) IS
  'Raises unless the ticket has exactly one selection of a type valid for its game (Four Leaf; or Six Chance exact XOR system) and a combination_count consistent with it.';

CREATE OR REPLACE FUNCTION validate_ticket_selection_cardinality()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_ticket_selection_cardinality(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_ticket_selection_cardinality() IS
  'Deferred constraint check on tickets: see assert_ticket_selection_cardinality. Requires the ticket and its selection row to be inserted in the same transaction.';

-- Re-check from the selection side too, so a selection row added, changed or removed after
-- its ticket was written (e.g. a second, conflicting selection type) is also caught.
CREATE OR REPLACE FUNCTION validate_selection_row_ticket_cardinality()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM assert_ticket_selection_cardinality(OLD.ticket_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM assert_ticket_selection_cardinality(NEW.ticket_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_four_leaf_selections_ticket_cardinality
  AFTER INSERT OR UPDATE OR DELETE ON four_leaf_ticket_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_selection_row_ticket_cardinality();

CREATE CONSTRAINT TRIGGER trg_six_chance_selections_ticket_cardinality
  AFTER INSERT OR UPDATE OR DELETE ON six_chance_ticket_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_selection_row_ticket_cardinality();

CREATE CONSTRAINT TRIGGER trg_six_chance_system_selections_ticket_cardinality
  AFTER INSERT OR UPDATE OR DELETE ON six_chance_system_ticket_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_selection_row_ticket_cardinality();
