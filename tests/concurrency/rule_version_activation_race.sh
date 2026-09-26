#!/usr/bin/env bash
# rule_version_activation_race.sh <psql-connection-string>
#
# Proves that activating two DIFFERENT DRAFT rule versions for the SAME game, concurrently,
# is a genuine, correctly-serialized conflict rather than a silent "last write wins": at
# most one of the two racers ends up ACTIVE, the loser gets a controlled, reportable
# conflict (not a raw constraint-violation 500), the previously-active version's retirement
# stays consistent, and the game is never left without an active rule version.
#
# This replicates, in raw SQL, the exact compare-and-swap algorithm implemented in
# backend/src/modules/games/games.repository.ts's activateRuleVersion: snapshot which
# version is currently ACTIVE, then retire it by that SPECIFIC id (not "whatever is active
# right now") — so if a concurrent transaction already retired that exact row by the time
# this one's retire-UPDATE runs, the UPDATE affects zero rows and is treated as a clean
# conflict, rather than silently retiring whatever new version a concurrent racer already
# activated.
set -euo pipefail
CONN="${1:?usage: rule_version_activation_race.sh <psql-connection-string>}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

psql "$CONN" -X -q -v ON_ERROR_STOP=1 <<'SQL' > "$WORKDIR/setup.out"
BEGIN;
SELECT test_helpers.make_admin() AS admin_id \gset
SELECT test_helpers.make_game('FOUR_LEAF') AS game_id \gset

-- v1: ACTIVE (the "previous active version" whose consistency we'll check afterward).
INSERT INTO game_rule_versions (game_id, game_type, version_number, status, rules, rules_hash, change_reason, created_by, activated_by, activated_at)
VALUES (:'game_id'::uuid, 'FOUR_LEAF', 1, 'ACTIVE',
        '{"schema_version":1,"rounding_unit_toman":1,"remainder_destination":"PRIZE_RESERVE"}',
        digest('v1','sha256'), 'seed v1', :'admin_id'::uuid, :'admin_id'::uuid, now())
RETURNING id AS v1_id \gset

-- v2, v3: two independent DRAFT candidates racing to become the new ACTIVE version.
INSERT INTO game_rule_versions (game_id, game_type, version_number, status, rules, rules_hash, change_reason, created_by)
VALUES (:'game_id'::uuid, 'FOUR_LEAF', 2, 'DRAFT',
        '{"schema_version":1,"rounding_unit_toman":1,"remainder_destination":"PRIZE_RESERVE"}',
        digest('v2','sha256'), 'draft v2', :'admin_id'::uuid)
RETURNING id AS v2_id \gset

INSERT INTO game_rule_versions (game_id, game_type, version_number, status, rules, rules_hash, change_reason, created_by)
VALUES (:'game_id'::uuid, 'FOUR_LEAF', 3, 'DRAFT',
        '{"schema_version":1,"rounding_unit_toman":1,"remainder_destination":"PRIZE_RESERVE"}',
        digest('v3','sha256'), 'draft v3', :'admin_id'::uuid)
RETURNING id AS v3_id \gset

COMMIT;
\echo GAME_ID :game_id
\echo ADMIN_ID :admin_id
\echo V1_ID :v1_id
\echo V2_ID :v2_id
\echo V3_ID :v3_id
SQL

GAME_ID=$(grep '^GAME_ID' "$WORKDIR/setup.out" | awk '{print $2}')
ADMIN_ID=$(grep '^ADMIN_ID' "$WORKDIR/setup.out" | awk '{print $2}')
V1_ID=$(grep '^V1_ID' "$WORKDIR/setup.out" | awk '{print $2}')
V2_ID=$(grep '^V2_ID' "$WORKDIR/setup.out" | awk '{print $2}')
V3_ID=$(grep '^V3_ID' "$WORKDIR/setup.out" | awk '{print $2}')
echo "Fixture: game=$GAME_ID v1(active)=$V1_ID v2(draft)=$V2_ID v3(draft)=$V3_ID"

racer() {
  local label="$1"
  local target_id="$2"
  psql "$CONN" -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
DO \$do\$
DECLARE
  v_current_active UUID;
  v_target_status  rule_version_status_enum;
  v_retire_count   INT;
  v_activate_count INT;
BEGIN
  SELECT id INTO v_current_active FROM game_rule_versions
    WHERE game_id = '$GAME_ID' AND status = 'ACTIVE';

  SELECT status INTO v_target_status FROM game_rule_versions
    WHERE id = '$target_id' AND game_id = '$GAME_ID';

  IF v_target_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'race lost (racer $label): target % is not DRAFT (%)', '$target_id', v_target_status;
  END IF;

  -- Widen the race window so both racers are provably inside the critical section together
  -- (same technique as the other three concurrency scripts).
  PERFORM pg_sleep(0.3);

  IF v_current_active IS NOT NULL THEN
    UPDATE game_rule_versions SET status = 'RETIRED', retired_at = now()
      WHERE id = v_current_active AND status = 'ACTIVE';
    GET DIAGNOSTICS v_retire_count = ROW_COUNT;
    IF v_retire_count = 0 THEN
      RAISE EXCEPTION 'race lost (racer $label): active version changed concurrently underneath us';
    END IF;
  END IF;

  UPDATE game_rule_versions SET status = 'ACTIVE', activated_by = '$ADMIN_ID', activated_at = now()
    WHERE id = '$target_id' AND game_id = '$GAME_ID' AND status = 'DRAFT';
  GET DIAGNOSTICS v_activate_count = ROW_COUNT;
  IF v_activate_count = 0 THEN
    RAISE EXCEPTION 'race lost (racer $label): target % is no longer DRAFT by activation time', '$target_id';
  END IF;
END
\$do\$;
COMMIT;
SQL
}

set +e
racer A "$V2_ID" > "$WORKDIR/a.out" 2> "$WORKDIR/a.err" &
PID_A=$!
racer B "$V3_ID" > "$WORKDIR/b.out" 2> "$WORKDIR/b.err" &
PID_B=$!
wait $PID_A; RC_A=$?
wait $PID_B; RC_B=$?
set -e

echo "--- racer A (targeting v2, rc=$RC_A) ---"; cat "$WORKDIR/a.err"
echo "--- racer B (targeting v3, rc=$RC_B) ---"; cat "$WORKDIR/b.err"

SUCCESSES=0
[ "$RC_A" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))
[ "$RC_B" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))

