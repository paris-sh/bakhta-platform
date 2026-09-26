#!/usr/bin/env bash
# one_current_award_race.sh <psql-connection-string>
#
# Proves one_current_award_per_ticket actually stops two simultaneous "activate this
# calculation run's award as current" attempts (e.g. two admin sessions both approving a
# calculation run for the same ticket) from leaving more than one is_current = TRUE row for
# the ticket: exactly one wins the partial unique index, the other gets a unique violation.
set -euo pipefail
CONN="${1:?usage: one_current_award_race.sh <psql-connection-string>}"

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
SELECT test_helpers.make_result(:'draw_id'::uuid, 'SIX_CHANCE', :'admin_id'::uuid, 1, 'PUBLISHED') AS result_id \gset
SELECT test_helpers.make_calculation_run(:'draw_id'::uuid, :'result_id'::uuid, :'rv_id'::uuid, :'admin_id'::uuid, 1, 'PUBLISHED') AS run_a \gset
SELECT test_helpers.make_calculation_run(:'draw_id'::uuid, :'result_id'::uuid, :'rv_id'::uuid, :'admin_id'::uuid, 2, 'PUBLISHED') AS run_b \gset
-- Two NOT-current award rows already exist, one per run; the race is which one flips to current.
SELECT test_helpers.make_award(:'run_a'::uuid, :'result_id'::uuid, :'draw_id'::uuid, :'ticket_id'::uuid, 'MAIN4', 600000, FALSE) AS award_a \gset
SELECT test_helpers.make_award(:'run_b'::uuid, :'result_id'::uuid, :'draw_id'::uuid, :'ticket_id'::uuid, 'MAIN4', 600000, FALSE) AS award_b \gset
COMMIT;
\echo AWARD_A :award_a
\echo AWARD_B :award_b
SQL

AWARD_A=$(grep '^AWARD_A' "$WORKDIR/setup.out" | awk '{print $2}')
AWARD_B=$(grep '^AWARD_B' "$WORKDIR/setup.out" | awk '{print $2}')
echo "Fixture: award_a=$AWARD_A award_b=$AWARD_B (same ticket)"

racer() {
  local award_id="$1"
  psql "$CONN" -X -q -v ON_ERROR_STOP=1 -c "UPDATE prize_awards SET is_current = TRUE WHERE id = '$award_id';"
}

set +e
racer "$AWARD_A" > "$WORKDIR/a.out" 2> "$WORKDIR/a.err" &
PID_A=$!
racer "$AWARD_B" > "$WORKDIR/b.out" 2> "$WORKDIR/b.err" &
PID_B=$!
wait $PID_A; RC_A=$?
wait $PID_B; RC_B=$?
set -e

echo "--- racer A (rc=$RC_A) ---"; cat "$WORKDIR/a.err"
echo "--- racer B (rc=$RC_B) ---"; cat "$WORKDIR/b.err"

SUCCESSES=0
[ "$RC_A" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))
[ "$RC_B" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))

CURRENT_COUNT=$(psql "$CONN" -X -q -t -A -c "SELECT count(*) FROM prize_awards WHERE id IN ('$AWARD_A','$AWARD_B') AND is_current")

if [ "$SUCCESSES" -eq 1 ] && [ "$CURRENT_COUNT" -eq 1 ]; then
  echo "PASS: exactly one award for the ticket ended up is_current."
  exit 0
else
  echo "FAIL: expected exactly one success and one is_current row; got successes=$SUCCESSES current=$CURRENT_COUNT"
  exit 1
fi
