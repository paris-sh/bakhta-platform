-- 10_ticket_cutoff_guard.sql
-- Purpose: migration 0035's trigger — "must not insert a confirmed ticket retroactively
-- after the applicable cutoff" — enforced as a real database guarantee, not just an
-- application-transaction convention.

BEGIN;
SELECT plan(6);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_game   UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv     UUID;
  v_draw_open UUID;
  v_draw_past UUID;
  v_order_open UUID;
  v_order_past UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);

  -- A normal draw (make_draw's default sales_closes_at is now in the future).
  v_draw_open := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999801);
  v_order_open := test_helpers.make_order(v_draw_open);

  -- A draw whose cutoff has explicitly already passed.
  INSERT INTO draws (
    game_id, game_type, draw_number, status,
    sales_opens_at, sales_closes_at, draw_at, official_timezone,
    current_rule_version_id, current_rules_snapshot
  ) VALUES (
    v_game, 'SIX_CHANCE', 999802, 'SALES_CLOSED',
    now() - interval '2 days', now() - interval '1 hour', now(), 'Asia/Tehran',
    v_rv, '{}'::jsonb
  ) RETURNING id INTO v_draw_past;
  v_order_past := test_helpers.make_order(v_draw_past);

  PERFORM set_config('test.rv', v_rv::text, true);
  PERFORM set_config('test.draw_open', v_draw_open::text, true);
  PERFORM set_config('test.draw_past', v_draw_past::text, true);
  PERFORM set_config('test.order_open', v_order_open::text, true);
  PERFORM set_config('test.order_past', v_order_past::text, true);
END
$do$;

-- Sanity: confirming a ticket for a draw whose cutoff is still in the future succeeds.
SELECT lives_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-CUTOFF-OPEN', '%s', '%s', 'SIX_CHANCE', 1, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_open'), current_setting('test.draw_open'), current_setting('test.rv')),
  'confirming a ticket before its draw''s cutoff succeeds'
);

-- Rejected: inserting a ticket already CONFIRMED for a draw whose cutoff already passed.
SELECT throws_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-CUTOFF-PAST-1', '%s', '%s', 'SIX_CHANCE', 1, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_past'), current_setting('test.draw_past'), current_setting('test.rv')),
  NULL, 'inserting an already-CONFIRMED ticket after cutoff is rejected'
);

-- Allowed: inserting a PENDING (not yet confirmed) ticket for the same past-cutoff draw.
SELECT lives_ok($$
  DO $inner$
  DECLARE v_id UUID;
  BEGIN
    INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
    VALUES ('TKT-CUTOFF-PENDING', current_setting('test.order_past')::uuid, current_setting('test.draw_past')::uuid, 'SIX_CHANCE', 2, 'PENDING', 'PENDING', 1, current_setting('test.rv')::uuid)
    RETURNING id INTO v_id;
    PERFORM set_config('test.pending_ticket', v_id::text, true);
  END
  $inner$;
$$, 'inserting a PENDING (not confirmed) ticket after cutoff is unaffected by the guard');

-- Rejected: transitioning that PENDING ticket to CONFIRMED after cutoff.
SELECT throws_ok(
  $$ UPDATE tickets SET status = 'CONFIRMED' WHERE id = current_setting('test.pending_ticket')::uuid $$,
  NULL, 'confirming a previously-PENDING ticket after cutoff is rejected'
);

-- Allowed: a ticket that was CONFIRMED before cutoff can still be updated for unrelated
-- reasons after the cutoff has since passed, as long as status itself is not re-entering
-- CONFIRMED from a different value.
SELECT lives_ok($$
  DO $inner$
  DECLARE v_id UUID;
  BEGIN
    INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
    VALUES ('TKT-CUTOFF-ALREADY-CONFIRMED', current_setting('test.order_open')::uuid, current_setting('test.draw_open')::uuid, 'SIX_CHANCE', 3, 'CONFIRMED', 'PENDING', 1, current_setting('test.rv')::uuid)
    RETURNING id INTO v_id;

    -- Simulate time passing: the draw's cutoff is now in the past.
    UPDATE draws SET sales_closes_at = now() - interval '1 hour' WHERE id = current_setting('test.draw_open')::uuid;

    -- Unrelated update on an already-CONFIRMED ticket must not re-trigger the guard.
    UPDATE tickets SET outcome_status = 'WINNER' WHERE id = v_id;
  END
  $inner$;
$$, 'updating a field other than status on an already-CONFIRMED ticket is unaffected by a cutoff that has since passed');

SELECT throws_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-CUTOFF-PAST-2', '%s', '%s', 'SIX_CHANCE', 4, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_open'), current_setting('test.draw_open'), current_setting('test.rv')),
  NULL, 'a fresh CONFIRMED insert against the now-passed draw_open cutoff is also rejected'
);

SELECT * FROM finish();
ROLLBACK;
