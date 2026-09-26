-- 0017_ticket_selections.up.sql
-- Purpose: game-specific ticket selections. Each table's ticket_game_type column is pinned
-- by a composite foreign key to tickets(id, game_type), so a Six Chance ticket can never
-- physically receive a four_leaf_ticket_selections row and vice versa — the database
-- rejects the insert outright rather than relying on application logic.
--
-- "Exactly one selection row, matching the ticket's game" additionally requires an
-- existence check (a ticket must have at least one row, not just at most one), which pure
-- foreign keys cannot express against an optional child. That half of the invariant is
-- enforced by the deferred constraint trigger at the bottom of this file, which requires
-- the ticket and its selection row to be inserted in the same transaction (the normal
-- purchase-confirmation flow already does this).

CREATE TABLE four_leaf_ticket_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL,
  ticket_game_type  game_type_enum NOT NULL DEFAULT 'FOUR_LEAF',
  number_value      four_digit_code NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_four_leaf_ticket_selections_ticket UNIQUE (ticket_id),
  CONSTRAINT ck_four_leaf_ticket_selections_game_type CHECK (ticket_game_type = 'FOUR_LEAF'),
  CONSTRAINT fk_four_leaf_ticket_selections_ticket
    FOREIGN KEY (ticket_id, ticket_game_type) REFERENCES tickets (id, game_type) ON DELETE RESTRICT
);

COMMENT ON TABLE four_leaf_ticket_selections IS 'Exactly four digit characters; order matters and leading zero and repeated digits are both allowed by design.';

CREATE TABLE six_chance_ticket_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL,
  ticket_game_type  game_type_enum NOT NULL DEFAULT 'SIX_CHANCE',
  n1                SMALLINT NOT NULL,
  n2                SMALLINT NOT NULL,
  n3                SMALLINT NOT NULL,
  n4                SMALLINT NOT NULL,
  n5                SMALLINT NOT NULL,
  n6                SMALLINT NOT NULL,
  symbol            SMALLINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_six_chance_ticket_selections_ticket UNIQUE (ticket_id),
  CONSTRAINT ck_six_chance_ticket_selections_game_type CHECK (ticket_game_type = 'SIX_CHANCE'),
  CONSTRAINT fk_six_chance_ticket_selections_ticket
    FOREIGN KEY (ticket_id, ticket_game_type) REFERENCES tickets (id, game_type) ON DELETE RESTRICT,
  CONSTRAINT ck_six_chance_ticket_selections_range CHECK (
    n1 BETWEEN 1 AND 33 AND n2 BETWEEN 1 AND 33 AND n3 BETWEEN 1 AND 33 AND
    n4 BETWEEN 1 AND 33 AND n5 BETWEEN 1 AND 33 AND n6 BETWEEN 1 AND 33
  ),
  CONSTRAINT ck_six_chance_ticket_selections_strictly_increasing CHECK (
    n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6
  ),
  CONSTRAINT ck_six_chance_ticket_selections_symbol_range CHECK (symbol BETWEEN 1 AND 5)
);

COMMENT ON TABLE six_chance_ticket_selections IS 'Six distinct main numbers (1-33, stored strictly increasing so order does not affect matching) and one chance symbol (1-5). Duplicate selections across different tickets are allowed by design.';

-- =========================================================================
-- Exactly-one-matching-selection-row enforcement
-- =========================================================================

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

CREATE CONSTRAINT TRIGGER trg_tickets_selection_cardinality
  AFTER INSERT OR UPDATE ON tickets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_ticket_selection_cardinality();
