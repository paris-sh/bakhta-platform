-- 02_partial_unique_indexes.sql
-- Purpose: verify every partial unique index from the Appendix (one_active_rule_version_per_game,
-- one_public_result_per_draw, one_current_award_per_ticket, one_active_claim_token_per_ticket,
-- one_active_assignment_per_role) actually blocks a second "active" row while allowing any
-- number of inactive/historical rows.

BEGIN;
SELECT plan(10);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_admin2 UUID := test_helpers.make_admin();
  v_game   UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv1    UUID;
  v_draw   UUID;
  v_order  UUID;
  v_ticket UUID;
  v_role   UUID;
BEGIN
  v_rv1 := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv1, 999101);
  v_order := test_helpers.make_order(v_draw);
  v_ticket := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv1, 1);

  INSERT INTO roles (code, name) VALUES ('TEST_ROLE_' || substr(gen_random_uuid()::text,1,8), 'Test Role')
  RETURNING id INTO v_role;

  PERFORM set_config('test.game_id', v_game::text, true);
  PERFORM set_config('test.rule_version_id', v_rv1::text, true);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.ticket_id', v_ticket::text, true);
  PERFORM set_config('test.admin_id', v_admin::text, true);
  PERFORM set_config('test.admin2_id', v_admin2::text, true);
  PERFORM set_config('test.role_id', v_role::text, true);
END
$do$;

-- one_active_rule_version_per_game: a second ACTIVE version for the same game is rejected...
SELECT throws_ok(
  format($$ INSERT INTO game_rule_versions (game_id, game_type, version_number, status, rules, rules_hash, change_reason, created_by, activated_by, activated_at)
             VALUES ('%s', 'SIX_CHANCE', 2, 'ACTIVE', '{"schema_version":1}', digest('x','sha256'), 'test', '%s', '%s', now()) $$,
    current_setting('test.game_id'), current_setting('test.admin_id'), current_setting('test.admin_id')),
  '23505', NULL, 'one_active_rule_version_per_game rejects a second ACTIVE version for the same game'
);

-- ...but a DRAFT version for the same game is fine.
SELECT lives_ok(
  format($$ INSERT INTO game_rule_versions (game_id, game_type, version_number, status, rules, rules_hash, change_reason, created_by)
             VALUES ('%s', 'SIX_CHANCE', 2, 'DRAFT', '{"schema_version":1}', digest('x','sha256'), 'test', '%s') $$,
    current_setting('test.game_id'), current_setting('test.admin_id')),
  'one_active_rule_version_per_game allows a second DRAFT version alongside the ACTIVE one'
);

-- one_public_result_per_draw
SELECT lives_ok($$
  DO $inner$
  DECLARE v_result UUID;
  BEGIN
    v_result := test_helpers.make_result(current_setting('test.draw_id')::uuid, 'SIX_CHANCE', current_setting('test.admin_id')::uuid, 1, 'PUBLISHED');
    PERFORM set_config('test.result_id', v_result::text, true);
  END
  $inner$;
$$, 'results: first PUBLISHED, is_public_current result for the draw succeeds');

SELECT throws_ok(
  format($$ INSERT INTO results (draw_id, game_type, version_number, status, is_public_current, correction_reason, entered_by, reviewed_by, published_by, publication_reason, reviewed_at, published_at)
             VALUES ('%s', 'SIX_CHANCE', 99, 'PUBLISHED', TRUE, 'test correction', '%s', '%s', '%s', 'x', now(), now()) $$,
    current_setting('test.draw_id'), current_setting('test.admin_id'), current_setting('test.admin_id'), current_setting('test.admin_id')),
  '23505', NULL, 'one_public_result_per_draw rejects a second is_public_current result for the same draw'
);

-- one_current_award_per_ticket
SELECT lives_ok($$
  DO $inner$
  DECLARE v_run UUID;
  BEGIN
    v_run := test_helpers.make_calculation_run(
      current_setting('test.draw_id')::uuid, current_setting('test.result_id')::uuid,
      current_setting('test.rule_version_id')::uuid, current_setting('test.admin_id')::uuid, 1, 'PUBLISHED'
    );
    PERFORM test_helpers.make_award(v_run, current_setting('test.result_id')::uuid, current_setting('test.draw_id')::uuid, current_setting('test.ticket_id')::uuid, 'MAIN4', 600000, TRUE);
    PERFORM set_config('test.run_id', v_run::text, true);
  END
  $inner$;
$$, 'prize_awards: first is_current award for the ticket succeeds');

SELECT throws_ok($$
  DO $inner$
  DECLARE v_run2 UUID;
  BEGIN
    v_run2 := test_helpers.make_calculation_run(
      current_setting('test.draw_id')::uuid, current_setting('test.result_id')::uuid,
      current_setting('test.rule_version_id')::uuid, current_setting('test.admin_id')::uuid, 2, 'PUBLISHED'
    );
    PERFORM test_helpers.make_award(v_run2, current_setting('test.result_id')::uuid, current_setting('test.draw_id')::uuid, current_setting('test.ticket_id')::uuid, 'MAIN4', 600000, TRUE);
  END
  $inner$;
$$, NULL, 'one_current_award_per_ticket rejects a second is_current award for the same ticket');

-- one_active_claim_token_per_ticket
SELECT lives_ok(
  format($$ INSERT INTO claim_credentials (ticket_id, token_digest) VALUES ('%s', digest('cred-a','sha256')) $$,
    current_setting('test.ticket_id')),
  'claim_credentials: first ACTIVE credential for the ticket succeeds'
);

SELECT throws_ok(
  format($$ INSERT INTO claim_credentials (ticket_id, token_digest) VALUES ('%s', digest('cred-b','sha256')) $$,
    current_setting('test.ticket_id')),
  '23505', NULL, 'one_active_claim_token_per_ticket rejects a second ACTIVE credential for the same ticket'
);

-- one_active_assignment_per_role
SELECT lives_ok(
  format($$ INSERT INTO admin_role_assignments (admin_id, role_id) VALUES ('%s', '%s') $$,
    current_setting('test.admin2_id'), current_setting('test.role_id')),
  'admin_role_assignments: first active assignment succeeds'
);

SELECT throws_ok(
  format($$ INSERT INTO admin_role_assignments (admin_id, role_id) VALUES ('%s', '%s') $$,
    current_setting('test.admin2_id'), current_setting('test.role_id')),
  '23505', NULL, 'one_active_assignment_per_role rejects a second active assignment for the same admin/role pair'
);

SELECT * FROM finish();
ROLLBACK;
