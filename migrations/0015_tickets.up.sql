-- 0015_tickets.up.sql
-- Purpose: one purchased or awarded row. draw_id and game_type are denormalized from the
-- parent order/draw and pinned by composite foreign keys (not trusted from application code)
-- so that later tables (prize_awards, the selection tables) can enforce cross-entity
-- invariants — "same draw", "matching game type" — with real foreign keys instead of
-- triggers. This denormalization is a deliberate technical addition beyond the spec's field
-- list, needed to satisfy the product owner's amendment on composite-FK enforcement.

CREATE TABLE tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code      VARCHAR NOT NULL,
  order_id         UUID NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  draw_id          UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  game_type        game_type_enum NOT NULL,
  line_number      INTEGER NOT NULL,
  owner_user_id    UUID REFERENCES users (id) ON DELETE RESTRICT,
  source           ticket_source_enum NOT NULL DEFAULT 'PURCHASE',
  status           ticket_status_enum NOT NULL DEFAULT 'PENDING',
  outcome_status   ticket_outcome_enum NOT NULL DEFAULT 'PENDING',
  unit_price_toman toman_amount NOT NULL,
  rule_version_id  UUID NOT NULL REFERENCES game_rule_versions (id) ON DELETE RESTRICT,
  is_quick_pick    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tickets_public_code UNIQUE (public_code),
  CONSTRAINT uq_tickets_order_line UNIQUE (order_id, line_number),
  CONSTRAINT uq_tickets_id_draw UNIQUE (id, draw_id),
  CONSTRAINT uq_tickets_id_game_type UNIQUE (id, game_type),
  -- Pins tickets.draw_id to the actual draw_id of its parent order (orders has
  -- UNIQUE(id, draw_id) from 0014); an insert with a mismatched draw_id is rejected by
  -- Postgres itself, not by application trust.
  CONSTRAINT fk_tickets_order_draw
    FOREIGN KEY (order_id, draw_id) REFERENCES orders (id, draw_id),
  -- Pins tickets.game_type to the actual game_type of its draw (draws has
  -- UNIQUE(id, game_type) from 0010).
  CONSTRAINT fk_tickets_draw_game_type
    FOREIGN KEY (draw_id, game_type) REFERENCES draws (id, game_type),
  -- Pins the ticket's rule_version_id to a rule version of the same game_type (game_rule_versions
  -- has UNIQUE(id, game_type) from 0009), so a Six Chance ticket can never reference a Four Leaf
  -- rule version or vice versa.
  CONSTRAINT fk_tickets_rule_version_game_type
    FOREIGN KEY (rule_version_id, game_type) REFERENCES game_rule_versions (id, game_type),
  CONSTRAINT ck_tickets_line_number_positive CHECK (line_number >= 1)
);

CREATE TRIGGER trg_tickets_set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_tickets_order ON tickets (order_id);
CREATE INDEX ix_tickets_draw ON tickets (draw_id);
CREATE INDEX ix_tickets_owner_user ON tickets (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX ix_tickets_status ON tickets (status);
CREATE INDEX ix_tickets_outcome ON tickets (outcome_status);

COMMENT ON TABLE tickets IS 'One purchased or awarded row; one ticket is one separate share of a prize. Ticket validity (status) and draw outcome (outcome_status) are stored separately to avoid contradictory states.';
COMMENT ON COLUMN tickets.owner_user_id IS 'Nullable until a guest ticket is attached to an account. The full attach/reassign/detach history lives in ticket_ownership_history; this column is only the current projection.';
