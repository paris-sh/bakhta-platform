-- 05_claim_lifecycle_and_result_correction.sql
-- Purpose: exercise the full amendment #4 correction scenario end to end: a ticket wins,
-- is claimed and PAID, a correction later removes its entitlement, and the claim record
-- must be preserved (not deleted), current_award_id must go NULL, status must move to
-- PENDING_REVIEW, prize_claim_award_links history must be untouched, and the manual
-- reconciliation flag must be settable and readable.

BEGIN;
SELECT plan(10);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_user   UUID := test_helpers.make_user();
  v_game   UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv     UUID;
  v_draw   UUID;
  v_order  UUID;
  v_ticket UUID;
  v_result_v1 UUID;
  v_run_v1    UUID;
  v_award_v1  UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999401);
  v_order := test_helpers.make_order(v_draw);
  v_ticket := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv, 1);

  v_result_v1 := test_helpers.make_result(v_draw, 'SIX_CHANCE', v_admin, 1, 'PUBLISHED');
  v_run_v1 := test_helpers.make_calculation_run(v_draw, v_result_v1, v_rv, v_admin, 1, 'PUBLISHED');
  v_award_v1 := test_helpers.make_award(v_run_v1, v_result_v1, v_draw, v_ticket, 'MAIN4', 600000, TRUE);

  UPDATE tickets SET outcome_status = 'WINNER' WHERE id = v_ticket;

  PERFORM set_config('test.admin_id', v_admin::text, true);
  PERFORM set_config('test.user_id', v_user::text, true);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.rule_version_id', v_rv::text, true);
  PERFORM set_config('test.ticket_id', v_ticket::text, true);
  PERFORM set_config('test.result_v1', v_result_v1::text, true);
  PERFORM set_config('test.run_v1', v_run_v1::text, true);
  PERFORM set_config('test.award_v1', v_award_v1::text, true);
END
$do$;

-- Submit and fully pay the claim.
SELECT lives_ok($$
  DO $inner$
  DECLARE v_claim UUID;
  BEGIN
    INSERT INTO prize_claims (claim_number, ticket_id, current_award_id, claimant_type, claimant_user_id, submission_method, status)
    VALUES ('CLM-CORR-1', current_setting('test.ticket_id')::uuid, current_setting('test.award_v1')::uuid, 'USER', current_setting('test.user_id')::uuid, 'ADMIN_ASSISTED', 'PENDING_REVIEW')
    RETURNING id INTO v_claim;

    INSERT INTO prize_claim_award_links (claim_id, award_id, ticket_id, link_reason, linked_by_type, linked_by_admin_id)
    VALUES (v_claim, current_setting('test.award_v1')::uuid, current_setting('test.ticket_id')::uuid, 'INITIAL_CLAIM', 'ADMIN', current_setting('test.admin_id')::uuid);

    UPDATE prize_claims SET status = 'PAID', paid_at = now() WHERE id = v_claim;

    PERFORM set_config('test.claim_id', v_claim::text, true);
  END
  $inner$;
$$, 'claim submitted and marked PAID against the version-1 award');

SELECT is(
  (SELECT status::text FROM prize_claims WHERE id = current_setting('test.claim_id')::uuid),
  'PAID', 'claim status is PAID before the correction'
);

-- A correction (version 2) is published that removes the ticket's entitlement entirely.
SELECT lives_ok($$
  DO $inner$
  DECLARE v_result_v2 UUID; v_run_v2 UUID;
  BEGIN
    -- Supersede the old current result / award.
    UPDATE results SET status = 'SUPERSEDED', is_public_current = FALSE WHERE id = current_setting('test.result_v1')::uuid;
    UPDATE prize_awards SET is_current = FALSE, status = 'SUPERSEDED' WHERE id = current_setting('test.award_v1')::uuid;

    v_result_v2 := test_helpers.make_result(
      current_setting('test.draw_id')::uuid, 'SIX_CHANCE', current_setting('test.admin_id')::uuid, 2, 'PUBLISHED', 'Correction: recount showed no match'
    );
    v_run_v2 := test_helpers.make_calculation_run(
      current_setting('test.draw_id')::uuid, v_result_v2, current_setting('test.rule_version_id')::uuid, current_setting('test.admin_id')::uuid, 1, 'PUBLISHED'
    );
    -- No prize_awards row is created: the ticket is now NOT_WINNER (amendment #4).
    UPDATE tickets SET outcome_status = 'NOT_WINNER' WHERE id = current_setting('test.ticket_id')::uuid;

    -- Claim is preserved, current_award_id cleared, status moved back to PENDING_REVIEW,
    -- and flagged for manual reconciliation because it had already reached PAID.
    UPDATE prize_claims
    SET current_award_id = NULL,
        status = 'PENDING_REVIEW',
        requires_manual_reconciliation = TRUE,
        manual_reconciliation_notes = 'Previously PAID award superseded by result correction v2; no automatic reversal performed.'
    WHERE id = current_setting('test.claim_id')::uuid;

    INSERT INTO prize_claim_status_history (claim_id, from_status, to_status, reason, actor_type, actor_admin_id)
    VALUES (current_setting('test.claim_id')::uuid, 'PAID', 'PENDING_REVIEW', 'Result correction removed ticket entitlement; manual reconciliation required for prior payment.', 'ADMIN', current_setting('test.admin_id')::uuid);

    PERFORM set_config('test.result_v2', v_result_v2::text, true);
  END
  $inner$;
$$, 'result correction v2 publishes, supersedes the old award, and the claim is moved back to PENDING_REVIEW');

SELECT is(
  (SELECT current_award_id FROM prize_claims WHERE id = current_setting('test.claim_id')::uuid),
  NULL::uuid, 'current_award_id is NULL after the correction removes the entitlement'
);

SELECT is(
  (SELECT status::text FROM prize_claims WHERE id = current_setting('test.claim_id')::uuid),
  'PENDING_REVIEW', 'claim status moved to PENDING_REVIEW after the correction'
);

SELECT ok(
  (SELECT requires_manual_reconciliation FROM prize_claims WHERE id = current_setting('test.claim_id')::uuid),
  'requires_manual_reconciliation is TRUE because the claim had already reached PAID'
);

SELECT is(
  (SELECT count(*)::int FROM prize_claim_award_links WHERE claim_id = current_setting('test.claim_id')::uuid),
  1, 'the original INITIAL_CLAIM award link is preserved, not deleted, across the correction'
);

SELECT is(
  (SELECT count(*)::int FROM prize_claim_status_history WHERE claim_id = current_setting('test.claim_id')::uuid),
  1, 'the PAID -> PENDING_REVIEW transition is recorded in the append-only claim status history'
);

-- No new Claim Token was required: the guest still has no claim_credential_id assigned on
-- this claim (it was ADMIN_ASSISTED originally), and no new claim_credentials row exists.
SELECT is(
  (SELECT count(*)::int FROM claim_credentials WHERE ticket_id = current_setting('test.ticket_id')::uuid),
  0, 'no Claim Token was ever required or generated for this admin-assisted claim, including across the correction'
);

-- The ticket itself never received a second prize_awards row for the correction (non-winner
-- tickets get no award row at all).
SELECT is(
  (SELECT count(*)::int FROM prize_awards WHERE ticket_id = current_setting('test.ticket_id')::uuid),
  1, 'the ticket has exactly one award row total (the now-superseded v1 award); no zero-value award row was created for the NOT_WINNER outcome'
);

SELECT * FROM finish();
ROLLBACK;
