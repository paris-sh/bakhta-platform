-- 0031_append_only_enforcement.up.sql
-- Purpose: make the six append-only history tables genuinely immutable at the database
-- layer, per the product owner's amendment #7, using both mechanisms together:
--   1. REVOKE UPDATE, DELETE from the runtime application role (bakhta_app), so a bug or a
--      compromised application credential cannot mutate history even by accident.
--   2. A BEFORE UPDATE OR DELETE trigger that unconditionally raises, so even a role that
--      still has the privilege (e.g. during an emergency break-glass session as the
--      owner/migrator role) is stopped unless the trigger is explicitly disabled first —
--      making any bypass a deliberate, auditable, two-step action rather than an ordinary
--      UPDATE statement.
--
-- These tables are owned by the migrator/owner role that ran migrations 0011-0026, never
-- by bakhta_app — database-owner access remains an infrastructure responsibility, separate
-- from application administration, per the spec's Data Architecture Principles.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs',
    'admin_overrides',
    'draw_status_history',
    'prize_claim_award_links',
    'prize_claim_status_history',
    'ticket_ownership_history'
  ]
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE %I FROM bakhta_app', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION reject_mutation()', t, t
    );
  END LOOP;
END
$$;
