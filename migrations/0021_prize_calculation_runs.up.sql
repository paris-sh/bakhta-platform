-- 0021_prize_calculation_runs.up.sql
-- Purpose: preview and settlement calculation runs. Several runs may exist per result
-- (iterative previews before approval); exactly one run per result is ever APPROVED then
-- PUBLISHED, and only that run's awards may become the ticket's current award (enforced in
-- 0034 once prize_awards exists). The composite unique constraints below exist purely to
-- serve as FK targets so prize_awards can pin its result_id/draw_id to this run's own values
-- with a real foreign key instead of a trigger.

CREATE TABLE prize_calculation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id           UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  result_id         UUID NOT NULL REFERENCES results (id) ON DELETE RESTRICT,
  rule_version_id   UUID NOT NULL REFERENCES game_rule_versions (id) ON DELETE RESTRICT,
  override_id       UUID REFERENCES admin_overrides (id) ON DELETE RESTRICT,
  run_number        INTEGER NOT NULL,
  status            calc_run_status_enum NOT NULL DEFAULT 'RUNNING',
  calculation_hash  sha256_digest NOT NULL,
  summary           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  approved_by       UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  CONSTRAINT uq_prize_calculation_runs_result_run UNIQUE (result_id, run_number),
  CONSTRAINT uq_prize_calculation_runs_id_result UNIQUE (id, result_id),
  CONSTRAINT uq_prize_calculation_runs_id_draw UNIQUE (id, draw_id),
  -- Ensures the given result_id actually belongs to the given draw_id (results has
  -- UNIQUE(id, draw_id) from 0019).
  CONSTRAINT fk_prize_calculation_runs_result_draw
    FOREIGN KEY (result_id, draw_id) REFERENCES results (id, draw_id),
  CONSTRAINT ck_prize_calculation_runs_run_number_positive CHECK (run_number >= 1),
  CONSTRAINT ck_prize_calculation_runs_approval_fields CHECK (
    status NOT IN ('APPROVED', 'PUBLISHED') OR
    (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX ix_prize_calculation_runs_draw ON prize_calculation_runs (draw_id);
CREATE INDEX ix_prize_calculation_runs_result ON prize_calculation_runs (result_id);

COMMENT ON TABLE prize_calculation_runs IS 'Idempotent calculation run and hash. summary carries winner counts, caps, jackpot effects, total liability, warnings, and (Four Leaf) the actual remainder and applied rounding rule for this run.';
