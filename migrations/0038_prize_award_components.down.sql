-- 0038_prize_award_components.down.sql
-- Reverses 0038 except the 'MIXED' enum value, which PostgreSQL cannot drop in place (it is
-- harmless once no row uses it). Destructive like the other down migrations: component rows
-- are dropped with their table, and restoring the old type-shape check fails while any MIXED
-- award exists — run only where none do.
BEGIN;
DROP TRIGGER IF EXISTS trg_prize_awards_components_match ON prize_awards;
DROP FUNCTION IF EXISTS validate_prize_award_components();
DROP TABLE IF EXISTS prize_award_components;
ALTER TABLE prize_awards DROP CONSTRAINT ck_prize_awards_type_shape;
ALTER TABLE prize_awards ADD CONSTRAINT ck_prize_awards_type_shape CHECK (
  (award_type = 'CASH'        AND amount_toman IS NOT NULL AND free_ticket_quantity IS NULL) OR
  (award_type = 'FREE_TICKET' AND free_ticket_quantity IS NOT NULL AND amount_toman IS NULL)
);
COMMIT;
