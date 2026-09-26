-- 0017_ticket_selections.down.sql
DROP TRIGGER IF EXISTS trg_tickets_selection_cardinality ON tickets;
DROP FUNCTION IF EXISTS validate_ticket_selection_cardinality();
DROP TABLE IF EXISTS six_chance_ticket_selections;
DROP TABLE IF EXISTS four_leaf_ticket_selections;
