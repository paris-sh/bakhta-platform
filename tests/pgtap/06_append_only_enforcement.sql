-- 06_append_only_enforcement.sql
-- Purpose: verify the BEFORE UPDATE OR DELETE reject_mutation() trigger actually fires on
-- each of the six append-only tables, for both UPDATE and DELETE. This demonstrates the
-- trigger layer of the two-layer defense (0031); the privilege-revocation layer (bakhta_app
-- lacking UPDATE/DELETE grants) additionally requires connecting as bakhta_app, which is
-- exercised separately in tests/concurrency/append_only_privilege_check.sh against a real
-- two-role setup, since pgTAP here runs as the table owner.

BEGIN;
SELECT plan(12);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_admin2 UUID := test_helpers.make_admin();
  v_game   UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv     UUID;
  v_draw   UUID;
  v_order  UUID;
  v_ticket UUID;
  v_result UUID;
  v_run    UUID;
  v_award  UUID;
  v_claim  UUID;
  v_override UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999501);
  v_order := test_helpers.make_order(v_draw);
  v_ticket := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv, 1);
  v_result := test_helpers.make_result(v_draw, 'SIX_CHANCE', v_admin, 1, 'PUBLISHED');
  v_run := test_helpers.make_calculation_run(v_draw, v_result, v_rv, v_admin, 1, 'PUBLISHED');
  v_award := test_helpers.make_award(v_run, v_result, v_draw, v_ticket, 'MAIN4', 600000, TRUE);

  INSERT INTO admin_overrides (admin_id, entity_type, entity_id, action_type, scope, reason, before_snapshot, after_snapshot, impact_snapshot, confirmation_method, effective_at, request_id)
  VALUES (v_admin, 'draws', v_draw, 'RESCHEDULE', 'SPECIFIC_RECORD', 'test', '{}', '{}', '{}', 'TOTP', now(), gen_random_uuid())
  RETURNING id INTO v_override;

  INSERT INTO draw_status_history (draw_id, to_status, actor_type, actor_admin_id, override_id)
  VALUES (v_draw, 'DELAYED', 'ADMIN', v_admin, v_override);

  INSERT INTO prize_claims (claim_number, ticket_id, current_award_id, claimant_type, claimant_user_id, submission_method)
  VALUES ('CLM-AOE-1', v_ticket, v_award, 'USER', test_helpers.make_user(), 'ACCOUNT')
  RETURNING id INTO v_claim;

  INSERT INTO prize_claim_award_links (claim_id, award_id, ticket_id, link_reason, linked_by_type, linked_by_admin_id)
  VALUES (v_claim, v_award, v_ticket, 'INITIAL_CLAIM', 'ADMIN', v_admin);

  INSERT INTO prize_claim_status_history (claim_id, to_status, actor_type, actor_admin_id)
  VALUES (v_claim, 'PENDING_REVIEW', 'ADMIN', v_admin);

  PERFORM set_config('test.override_id', v_override::text, true);
  PERFORM set_config('test.draw_status_history_id', (SELECT id::text FROM draw_status_history WHERE draw_id = v_draw LIMIT 1), true);
  PERFORM set_config('test.claim_id', v_claim::text, true);
  PERFORM set_config('test.award_id', v_award::text, true);
  PERFORM set_config('test.ticket_id', v_ticket::text, true);
END
$do$;

INSERT INTO audit_logs (actor_type, actor_admin_id, action, entity_type, entity_id)
SELECT 'ADMIN', id, 'TEST_ACTION', 'draws', gen_random_uuid() FROM admin_accounts LIMIT 1;

SELECT throws_ok(
  $$ UPDATE audit_logs SET action = 'CHANGED' WHERE action = 'TEST_ACTION' $$,
  NULL, 'audit_logs: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  $$ DELETE FROM audit_logs WHERE action = 'TEST_ACTION' $$,
  NULL, 'audit_logs: DELETE is rejected by the append-only trigger'
);

SELECT throws_ok(
  format($$ UPDATE admin_overrides SET reason = 'changed' WHERE id = '%s' $$, current_setting('test.override_id')),
  NULL, 'admin_overrides: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  format($$ DELETE FROM admin_overrides WHERE id = '%s' $$, current_setting('test.override_id')),
  NULL, 'admin_overrides: DELETE is rejected by the append-only trigger'
);

SELECT throws_ok(
  format($$ UPDATE draw_status_history SET reason = 'changed' WHERE id = '%s' $$, current_setting('test.draw_status_history_id')),
  NULL, 'draw_status_history: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  format($$ DELETE FROM draw_status_history WHERE id = '%s' $$, current_setting('test.draw_status_history_id')),
  NULL, 'draw_status_history: DELETE is rejected by the append-only trigger'
);

SELECT throws_ok(
  format($$ UPDATE prize_claim_award_links SET link_reason = 'RESULT_CORRECTION' WHERE claim_id = '%s' $$, current_setting('test.claim_id')),
  NULL, 'prize_claim_award_links: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  format($$ DELETE FROM prize_claim_award_links WHERE claim_id = '%s' $$, current_setting('test.claim_id')),
  NULL, 'prize_claim_award_links: DELETE is rejected by the append-only trigger'
);

SELECT throws_ok(
  format($$ UPDATE prize_claim_status_history SET reason = 'changed' WHERE claim_id = '%s' $$, current_setting('test.claim_id')),
  NULL, 'prize_claim_status_history: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  format($$ DELETE FROM prize_claim_status_history WHERE claim_id = '%s' $$, current_setting('test.claim_id')),
  NULL, 'prize_claim_status_history: DELETE is rejected by the append-only trigger'
);

DO $do2$
DECLARE v_toh_id UUID;
BEGIN
  INSERT INTO ticket_ownership_history (ticket_id, to_user_id, change_type, actor_type, request_id)
  SELECT current_setting('test.ticket_id')::uuid, claimant_user_id, 'ATTACH', 'SYSTEM', gen_random_uuid()
  FROM prize_claims WHERE id = current_setting('test.claim_id')::uuid
  RETURNING id INTO v_toh_id;
  PERFORM set_config('test.toh_id', v_toh_id::text, true);
END
$do2$;

SELECT throws_ok(
  format($$ UPDATE ticket_ownership_history SET reason = 'changed' WHERE id = '%s' $$, current_setting('test.toh_id')),
  NULL, 'ticket_ownership_history: UPDATE is rejected by the append-only trigger'
);
SELECT throws_ok(
  format($$ DELETE FROM ticket_ownership_history WHERE id = '%s' $$, current_setting('test.toh_id')),
  NULL, 'ticket_ownership_history: DELETE is rejected by the append-only trigger'
);

SELECT * FROM finish();
ROLLBACK;
