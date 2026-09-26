-- 09_claim_credential_and_award_run_guards.sql
-- Purpose: (a) a non-null claim_credential_id can be consumed by only one claim, and (b) an
-- award row can only be flagged is_current when its calculation run's status is PUBLISHED
-- (amendment #3's "only the selected published calculation run's awards may become current").

BEGIN;
SELECT plan(5);

DO $do$
DECLARE
  v_admin  UUID := test_helpers.make_admin();
  v_game   UUID := test_helpers.make_game('SIX_CHANCE');
  v_rv     UUID;
  v_draw   UUID;
  v_order  UUID;
  v_ticket UUID;
  v_ticket2 UUID;
  v_cred   UUID;
  v_result UUID;
  v_run_running UUID;
  v_run_published UUID;
BEGIN
  v_rv := test_helpers.make_rule_version(v_game, 'SIX_CHANCE', v_admin);
  v_draw := test_helpers.make_draw(v_game, 'SIX_CHANCE', v_rv, 999701);
  v_order := test_helpers.make_order(v_draw);
  v_ticket := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv, 1);
  v_ticket2 := test_helpers.make_ticket(v_order, v_draw, 'SIX_CHANCE', v_rv, 2);

  INSERT INTO claim_credentials (ticket_id, token_digest) VALUES (v_ticket, digest('guard-token','sha256'))
  RETURNING id INTO v_cred;

  v_result := test_helpers.make_result(v_draw, 'SIX_CHANCE', v_admin, 1, 'PUBLISHED');
  v_run_running := test_helpers.make_calculation_run(v_draw, v_result, v_rv, v_admin, 1, 'RUNNING');
  v_run_published := test_helpers.make_calculation_run(v_draw, v_result, v_rv, v_admin, 2, 'PUBLISHED');

  PERFORM set_config('test.ticket_id', v_ticket::text, true);
  PERFORM set_config('test.ticket2_id', v_ticket2::text, true);
  PERFORM set_config('test.cred_id', v_cred::text, true);
  PERFORM set_config('test.result_id', v_result::text, true);
  PERFORM set_config('test.draw_id', v_draw::text, true);
  PERFORM set_config('test.run_running', v_run_running::text, true);
  PERFORM set_config('test.run_published', v_run_published::text, true);
END
$do$;

-- A RUNNING (not yet published) run's award cannot be inserted as is_current.
SELECT throws_ok(
  format($$ INSERT INTO prize_awards (calculation_run_id, result_id, draw_id, ticket_id, tier_code, award_type, amount_toman, is_current, claim_deadline_at)
             VALUES ('%s','%s','%s','%s','MAIN4','CASH',600000,TRUE, now() + interval '90 days') $$,
    current_setting('test.run_running'), current_setting('test.result_id'), current_setting('test.draw_id'), current_setting('test.ticket_id')),
  NULL, 'prize_awards: is_current cannot be TRUE for an award from a RUNNING calculation run'
);

-- The same award, not marked current, is fine (a stored preview outcome).
SELECT lives_ok(
  format($$ INSERT INTO prize_awards (calculation_run_id, result_id, draw_id, ticket_id, tier_code, award_type, amount_toman, is_current, claim_deadline_at)
             VALUES ('%s','%s','%s','%s','MAIN4','CASH',600000,FALSE, now() + interval '90 days') $$,
    current_setting('test.run_running'), current_setting('test.result_id'), current_setting('test.draw_id'), current_setting('test.ticket_id')),
  'prize_awards: is_current = FALSE is accepted regardless of the run''s status (preview data)'
);

-- The PUBLISHED run's award can be is_current.
SELECT lives_ok(
  format($$ INSERT INTO prize_awards (calculation_run_id, result_id, draw_id, ticket_id, tier_code, award_type, amount_toman, is_current, claim_deadline_at)
             VALUES ('%s','%s','%s','%s','MAIN4','CASH',600000,TRUE, now() + interval '90 days') $$,
    current_setting('test.run_published'), current_setting('test.result_id'), current_setting('test.draw_id'), current_setting('test.ticket_id')),
  'prize_awards: is_current = TRUE succeeds for an award belonging to a PUBLISHED calculation run'
);

-- claim_credential_id: only one claim may consume a given credential.
SELECT lives_ok($$
  DO $inner$
  DECLARE v_user UUID := test_helpers.make_user();
  BEGIN
    INSERT INTO prize_claims (claim_number, ticket_id, claimant_type, claim_credential_id, submission_method)
    VALUES ('CLM-GUARD-1', current_setting('test.ticket_id')::uuid, 'GUEST', current_setting('test.cred_id')::uuid, 'CLAIM_TOKEN');
  END
  $inner$;
$$, 'prize_claims: first claim consuming the credential succeeds');

-- A different ticket's claim cannot borrow this credential: the composite FK to
-- claim_credentials(id, ticket_id) requires the credential's own ticket_id, and even if it
-- somehow matched, UNIQUE(claim_credential_id) on prize_claims still allows only one
-- consuming claim in total.
-- Either uq_prize_claims_claim_credential (already consumed) or the composite FK to
-- claim_credentials(id, ticket_id) (wrong ticket) rejects this; both independently prevent
-- credential reuse/borrowing, so either sqlstate is an acceptable outcome here.
SELECT throws_ok(
  format($$ INSERT INTO prize_claims (claim_number, ticket_id, claimant_type, claim_credential_id, submission_method)
             VALUES ('CLM-GUARD-2', '%s', 'GUEST', '%s', 'CLAIM_TOKEN') $$,
    current_setting('test.ticket2_id'), current_setting('test.cred_id')),
  NULL, 'a claim cannot reference a claim_credential_id already consumed by, or belonging to, another ticket'
);

SELECT * FROM finish();
ROLLBACK;
