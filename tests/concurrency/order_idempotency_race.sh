#!/usr/bin/env bash
# order_idempotency_race.sh <psql-connection-string>
#
# Proves orders.idempotency_key actually stops two simultaneous retries of the same client
# request from creating two orders: exactly one INSERT wins, the other fails with a unique
# violation, which is precisely the "database idempotency for order creation" requirement
# in Operational and Security Controls.
set -euo pipefail
CONN="${1:?usage: order_idempotency_race.sh <psql-connection-string>}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

psql "$CONN" -X -q -v ON_ERROR_STOP=1 <<'SQL' > "$WORKDIR/setup.out"
BEGIN;
SELECT test_helpers.make_game('SIX_CHANCE') AS game_id \gset
SELECT test_helpers.make_admin() AS admin_id \gset
SELECT test_helpers.make_rule_version(:'game_id'::uuid, 'SIX_CHANCE', :'admin_id'::uuid) AS rv_id \gset
SELECT test_helpers.make_draw(:'game_id'::uuid, 'SIX_CHANCE', :'rv_id'::uuid,
  (extract(epoch from clock_timestamp()) * 1000)::bigint) AS draw_id \gset
SELECT gen_random_uuid() AS idem_key \gset
COMMIT;
\echo DRAW_ID :draw_id
\echo IDEM_KEY :idem_key
SQL

DRAW_ID=$(grep '^DRAW_ID' "$WORKDIR/setup.out" | awk '{print $2}')
IDEM_KEY=$(grep '^IDEM_KEY' "$WORKDIR/setup.out" | awk '{print $2}')
echo "Fixture: draw=$DRAW_ID idempotency_key=$IDEM_KEY"

racer() {
  local label="$1"
  psql "$CONN" -X -q -v ON_ERROR_STOP=1 -c "
    INSERT INTO orders (order_number, draw_id, purchaser_type, guest_email, status, subtotal_toman, discount_toman, total_toman, idempotency_key)
    VALUES ('ORD-RACE-$label', '$DRAW_ID', 'GUEST', 'racer-$label@test.local', 'CONFIRMED', 100000, 0, 100000, '$IDEM_KEY');
  "
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

FINAL_ORDERS=$(psql "$CONN" -X -q -t -A -c "SELECT count(*) FROM orders WHERE idempotency_key = '$IDEM_KEY'")

if [ "$SUCCESSES" -eq 1 ] && [ "$FINAL_ORDERS" -eq 1 ]; then
  echo "PASS: exactly one racer's order was accepted for the retried idempotency_key."
  exit 0
else
  echo "FAIL: expected exactly one success and one resulting order; got successes=$SUCCESSES orders=$FINAL_ORDERS"
  exit 1
fi
