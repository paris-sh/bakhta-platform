-- 0020_result_values.up.sql
-- Purpose: game-specific result values, matched to results.game_type the same way ticket
-- selections are matched to tickets.game_type (composite FK; see 0017 for the rationale).
-- "Exactly one matching value row per result" is enforced by the same deferred
-- constraint-trigger technique, requiring the result and its value row to be inserted in
-- the same transaction.

CREATE TABLE four_leaf_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id         UUID NOT NULL,
  result_game_type  game_type_enum NOT NULL DEFAULT 'FOUR_LEAF',
  number_value      four_digit_code NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_four_leaf_results_result UNIQUE (result_id),
  CONSTRAINT ck_four_leaf_results_game_type CHECK (result_game_type = 'FOUR_LEAF'),
  CONSTRAINT fk_four_leaf_results_result
    FOREIGN KEY (result_id, result_game_type) REFERENCES results (id, game_type) ON DELETE RESTRICT
);

COMMENT ON TABLE four_leaf_results IS 'Exactly four digit characters; leading zero preserved.';

CREATE TABLE six_chance_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id           UUID NOT NULL,
  result_game_type    game_type_enum NOT NULL DEFAULT 'SIX_CHANCE',
  draw_order_values   SMALLINT[] NOT NULL,
  normalized_n1       SMALLINT NOT NULL,
  normalized_n2       SMALLINT NOT NULL,
  normalized_n3       SMALLINT NOT NULL,
  normalized_n4       SMALLINT NOT NULL,
  normalized_n5       SMALLINT NOT NULL,
  normalized_n6       SMALLINT NOT NULL,
  symbol              SMALLINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_six_chance_results_result UNIQUE (result_id),
  CONSTRAINT ck_six_chance_results_game_type CHECK (result_game_type = 'SIX_CHANCE'),
  CONSTRAINT fk_six_chance_results_result
    FOREIGN KEY (result_id, result_game_type) REFERENCES results (id, game_type) ON DELETE RESTRICT,
  CONSTRAINT ck_six_chance_results_draw_order_length CHECK (array_length(draw_order_values, 1) = 6),
  CONSTRAINT ck_six_chance_results_draw_order_range CHECK (
    1 <= ALL(draw_order_values) AND 33 >= ALL(draw_order_values)
  ),
  CONSTRAINT ck_six_chance_results_normalized_range CHECK (
    normalized_n1 BETWEEN 1 AND 33 AND normalized_n2 BETWEEN 1 AND 33 AND
    normalized_n3 BETWEEN 1 AND 33 AND normalized_n4 BETWEEN 1 AND 33 AND
    normalized_n5 BETWEEN 1 AND 33 AND normalized_n6 BETWEEN 1 AND 33
  ),
  CONSTRAINT ck_six_chance_results_normalized_increasing CHECK (
    normalized_n1 < normalized_n2 AND normalized_n2 < normalized_n3 AND
    normalized_n3 < normalized_n4 AND normalized_n4 < normalized_n5 AND
    normalized_n5 < normalized_n6
  ),
  CONSTRAINT ck_six_chance_results_symbol_range CHECK (symbol BETWEEN 1 AND 5)
);

COMMENT ON TABLE six_chance_results IS 'Stores both the physical draw order (draw_order_values, as balls were drawn) and the normalized sorted values (normalized_n1..n6) used for matching.';

-- =========================================================================
-- Exactly-one-matching-value-row enforcement
-- =========================================================================

CREATE OR REPLACE FUNCTION validate_result_value_cardinality()
RETURNS TRIGGER AS $$
DECLARE
  v_game_type game_type_enum;
  v_count     INTEGER;
BEGIN
  SELECT game_type INTO v_game_type FROM results WHERE id = NEW.id;

  IF v_game_type = 'FOUR_LEAF' THEN
    SELECT count(*) INTO v_count FROM four_leaf_results WHERE result_id = NEW.id;
  ELSE
    SELECT count(*) INTO v_count FROM six_chance_results WHERE result_id = NEW.id;
  END IF;

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Result % (game_type %) must have exactly one matching value row, found %',
      NEW.id, v_game_type, v_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_results_value_cardinality
  AFTER INSERT OR UPDATE ON results
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_result_value_cardinality();
