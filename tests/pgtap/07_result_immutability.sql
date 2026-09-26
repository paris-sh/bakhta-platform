-- 07_result_immutability.sql
-- Purpose: verify results and their value tables are freely editable while still a draft
-- (ENTERED), and become immutable once PUBLISHED — corrections must create a new version
-- row rather than editing the published one.

BEGIN;
SELECT plan(6);

DO $do$
DECLARE
  v_admin UUID := test_helpers.make_admin();
  v_game  UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv    UUID;
  v_draw  UUID;
  v_result_draft UUID;
  v_result_pub   UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999601);
  v_result_draft := test_helpers.make_result(v_draw, 'SIX_CHANCE', v_admin, 1, 'ENTERED');
  v_result_pub := test_helpers.make_result(v_draw, 'SIX_CHANCE', v_admin, 2, 'PUBLISHED', 'seed for immutability test');

  PERFORM set_config('test.admin_id', v_admin::text, true);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.result_draft', v_result_draft::text, true);
  PERFORM set_config('test.result_pub', v_result_pub::text, true);
END
$do$;

-- Draft (ENTERED) rows are freely editable.
SELECT lives_ok(
  format($$ UPDATE results SET correction_reason = 'draft edit ok' WHERE id = '%s' $$, current_setting('test.result_draft')),
  'results: a draft (ENTERED) result can be freely edited'
);

SELECT lives_ok(
  format($$ UPDATE six_chance_results SET normalized_n6 = 33 WHERE result_id = '%s' $$, current_setting('test.result_draft')),
  'six_chance_results: values attached to a draft result can be freely edited'
);

-- Published rows are immutable except the narrow allowed transition.
SELECT throws_ok(
  format($$ UPDATE results SET correction_reason = 'sneaky edit' WHERE id = '%s' $$, current_setting('test.result_pub')),
  NULL, 'results: a PUBLISHED result rejects an edit to a frozen field'
);

SELECT throws_ok(
  format($$ UPDATE six_chance_results SET normalized_n6 = 30 WHERE result_id = '%s' $$, current_setting('test.result_pub')),
  NULL, 'six_chance_results: values attached to a PUBLISHED result are immutable'
);

SELECT throws_ok(
  format($$ DELETE FROM six_chance_results WHERE result_id = '%s' $$, current_setting('test.result_pub')),
  NULL, 'six_chance_results: cannot be deleted once its parent result is PUBLISHED'
);

-- The one allowed transition: PUBLISHED -> SUPERSEDED with is_public_current flipping off.
SELECT lives_ok(
  format($$ UPDATE results SET status = 'SUPERSEDED', is_public_current = FALSE WHERE id = '%s' $$, current_setting('test.result_pub')),
  'results: PUBLISHED -> SUPERSEDED with is_public_current flipping to FALSE is the one allowed post-publication transition'
);

SELECT * FROM finish();
ROLLBACK;
