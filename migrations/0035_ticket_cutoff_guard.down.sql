-- 0035_ticket_cutoff_guard.down.sql
DROP TRIGGER IF EXISTS trg_tickets_confirmation_cutoff ON tickets;
DROP FUNCTION IF EXISTS enforce_ticket_confirmation_cutoff();
