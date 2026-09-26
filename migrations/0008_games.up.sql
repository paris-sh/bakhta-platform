-- 0008_games.up.sql
-- Purpose: game identity. game_type is a structural discriminator (fixed mathematical shape:
-- Six Chance vs Four Leaf) kept separate from the mutable branding `code`/slug, so later
-- constraints (selection-table matching, ticket denormalization) can reference a value that
-- can never be renamed. This column is not in the spec's field list for `games`; it fills a
-- gap needed to enforce "the selection-table type must match the ticket's game" at the
-- database level (see 0017_ticket_selections.up.sql and the migration README).

CREATE TABLE games (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR NOT NULL,
  game_type  game_type_enum NOT NULL,
  slug       VARCHAR NOT NULL,
  name_fa    VARCHAR NOT NULL,
  name_en    VARCHAR NOT NULL,
  status     game_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_games_code UNIQUE (code),
  CONSTRAINT uq_games_slug UNIQUE (slug),
  -- Composite unique purely to serve as an FK target for downstream composite foreign keys
  -- that pin a ticket's/draw's game_type without trusting application code.
  CONSTRAINT uq_games_id_game_type UNIQUE (id, game_type)
);

CREATE TRIGGER trg_games_set_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE games IS 'Game identity and lifecycle. No mutable prize rules live here; see game_rule_versions.';
COMMENT ON COLUMN games.game_type IS 'Structural game shape (fixed for this release). Distinct from the mutable branding code/slug.';
