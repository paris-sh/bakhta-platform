-- 0031_append_only_enforcement.down.sql
-- Guards every statement on the target table still existing, so this remains safe to run
-- even against a partially-rolled-back database (e.g. a manual recovery sequence where the
-- owning migrations 0011/0012/0016/0024/0025/0026 were already rolled back first).
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
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_append_only ON %I', t, t);
      EXECUTE format('GRANT UPDATE, DELETE ON TABLE %I TO bakhta_app', t);
    END IF;
  END LOOP;
END
$$;
