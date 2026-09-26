-- 0019_results.up.sql
-- Purpose: versioned result record. A published result is never overwritten in place; a
-- correction creates a new version_number row and supersedes the prior one. Full immutability
-- of published values (results + the value tables in 0020) is enforced by a dedicated
-- trigger in 0032_result_immutability, once those tables both exist.

CREATE TABLE results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id              UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  game_type            game_type_enum NOT NULL,
  version_number       INTEGER NOT NULL,
  status               result_status_enum NOT NULL DEFAULT 'ENTERED',
  is_public_current    BOOLEAN NOT NULL DEFAULT FALSE,
  correction_reason    TEXT,
  entered_by           UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  reviewed_by          UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  published_by         UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  draw_evidence_id     UUID REFERENCES draw_evidence (id) ON DELETE RESTRICT,
  publication_reason   TEXT,
  entered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at          TIMESTAMPTZ,
  published_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_results_draw_version UNIQUE (draw_id, version_number),
  CONSTRAINT uq_results_id_draw UNIQUE (id, draw_id),
  CONSTRAINT uq_results_id_game_type UNIQUE (id, game_type),
  CONSTRAINT fk_results_draw_game_type
    FOREIGN KEY (draw_id, game_type) REFERENCES draws (id, game_type),
  CONSTRAINT ck_results_version_positive CHECK (version_number >= 1),
  -- Section 8: a result cannot be the public-current one unless it is PUBLISHED.
  CONSTRAINT ck_results_public_current_requires_published
    CHECK (NOT is_public_current OR status = 'PUBLISHED'),
  -- Section 8: any version after the first is a correction and must explain itself.
  CONSTRAINT ck_results_correction_reason_required
    CHECK (version_number = 1 OR correction_reason IS NOT NULL),
  -- Section 8: published and superseded results retain their publication evidence fields.
  CONSTRAINT ck_results_publication_fields_required
    CHECK (
      status NOT IN ('PUBLISHED', 'SUPERSEDED') OR
      (published_by IS NOT NULL AND published_at IS NOT NULL AND publication_reason IS NOT NULL)
    ),
  CONSTRAINT ck_results_reviewed_before_published CHECK (
    status NOT IN ('PUBLISHED', 'SUPERSEDED') OR reviewed_by IS NOT NULL
  )
);

CREATE TRIGGER trg_results_set_updated_at
  BEFORE UPDATE ON results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Appendix Key PostgreSQL Constraints: one_public_result_per_draw
CREATE UNIQUE INDEX one_public_result_per_draw
  ON results (draw_id) WHERE is_public_current = TRUE;

CREATE INDEX ix_results_draw ON results (draw_id, version_number);

COMMENT ON TABLE results IS 'Versioned result. The public API returns only the is_public_current row; internal users with permission may read every version and its complete reason/actor history.';
COMMENT ON COLUMN results.entered_by IS 'The first release does not require two different administrators; the same SUPER_ADMIN may enter, review, and publish.';
