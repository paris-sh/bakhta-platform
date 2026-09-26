-- 03_discriminator_and_composite_fk_checks.sql
-- Purpose: exclusive-or discriminator CHECKs (Amendment 9) and the composite foreign keys
-- that pin denormalized columns (draw_id, game_type) to their true source of truth instead
-- of trusting application code.

BEGIN;
SELECT plan(10);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_user   UUID := test_helpers.make_user();
  v_game_sc UUID := test_helpers.make_game('SIX_CHANCE');
  v_game_fl UUID := test_helpers.make_game('FOUR_LEAF');
  v_rv_sc  UUID;
  v_rv_fl  UUID;
  v_draw_sc UUID;
  v_draw_fl UUID;
  v_order  UUID;
  v_ticket_sc UUID;
BEGIN
  v_rv_sc := test_helpers.make_rule_version(v_game_sc, 'SIX_CHANCE', v_admin);
  v_rv_fl := test_helpers.make_rule_version(v_game_fl, 'FOUR_LEAF', v_admin);
  v_draw_sc := test_helpers.make_draw(v_game_sc, 'SIX_CHANCE', v_rv_sc, 999201);
  v_draw_fl := test_helpers.make_draw(v_game_fl, 'FOUR_LEAF', v_rv_fl, 999202);
  v_order := test_helpers.make_order(v_draw_sc);
  v_ticket_sc := test_helpers.make_ticket(v_order, v_draw_sc, 'SIX_CHANCE', v_rv_sc, 1);

  PERFORM set_config('test.admin_id', v_admin::text, true);
  PERFORM set_config('test.user_id', v_user::text, true);
  PERFORM set_config('test.draw_sc', v_draw_sc::text, true);
  PERFORM set_config('test.draw_fl', v_draw_fl::text, true);
  PERFORM set_config('test.order_id', v_order::text, true);
  PERFORM set_config('test.ticket_sc', v_ticket_sc::text, true);
  PERFORM set_config('test.rv_sc', v_rv_sc::text, true);
  PERFORM set_config('test.rv_fl', v_rv_fl::text, true);
END
$do$;

-- orders purchaser xor: USER with guest_email set is rejected
SELECT throws_ok(
  format($$ INSERT INTO orders (order_number, draw_id, purchaser_type, purchaser_user_id, guest_email, status, subtotal_toman, discount_toman, total_toman, idempotency_key)
             VALUES ('ORD-BAD-1', '%s', 'USER', '%s', 'x@test.local', 'CONFIRMED', 1, 0, 1, gen_random_uuid()) $$,
    current_setting('test.draw_sc'), current_setting('test.user_id')),
  '23514', NULL, 'orders: USER purchaser with a non-null guest_email violates the discriminator CHECK'
);

-- orders purchaser xor: GUEST with purchaser_user_id set is rejected
SELECT throws_ok(
  format($$ INSERT INTO orders (order_number, draw_id, purchaser_type, purchaser_user_id, guest_email, status, subtotal_toman, discount_toman, total_toman, idempotency_key)
             VALUES ('ORD-BAD-2', '%s', 'GUEST', '%s', 'x@test.local', 'CONFIRMED', 1, 0, 1, gen_random_uuid()) $$,
    current_setting('test.draw_sc'), current_setting('test.user_id')),
  '23514', NULL, 'orders: GUEST purchaser with a non-null purchaser_user_id violates the discriminator CHECK'
);

-- sessions exactly-one-of xor
SELECT throws_ok(
  format($$ INSERT INTO sessions (principal_type, user_id, admin_id, token_digest, auth_version_at_issue, idle_expires_at, absolute_expires_at)
             VALUES ('USER', '%s', '%s', digest('s1','sha256'), 1, now() + interval '1 hour', now() + interval '1 day') $$,
    current_setting('test.user_id'), current_setting('test.admin_id')),
  '23514', NULL, 'sessions: both user_id and admin_id set violates the exactly-one-of CHECK'
);

SELECT throws_ok(
  $$ INSERT INTO sessions (principal_type, token_digest, auth_version_at_issue, idle_expires_at, absolute_expires_at)
     VALUES ('USER', digest('s2','sha256'), 1, now() + interval '1 hour', now() + interval '1 day') $$,
  '23514', NULL, 'sessions: USER principal with neither id set violates the exactly-one-of CHECK'
);

