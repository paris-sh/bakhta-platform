-- 0039_scheduled_occurrences.up.sql
-- Purpose: reminder-only scheduling. The schedule never creates draws; it derives expected
-- occurrences identified by (game, schedule slot, intended local date). A SUPER_ADMIN's
-- manually created draw may CLAIM one occurrence (it then snapshots the slot id, local date,
-- intended timestamp and timezone), or a missed occurrence may be DISMISSED with a reason.
-- Uniqueness and exclusivity are enforced here, not only in application code.

BEGIN;

ALTER TABLE draws
  ADD COLUMN scheduled_slot_id     VARCHAR(40),
  ADD COLUMN scheduled_local_date  DATE,
  ADD COLUMN scheduled_draw_at     TIMESTAMPTZ,
  ADD COLUMN schedule_timezone     VARCHAR(64),
  -- SCHEDULED: created from the reminder; REPLACEMENT: a special draw that explicitly
  -- replaces the occurrence. NULL (all five columns) = a special draw claiming nothing.
  ADD COLUMN schedule_claim        VARCHAR(12),
  ADD CONSTRAINT ck_draws_schedule_claim_complete CHECK (
    (scheduled_slot_id IS NULL AND scheduled_local_date IS NULL AND scheduled_draw_at IS NULL
      AND schedule_timezone IS NULL AND schedule_claim IS NULL)
    OR
    (scheduled_slot_id IS NOT NULL AND scheduled_local_date IS NOT NULL AND scheduled_draw_at IS NOT NULL
      AND schedule_timezone IS NOT NULL AND schedule_claim IN ('SCHEDULED', 'REPLACEMENT'))
  );

-- One live draw per occurrence. A CANCELLED/VOID draw releases its occurrence.
CREATE UNIQUE INDEX uq_draws_scheduled_occurrence
  ON draws (game_id, scheduled_slot_id, scheduled_local_date)
  WHERE scheduled_slot_id IS NOT NULL AND status NOT IN ('CANCELLED', 'VOID');

-- Sales open < sales close < draw time (a draw at the very moment sales close is not a window).
ALTER TABLE draws DROP CONSTRAINT ck_draws_draw_after_cutoff;
ALTER TABLE draws ADD CONSTRAINT ck_draws_draw_after_cutoff CHECK (sales_closes_at < draw_at);

-- A missed (or unwanted) occurrence dismissed by a SUPER_ADMIN, with a reason. Append-only.
CREATE TABLE scheduled_occurrence_dismissals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            UUID NOT NULL REFERENCES games (id) ON DELETE RESTRICT,
  slot_id            VARCHAR(40) NOT NULL,
  local_date         DATE NOT NULL,
  scheduled_draw_at  TIMESTAMPTZ NOT NULL,
  schedule_timezone  VARCHAR(64) NOT NULL,
  reason             TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 5),
  dismissed_by       UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_scheduled_occurrence_dismissal UNIQUE (game_id, slot_id, local_date)
);

CREATE FUNCTION reject_occurrence_dismissal_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scheduled_occurrence_dismissals is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER trg_occurrence_dismissals_append_only
  BEFORE UPDATE OR DELETE ON scheduled_occurrence_dismissals
  FOR EACH ROW EXECUTE FUNCTION reject_occurrence_dismissal_change();

-- A claimed occurrence cannot be dismissed and a dismissed one cannot be claimed. Both sides
-- take the same transaction-level advisory lock, so concurrent writers serialize.
CREATE FUNCTION occurrence_lock_key(p_game UUID, p_slot TEXT, p_date DATE) RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$
  SELECT hashtextextended(p_game::text || '/' || p_slot || '/' || p_date::text, 0)
$$;

CREATE FUNCTION guard_draw_occurrence_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The original occurrence identity survives every later edit of the draw's times.
    IF NEW.scheduled_slot_id IS DISTINCT FROM OLD.scheduled_slot_id
       OR NEW.scheduled_local_date IS DISTINCT FROM OLD.scheduled_local_date
       OR NEW.scheduled_draw_at IS DISTINCT FROM OLD.scheduled_draw_at
       OR NEW.schedule_timezone IS DISTINCT FROM OLD.schedule_timezone
       OR NEW.schedule_claim IS DISTINCT FROM OLD.schedule_claim THEN
      RAISE EXCEPTION 'a draw''s scheduled occurrence identity cannot be changed' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.scheduled_slot_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(occurrence_lock_key(NEW.game_id, NEW.scheduled_slot_id, NEW.scheduled_local_date));
    IF EXISTS (
      SELECT 1 FROM scheduled_occurrence_dismissals
      WHERE game_id = NEW.game_id AND slot_id = NEW.scheduled_slot_id AND local_date = NEW.scheduled_local_date
    ) THEN
      RAISE EXCEPTION 'this scheduled occurrence was dismissed' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_draws_occurrence_claim
  BEFORE INSERT OR UPDATE ON draws
  FOR EACH ROW EXECUTE FUNCTION guard_draw_occurrence_claim();

CREATE FUNCTION guard_occurrence_dismissal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(occurrence_lock_key(NEW.game_id, NEW.slot_id, NEW.local_date));
  IF EXISTS (
    SELECT 1 FROM draws
    WHERE game_id = NEW.game_id AND scheduled_slot_id = NEW.slot_id AND scheduled_local_date = NEW.local_date
      AND status NOT IN ('CANCELLED', 'VOID')
  ) THEN
    RAISE EXCEPTION 'this scheduled occurrence already has a draw' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_occurrence_dismissal_guard
  BEFORE INSERT ON scheduled_occurrence_dismissals
  FOR EACH ROW EXECUTE FUNCTION guard_occurrence_dismissal();

COMMIT;
