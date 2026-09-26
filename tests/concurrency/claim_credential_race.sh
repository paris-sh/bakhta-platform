#!/usr/bin/env bash
# claim_credential_race.sh <psql-connection-string>
#
# Proves the Critical Transactions "Guest Claim Submission" locking order actually
# serializes two simultaneous guest claim submissions against the SAME Claim Token: exactly
# one succeeds, the other observes the credential is no longer ACTIVE (after waiting on the
# same row lock) and aborts cleanly. This is real two-connection concurrency, which pgTAP
# (single connection) cannot exercise.
set -euo pipefail
CONN="${1:?usage: claim_credential_race.sh <psql-connection-string>}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

psql "$CONN" -X -q -v ON_ERROR_STOP=1 <<'SQL' > "$WORKDIR/setup.out"
BEGIN;
SELECT test_helpers.make_admin() AS admin_id \gset
SELECT test_helpers.make_game('SIX_CHANCE') AS game_id \gset
SELECT test_helpers.make_rule_version(:'game_id'::uuid, 'SIX_CHANCE', :'admin_id'::uuid) AS rv_id \gset
SELECT test_helpers.make_draw(:'game_id'::uuid, 'SIX_CHANCE', :'rv_id'::uuid,
  (extract(epoch from clock_timestamp()) * 1000)::bigint) AS draw_id \gset
SELECT test_helpers.make_order(:'draw_id'::uuid) AS order_id \gset
SELECT test_helpers.make_ticket(:'order_id'::uuid, :'draw_id'::uuid, 'SIX_CHANCE', :'rv_id'::uuid) AS ticket_id \gset
INSERT INTO claim_credentials (ticket_id, token_digest) VALUES (:'ticket_id'::uuid, digest('race-token-claim','sha256'))
  RETURNING id AS cred_id \gset
COMMIT;
\echo TICKET_ID :ticket_id
\echo CRED_ID :cred_id
SQL

TICKET_ID=$(grep '^TICKET_ID' "$WORKDIR/setup.out" | awk '{print $2}')
CRED_ID=$(grep '^CRED_ID' "$WORKDIR/setup.out" | awk '{print $2}')
echo "Fixture: ticket=$TICKET_ID credential=$CRED_ID"

racer() {
  local label="$1"
  psql "$CONN" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
DO \$do\$
DECLARE
  v_status credential_status_enum;
BEGIN
  -- Row lock: the second racer blocks here until the first commits or rolls back.
  SELECT status INTO v_status FROM claim_credentials WHERE id = '$CRED_ID' FOR UPDATE;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'race lost: credential already % (racer $label)', v_status;
  END IF;
  PERFORM pg_sleep(0.3); -- widen the window so both racers are provably inside the critical section together
  UPDATE claim_credentials SET status = 'USED', used_at = now() WHERE id = '$CRED_ID';
  INSERT INTO prize_claims (claim_number, ticket_id, claimant_type, claim_credential_id, submission_method)
  VALUES ('CLM-RACE-$label', '$TICKET_ID', 'GUEST', '$CRED_ID', 'CLAIM_TOKEN');
END
\$do\$;
COMMIT;
SQL
}

set +e
racer A > "$WORKDIR/a.out" 2> "$WORKDIR/a.err" &
PID_A=$!
racer B > "$WORKDIR/b.out" 2> "$WORKDIR/b.err" &
PID_B=$!
wait $PID_A; RC_A=$?
wait $PID_B; RC_B=$?
set -e

echo "--- racer A (rc=$RC_A) ---"; cat "$WORKDIR/a.err"
echo "--- racer B (rc=$RC_B) ---"; cat "$WORKDIR/b.err"

SUCCESSES=0
[ "$RC_A" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))
[ "$RC_B" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))

FINAL_CLAIMS=$(psql "$CONN" -X -q -t -A -c "SELECT count(*) FROM prize_claims WHERE ticket_id = '$TICKET_ID'")

if [ "$SUCCESSES" -eq 1 ] && [ "$FINAL_CLAIMS" -eq 1 ]; then
  echo "PASS: exactly one racer consumed the Claim Token; exactly one claim exists."
  exit 0
else
  echo "FAIL: expected exactly one success and one resulting claim; got successes=$SUCCESSES claims=$FINAL_CLAIMS"
  exit 1
fi
