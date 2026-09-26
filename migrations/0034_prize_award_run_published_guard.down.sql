-- 0034_prize_award_run_published_guard.down.sql
DROP TRIGGER IF EXISTS trg_prize_awards_current_requires_published_run ON prize_awards;
DROP FUNCTION IF EXISTS enforce_current_award_run_published();