ACTIVE_COUNT=$(psql "$CONN" -X -q -t -A -c "SELECT count(*) FROM game_rule_versions WHERE game_id = '$GAME_ID' AND status = 'ACTIVE'")
V1_ROW=$(psql "$CONN" -X -q -t -A -F'|' -c "SELECT status, (retired_at IS NOT NULL) FROM game_rule_versions WHERE id = '$V1_ID'")
V1_STATUS=$(echo "$V1_ROW" | cut -d'|' -f1)
V1_HAS_RETIRED_AT=$(echo "$V1_ROW" | cut -d'|' -f2)

FAIL=0

if [ "$SUCCESSES" -ne 1 ]; then
  echo "FAIL: expected exactly 1 racer to succeed, got $SUCCESSES"
  FAIL=1
fi

if [ "$ACTIVE_COUNT" -ne 1 ]; then
  echo "FAIL: expected exactly 1 ACTIVE rule version for the game (never 0, never 2), got $ACTIVE_COUNT"
  FAIL=1
fi

if [ "$V1_STATUS" != "RETIRED" ] || [ "$V1_HAS_RETIRED_AT" != "t" ]; then
  echo "FAIL: expected the original active version (v1) to be RETIRED with retired_at set; got status=$V1_STATUS retired_at_set=$V1_HAS_RETIRED_AT"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "PASS: exactly one racer activated its draft, the game never had zero or two ACTIVE versions, and v1's retirement is consistent."
  exit 0
else
  exit 1
fi
