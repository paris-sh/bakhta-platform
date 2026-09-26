-- 0010_draws.up.sql
-- Purpose: one concrete, versioned draw instance. The recurring schedule template itself is
-- not modeled as a table in this release (out of scope for the First Coding Deliverable);
-- each draw this generates is stored here as an independent business record.

CREATE TABLE draws (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                  UUID NOT NULL REFERENCES games (id) ON DELETE RESTRICT,
  game_type                game_type_enum NOT NULL,
  draw_number              BIGINT NOT NULL,
  status                   draw_status_enum NOT NULL DEFAULT 'SALES_OPEN',
  sales_opens_at           TIMESTAMPTZ NOT NULL,
  sales_closes_at          TIMESTAMPTZ NOT NULL,
  draw_at                  TIMESTAMPTZ NOT NULL,
  official_timezone        VARCHAR NOT NULL,
  current_rule_version_id  UUID NOT NULL REFERENCES game_rule_versions (id) ON DELETE RESTRICT,
  current_rules_snapshot   JSONB NOT NULL,
  opening_jackpot_toman    toman_amount,
  final_jackpot_toman      toman_amount,
  youtube_live_url         TEXT,
  published_at             TIMESTAMPTZ,
  settled_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_draws_game_draw_number UNIQUE (game_id, draw_number),
  CONSTRAINT uq_draws_id_game UNIQUE (id, game_id),
  CONSTRAINT uq_draws_id_game_type UNIQUE (id, game_type),
  CONSTRAINT fk_draws_game_type
    FOREIGN KEY (game_id, game_type) REFERENCES games (id, game_type),
  CONSTRAINT fk_draws_rule_version_game
    FOREIGN KEY (current_rule_version_id, game_id) REFERENCES game_rule_versions (id, game_id),
  CONSTRAINT ck_draws_sales_window CHECK (sales_opens_at < sales_closes_at),
  CONSTRAINT ck_draws_draw_after_cutoff CHECK (sales_closes_at <= draw_at),
  CONSTRAINT ck_draws_draw_number_positive CHECK (draw_number >= 1),
  CONSTRAINT ck_draws_jackpot_only_six_chance
    CHECK (game_type = 'SIX_CHANCE' OR (opening_jackpot_toman IS NULL AND final_jackpot_toman IS NULL))
);

CREATE TRIGGER trg_draws_set_updated_at
  BEFORE UPDATE ON draws
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_draws_game_status ON draws (game_id, status);
CREATE INDEX ix_draws_sales_closes_at ON draws (sales_closes_at);

COMMENT ON TABLE draws IS 'Concrete draw instance. Time-ordering checks enforce sales_opens_at < sales_closes_at <= draw_at; a SUPER_ADMIN reschedule updates these fields directly and is itself recorded via admin_overrides + draw_status_history, not by relaxing these CHECKs.';
COMMENT ON COLUMN draws.current_rule_version_id IS 'Rule version applied to new purchases for this draw; independent of the game-wide ACTIVE version so a draw can pin its own effective version.';