-- prize_awards CASH vs FREE_TICKET shape
SELECT throws_ok($$
  DO $inner$
  DECLARE v_run UUID; v_result UUID;
  BEGIN
    v_result := test_helpers.make_result(current_setting('test.draw_sc')::uuid, 'SIX_CHANCE', current_setting('test.admin_id')::uuid, 1, 'PUBLISHED');
    v_run := test_helpers.make_calculation_run(current_setting('test.draw_sc')::uuid, v_result, current_setting('test.rv_sc')::uuid, current_setting('test.admin_id')::uuid);
    INSERT INTO prize_awards (calculation_run_id, result_id, draw_id, ticket_id, tier_code, award_type, amount_toman, free_ticket_quantity, is_current, claim_deadline_at)
    VALUES (v_run, v_result, current_setting('test.draw_sc')::uuid, current_setting('test.ticket_sc')::uuid, 'MAIN6_CHANCE', 'CASH', 1000, 1, TRUE, now() + interval '90 days');
  END
  $inner$;
$$, '23514', NULL, 'prize_awards: CASH award with a non-null free_ticket_quantity violates the type-shape CHECK');

-- Composite FK: a ticket cannot be inserted with a draw_id that does not match its order's draw_id
SELECT throws_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-MISMATCH', '%s', '%s', 'SIX_CHANCE', 2, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_id'), current_setting('test.draw_fl'), current_setting('test.rv_sc')),
  '23503', NULL, 'tickets: draw_id not matching the parent order''s own draw_id is rejected by fk_tickets_order_draw'
);

-- Composite FK: a Four Leaf selection cannot attach to a Six Chance ticket
SELECT throws_ok(
  format($$ INSERT INTO four_leaf_ticket_selections (ticket_id, number_value) VALUES ('%s', '5678') $$,
    current_setting('test.ticket_sc')),
  '23503', NULL, 'four_leaf_ticket_selections: cannot attach to a ticket whose game_type is SIX_CHANCE'
);

-- Composite FK: a Six Chance selection cannot attach to a ticket of the wrong game_type either
SELECT throws_ok($$
  DO $inner$
  DECLARE v_order2 UUID; v_ticket_fl UUID;
  BEGIN
    v_order2 := test_helpers.make_order(current_setting('test.draw_fl')::uuid);
    v_ticket_fl := test_helpers.make_ticket(v_order2, current_setting('test.draw_fl')::uuid, 'FOUR_LEAF', current_setting('test.rv_fl')::uuid, 1);
    INSERT INTO six_chance_ticket_selections (ticket_id, n1,n2,n3,n4,n5,n6, symbol) VALUES (v_ticket_fl, 1,2,3,4,5,6,1);
  END
  $inner$;
$$, NULL, 'six_chance_ticket_selections: cannot attach to a ticket whose game_type is FOUR_LEAF');

-- Six Chance selection ordering CHECK: non-increasing numbers rejected
SELECT throws_ok($$
  DO $inner$
  DECLARE v_order3 UUID; v_ticket3 UUID;
  BEGIN
    v_order3 := test_helpers.make_order(current_setting('test.draw_sc')::uuid);
    INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
    VALUES ('TKT-BAD-SEL', v_order3, current_setting('test.draw_sc')::uuid, 'SIX_CHANCE', 1, 'CONFIRMED', 'PENDING', 1, current_setting('test.rv_sc')::uuid)
    RETURNING id INTO v_ticket3;
    INSERT INTO six_chance_ticket_selections (ticket_id, n1,n2,n3,n4,n5,n6, symbol) VALUES (v_ticket3, 6,5,4,3,2,1,1);
  END
  $inner$;
$$, '23514', NULL, 'six_chance_ticket_selections: numbers must be strictly increasing');

-- Four Leaf selection format CHECK: must be exactly four digits
SELECT throws_ok($$
  DO $inner$
  DECLARE v_order4 UUID; v_ticket4 UUID;
  BEGIN
    v_order4 := test_helpers.make_order(current_setting('test.draw_fl')::uuid);
    INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
    VALUES ('TKT-BAD-FL', v_order4, current_setting('test.draw_fl')::uuid, 'FOUR_LEAF', 1, 'CONFIRMED', 'PENDING', 1, current_setting('test.rv_fl')::uuid)
    RETURNING id INTO v_ticket4;
    INSERT INTO four_leaf_ticket_selections (ticket_id, number_value) VALUES (v_ticket4, 'AB12');
  END
  $inner$;
$$, NULL, 'four_leaf_ticket_selections: number_value must be exactly four digit characters');

SELECT * FROM finish();
ROLLBACK;
