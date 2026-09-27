-- 11_six_chance_system_selections.sql
-- Purpose: migration 0037 — Six Chance system-play storage. Covers the combination-count
-- math, pool shape constraints, ticket↔selection combination_count pinning, the generated
-- line total, exact-pick backward compatibility, and the extended exactly-one-selection
-- rule (exact XOR system). Everything runs inside one transaction and ROLLBACKs.

BEGIN;
SELECT plan(22);

-- ---------------------------------------------------------------- math
SELECT is(six_chance_combination_count(6, 1), 1::bigint, '6 numbers × 1 symbol = 1 combination');
SELECT is(six_chance_combination_count(7, 2), 14::bigint, '7 numbers × 2 symbols = 14 combinations');
SELECT is(six_chance_combination_count(8, 3), 84::bigint, '8 numbers × 3 symbols = 84 combinations');
SELECT is(six_chance_combination_count(12, 5), 4620::bigint, '12 numbers × 5 symbols = 4620 combinations');
SELECT is(six_chance_combination_count(5, 1), 0::bigint, 'fewer than 6 numbers covers no combination');

DO $do$
DECLARE
  v_admin UUID := test_helpers.make_admin();
  v_game  UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv    UUID;
  v_draw  UUID;
  v_order UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999311);
  v_order := test_helpers.make_order(v_draw);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.order_id', v_order::text, true);
  PERFORM set_config('test.rule_version_id', v_rv::text, true);
END
$do$;

-- Inserts a bare PENDING Six Chance ticket (no selection) and returns its id.
CREATE FUNCTION pg_temp.bare_ticket(p_line INTEGER, p_combinations INTEGER) RETURNS UUID AS $$
  INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status,
                       outcome_status, unit_price_toman, rule_version_id, combination_count)
  VALUES ('TKT-SYS-' || p_line, current_setting('test.order_id')::uuid,
          current_setting('test.draw_id')::uuid, 'SIX_CHANCE', p_line, 'PENDING', 'PENDING',
          300000, current_setting('test.rule_version_id')::uuid, p_combinations)
  RETURNING id;
$$ LANGUAGE sql;

-- ---------------------------------------------------------------- backward compatibility
SELECT lives_ok($$
  DO $inner$
  BEGIN
    PERFORM test_helpers.make_ticket(
      current_setting('test.order_id')::uuid, current_setting('test.draw_id')::uuid,
      'SIX_CHANCE', current_setting('test.rule_version_id')::uuid, 1
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  END
  $inner$;
$$, 'an exact pick written the pre-0037 way (no combination_count given) still satisfies every check');

SELECT is(
  (SELECT combination_count || '/' || line_total_toman FROM tickets WHERE line_number = 1
     AND order_id = current_setting('test.order_id')::uuid),
  '1/100000', 'an exact ticket defaults to combination_count 1 and line_total = unit price');

-- ---------------------------------------------------------------- valid system line
SELECT lives_ok($$
  DO $inner$
  DECLARE v_t UUID := pg_temp.bare_ticket(2, 14);
  BEGIN
    INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
    VALUES (v_t, '{1,2,3,4,5,6,7}', '{1,2}', 14);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  END
  $inner$;
$$, 'a 7-number × 2-symbol system line with combination_count 14 is accepted');

SELECT is(
  (SELECT line_total_toman FROM tickets WHERE public_code = 'TKT-SYS-2')::bigint,
  4200000::bigint, 'line_total_toman is generated as unit price × combination_count (300000 × 14)');

SELECT throws_ok(
  $$ UPDATE tickets SET line_total_toman = 1 WHERE public_code = 'TKT-SYS-2' $$,
  '428C9', NULL, 'line_total_toman cannot be written directly');

SELECT throws_ok(
  $$ UPDATE tickets SET combination_count = 15 WHERE public_code = 'TKT-SYS-2' $$,
  '23503', NULL, 'the ticket''s combination_count cannot drift from its system selection (composite FK)');

-- ---------------------------------------------------------------- shape constraints
SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(3, 14), '{1,2,3,4,5,6,7}', '{1,2}', 13)
$$, '23514', NULL, 'a combination_count that does not match the pools is rejected');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(4, 14), '{1,2,3,4,5,7,6}', '{1,2}', 14)
$$, '23514', NULL, 'unsorted numbers are rejected');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(5, 14), '{1,2,3,4,5,6,6}', '{1,2}', 14)
$$, '23514', NULL, 'repeated numbers are rejected');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(6, 14), '{1,2,3,4,5,6,34}', '{1,2}', 14)
$$, '23514', NULL, 'a number outside 1–33 is rejected');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(7, 14), '{1,2,3,4,5,6,7}', '{1,6}', 14)
$$, '23514', NULL, 'a symbol outside 1–5 is rejected');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(8, 1), '{1,2,3,4,5,6}', '{1}', 1)
$$, '23514', NULL, 'a single-combination line may not use the system table (exact picks are canonical)');

SELECT throws_ok($$
  INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
  VALUES (pg_temp.bare_ticket(9, 20), '{1,2,3,4,5,6,7}', '{1,2}', 14)
$$, '23503', NULL, 'a system row whose ticket is priced at a different combination_count (20 vs 14) is rejected');

-- ---------------------------------------------------------------- exactly one selection type
SELECT throws_ok($$
  DO $inner$
  DECLARE v_t UUID := pg_temp.bare_ticket(10, 14);
  BEGIN
    INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
    VALUES (v_t, '{1,2,3,4,5,6,7}', '{1,2}', 14);
    INSERT INTO six_chance_ticket_selections (ticket_id, n1, n2, n3, n4, n5, n6, symbol)
    VALUES (v_t, 1, 2, 3, 4, 5, 6, 1);
    SET CONSTRAINTS ALL IMMEDIATE;
  END
  $inner$;
$$, 'P0001', NULL, 'a ticket with BOTH an exact and a system selection fails the deferred cardinality check');

SELECT throws_ok($$
  DO $inner$
  DECLARE v_t UUID := pg_temp.bare_ticket(11, 2);
  BEGIN
    INSERT INTO six_chance_ticket_selections (ticket_id, n1, n2, n3, n4, n5, n6, symbol)
    VALUES (v_t, 1, 2, 3, 4, 5, 6, 1);
    SET CONSTRAINTS ALL IMMEDIATE;
  END
  $inner$;
$$, 'P0001', NULL, 'an exact selection on a ticket priced as 2 combinations fails the deferred check');

SELECT throws_ok($$
  DO $inner$
  DECLARE v_t UUID := pg_temp.bare_ticket(12, 1);
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
  END
  $inner$;
$$, 'P0001', NULL, 'a Six Chance ticket with no selection at all still fails the deferred check');

SELECT throws_ok($$
  DO $inner$
  DECLARE v_t UUID := pg_temp.bare_ticket(13, 14);
  BEGIN
    INSERT INTO six_chance_system_ticket_selections (ticket_id, numbers, symbols, combination_count)
    VALUES (v_t, '{1,2,3,4,5,6,7}', '{1,2}', 14);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    DELETE FROM six_chance_system_ticket_selections WHERE ticket_id = v_t;
    SET CONSTRAINTS ALL IMMEDIATE;
  END
  $inner$;
$$, 'P0001', NULL, 'removing a ticket''s only selection afterwards is caught by the selection-side trigger');

SELECT * FROM finish();
ROLLBACK;
