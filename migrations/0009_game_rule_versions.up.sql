-- 0009_game_rule_versions.up.sql
-- Purpose: versioned, validated game configuration. `rules` is the complete configurable
-- rule payload (prices, prizes, caps, schedule shape, jackpot settings, and — per the
-- product owner's amendment — the Four Leaf rounding policy). Full JSON-schema validation
-- of `rules` is an explicit Production Readiness Dependency ("During database work") and is
-- deliberately not fully encoded as SQL CHECKs here; only the load-bearing invariants that
-- were explicitly decided are enforced below.

CREATE TABLE game_rule_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games (id) ON DELETE RESTRICT,
  game_type       game_type_enum NOT NULL,
  version_number  INTEGER NOT NULL,
  status          rule_version_status_enum NOT NULL DEFAULT 'DRAFT',
  rules           JSONB NOT NULL,
  rules_hash      sha256_digest NOT NULL,
  change_reason   TEXT NOT NULL,
  created_by      UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  activated_by    UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at    TIMESTAMPTZ,
  retired_at      TIMESTAMPTZ,
  CONSTRAINT uq_game_rule_versions_game_version UNIQUE (game_id, version_number),
  CONSTRAINT uq_game_rule_versions_id_game UNIQUE (id, game_id),
  CONSTRAINT uq_game_rule_versions_id_game_type UNIQUE (id, game_type),
  CONSTRAINT fk_game_rule_versions_game_type
    FOREIGN KEY (game_id, game_type) REFERENCES games (id, game_type),
  CONSTRAINT ck_game_rule_versions_version_positive CHECK (version_number >= 1),
  CONSTRAINT ck_game_rule_versions_activation_fields
    CHECK (status = 'DRAFT' OR (activated_by IS NOT NULL AND activated_at IS NOT NULL)),
  -- Amendment: the Four Leaf cap remainder/rounding policy must live in the versioned rule
  -- payload, not only inside a calculation run's summary.
  CONSTRAINT ck_game_rule_versions_four_leaf_rounding
    CHECK (
      game_type <> 'FOUR_LEAF' OR
      (rules ? 'rounding_unit_toman' AND rules ? 'remainder_destination')
    )
);

-- Appendix Key PostgreSQL Constraints: one_active_rule_version_per_game
CREATE UNIQUE INDEX one_active_rule_version_per_game
  ON game_rule_versions (game_id) WHERE status = 'ACTIVE';

COMMENT ON TABLE game_rule_versions IS 'Complete validated rule payload per game version. Purchase-time and draw-time references pin a specific version_number, never "current".';
COMMENT ON COLUMN game_rule_versions.rules IS 'Includes price, prize tiers, caps, schedule shape, jackpot settings, and (Four Leaf) rounding_unit_toman / remainder_destination.';
