-- 01_unique_constraints.sql
-- Purpose: spot-check the load-bearing UNIQUE constraints from the Appendix Key PostgreSQL
-- Constraints and Unique Constraints and Concurrency sections. Each is exercised as
-- "second insert with the same key fails", which is also exactly what stops a concurrent
-- duplicate request from being accepted twice.

BEGIN;
SELECT plan(9);

-- Fixture, built once via a DO block; test.* GUCs pass ids to the assertions below.
DO $do$
DECLARE
  v_admin UUID := test_helpers.make_admin();
  v_user  UUID := test_helpers.make_user();
  v_game  UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv    UUID;
  v_draw  UUID;
  v_order UUID;
  v_ticket UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999001);
  v_order := test_helpers.make_order(v_draw);
  v_ticket := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv, 1);

  PERFORM set_config('test.game_code', (SELECT code FROM games WHERE id = v_game), true);
  PERFORM set_config('test.game_id', v_game::text, true);
  PERFORM set_config('test.rule_version_id', v_rv::text, true);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.order_id', v_order::text, true);
  PERFORM set_config('test.ticket_id', v_ticket::text, true);
  PERFORM set_config('test.user_id', v_user::text, true);
END
$do$;

-- games.code
SELECT throws_ok(
  format($$ INSERT INTO games (code, game_type, slug, name_fa, name_en) VALUES ('%s','SIX_CHANCE','sc-x','a','a') $$,
    current_setting('test.game_code')),
  '23505', NULL, 'games.code unique constraint rejects a duplicate code'
);

-- draws (game_id, draw_number)
SELECT throws_ok(
  format($$ INSERT INTO draws (game_id, game_type, draw_number, status, sales_opens_at, sales_closes_at, draw_at, official_timezone, current_rule_version_id, current_rules_snapshot)
             VALUES ('%s','SIX_CHANCE',999001,'SALES_OPEN', now(), now() + interval '1 day', now() + interval '2 days', 'Asia/Tehran', '%s', '{}') $$,
    current_setting('test.game_id'), current_setting('test.rule_version_id')),
  '23505', NULL, 'draws (game_id, draw_number) rejects a duplicate draw number within the same game'
);

-- orders.idempotency_key
SELECT throws_ok(
  format($$ INSERT INTO orders (order_number, draw_id, purchaser_type, guest_email, status, subtotal_toman, discount_toman, total_toman, idempotency_key)
             SELECT 'ORD-RETRY', draw_id, 'GUEST', 'g2@test.local', 'CONFIRMED', 1, 0, 1, idempotency_key
             FROM orders WHERE id = (SELECT order_id FROM tickets WHERE id = '%s') $$,
    current_setting('test.ticket_id')),
  '23505', NULL, 'orders.idempotency_key rejects a retried duplicate key'
);

-- tickets (order_id, line_number)
SELECT throws_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-DIFFERENT-CODE', '%s', '%s', 'SIX_CHANCE', 1, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_id'), current_setting('test.draw_id'), current_setting('test.rule_version_id')),
  '23505', NULL, 'tickets (order_id, line_number) rejects a duplicate line number within the same order'
);

-- tickets.public_code
SELECT throws_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             SELECT public_code, '%s', '%s', 'SIX_CHANCE', 2, 'CONFIRMED', 'PENDING', 1, '%s'
             FROM tickets WHERE id = '%s' $$,
    current_setting('test.order_id'), current_setting('test.draw_id'), current_setting('test.rule_version_id'),
    current_setting('test.ticket_id')),
  '23505', NULL, 'tickets.public_code rejects reuse of an existing public code'
);

-- claim_credentials.token_digest
SELECT lives_ok(
  format($$ INSERT INTO claim_credentials (ticket_id, token_digest) VALUES ('%s', digest('token-a','sha256')) $$,
    current_setting('test.ticket_id')),
  'claim_credentials: first credential for the ticket succeeds'
);

SELECT throws_ok(
  format($$ INSERT INTO claim_credentials (ticket_id, token_digest) VALUES ('%s', digest('token-a','sha256')) $$,
    current_setting('test.ticket_id')),
  '23505', NULL, 'claim_credentials.token_digest rejects digest reuse (also blocked separately by one_active_claim_token_per_ticket)'
);

-- prize_claims.ticket_id (Appendix: UNIQUE (ticket_id))
SELECT lives_ok(
  format($$ INSERT INTO prize_claims (claim_number, ticket_id, claimant_type, claim_credential_id, submission_method)
             SELECT 'CLM-0001', '%s', 'GUEST', id, 'CLAIM_TOKEN' FROM claim_credentials WHERE ticket_id = '%s' $$,
    current_setting('test.ticket_id'), current_setting('test.ticket_id')),
  'prize_claims: first claim for the ticket succeeds'
);

SELECT throws_ok(
  format($$ INSERT INTO prize_claims (claim_number, ticket_id, claimant_type, claimant_user_id, submission_method)
             VALUES ('CLM-0002', '%s', 'USER', '%s', 'ADMIN_ASSISTED') $$,
    current_setting('test.ticket_id'), current_setting('test.user_id')),
  '23505', NULL, 'prize_claims.ticket_id rejects a second continuing claim on the same ticket'
);

SELECT * FROM finish();
ROLLBACK;
