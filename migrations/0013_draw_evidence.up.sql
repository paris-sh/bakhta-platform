-- 0013_draw_evidence.up.sql
-- Purpose: YouTube Live evidence for a physical draw. A row here is versioned by inserting
-- a new row (e.g. an updated archive_url after the stream ends); a separately recorded
-- replacement video must never be substituted as source evidence — enforced procedurally
-- (status transitions), not by a schema constraint, since "is this really the same live
-- stream" is not a database-checkable fact.

CREATE TABLE draw_evidence (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id            UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  youtube_live_url   TEXT NOT NULL,
  youtube_video_id   VARCHAR NOT NULL,
  scheduled_at       TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  archive_url        TEXT,
  evidence_hash      BYTEA,
  status             draw_evidence_status_enum NOT NULL DEFAULT 'SCHEDULED',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_draw_evidence_timing CHECK (
    started_at IS NULL OR scheduled_at IS NULL OR started_at >= scheduled_at
  ),
  CONSTRAINT ck_draw_evidence_ended_after_started CHECK (
    ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at
  )
);

CREATE TRIGGER trg_draw_evidence_set_updated_at
  BEFORE UPDATE ON draw_evidence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_draw_evidence_draw ON draw_evidence (draw_id);

COMMENT ON TABLE draw_evidence IS 'Scheduled YouTube Live broadcast evidence. Blockchain-generated randomness is explicitly excluded from this design.';
