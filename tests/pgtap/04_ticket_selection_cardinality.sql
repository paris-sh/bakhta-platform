-- 04_ticket_selection_cardinality.sql
-- Purpose: exercise the deferred constraint trigger requiring exactly one matching
-- selection row per ticket. The trigger is DEFERRABLE INITIALLY DEFERRED, so a plain INSERT
-- of a ticket without its selection row does not fail immediately (allowing the normal
-- purchase transaction to insert ticket-then-selection in either order); it only fails when
-- checked, which we force here with SET CONSTRAINTS ALL IMMEDIATE instead of waiting for an
-- actual COMMIT (this file ROLLBACKs like every other test file, so nothing here persists).

BEGIN;
SELECT plan(3);

DO $do$
DECLARE
  v_admin UUID := test_helpers.make_admin();
  v_game  UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv    UUID;
  v_draw  UUID;
  v_order UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999301);
  v_order := test_helpers.make_order(v_draw);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.order_id', v_order::text, true);
  PERFORM set_config('test.rule_version_id', v_rv::text, true);
END
$do$;

-- A ticket inserted together with its matching selection row in the same transaction is
-- fine, even once the deferred check is forced immediate.
SELECT lives_ok($$
  DO $inner$
  BEGIN
    PERFORM test_helpers.make_ticket(
      current_setting('test.order_id')::uuid, current_setting('test.draw_id')::uuid,
      'SIX_CHANCE', current_setting('test.rule_version_id')::uuid, 1
    );
    SET CONSTRAINTS trg_tickets_selection_cardinality IMMEDIATE;
    -- Restore deferred mode so the next test in this same outer transaction can still
    -- insert a ticket before its selection row.
    SET CONSTRAINTS trg_tickets_selection_cardinality DEFERRED;
  END
  $inner$;
$$, 'ticket + matching selection row inserted together satisfies the deferred cardinality check');

-- A ticket inserted WITHOUT any selection row passes the plain INSERT (deferred)...
SELECT lives_ok(
  format($$ INSERT INTO tickets (public_code, order_id, draw_id, game_type, line_number, status, outcome_status, unit_price_toman, rule_version_id)
             VALUES ('TKT-NO-SELECTION', '%s', '%s', 'SIX_CHANCE', 2, 'CONFIRMED', 'PENDING', 1, '%s') $$,
    current_setting('test.order_id'), current_setting('test.draw_id'), current_setting('test.rule_version_id')),
  'a ticket with no selection row at all is accepted by the plain INSERT (check is deferred)'
);

-- ...but forcing the deferred check immediate (what COMMIT would do) rejects it.
SELECT throws_ok(
  $$ SET CONSTRAINTS trg_tickets_selection_cardinality IMMEDIATE $$,
  NULL, 'forcing the deferred constraint immediate rejects the ticket with zero selection rows'
);

SELECT * FROM finish();
ROLLBACK;
