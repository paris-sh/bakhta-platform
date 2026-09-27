-- 0039_scheduled_occurrences.down.sql
-- Reverses 0039. Destructive: dismissal rows and the draws' occurrence claims are dropped, and
-- restoring the looser cutoff check always succeeds.
BEGIN;
DROP TRIGGER IF EXISTS trg_occurrence_dismissal_guard ON scheduled_occurrence_dismissals;
DROP TRIGGER IF EXISTS trg_draws_occurrence_claim ON draws;
DROP FUNCTION IF EXISTS guard_occurrence_dismissal();
DROP FUNCTION IF EXISTS guard_draw_occurrence_claim();
DROP FUNCTION IF EXISTS occurrence_lock_key(UUID, TEXT, DATE);
DROP TABLE IF EXISTS scheduled_occurrence_dismissals;
DROP FUNCTION IF EXISTS reject_occurrence_dismissal_change();
ALTER TABLE draws DROP CONSTRAINT ck_draws_draw_after_cutoff;
ALTER TABLE draws ADD CONSTRAINT ck_draws_draw_after_cutoff CHECK (sales_closes_at <= draw_at);
DROP INDEX IF EXISTS uq_draws_scheduled_occurrence;
ALTER TABLE draws
  DROP CONSTRAINT IF EXISTS ck_draws_schedule_claim_complete,
  DROP COLUMN IF EXISTS schedule_claim,
  DROP COLUMN IF EXISTS schedule_timezone,
  DROP COLUMN IF EXISTS scheduled_draw_at,
  DROP COLUMN IF EXISTS scheduled_local_date,
  DROP COLUMN IF EXISTS scheduled_slot_id;
COMMIT;
