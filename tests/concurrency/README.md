# Concurrency test scripts

pgTAP (`tests/pgtap/*.sql`) runs on a single connection, so it can only prove that a
constraint *exists* and rejects a second, sequential attempt. It cannot prove that two
genuinely simultaneous transactions are serialized correctly by that constraint — that
requires two real, overlapping connections. The scripts here do that, using two background
`psql` processes synchronized with `pg_advisory_xact_lock` so both transactions reach their
conflicting INSERT at (as close as possible to) the same instant.

## Requirements

- `psql` on PATH, pointed at a disposable test database (never production) via `PGDATABASE`/
  `PGHOST`/`PGUSER`/`PGPASSWORD` or a `DATABASE_URL`-style connection string passed as `$1`.
- The schema migrations (and `tests/pgtap/00_helpers.sql`) already applied.

## Running

```
bash claim_credential_race.sh "$DATABASE_URL"
bash order_idempotency_race.sh "$DATABASE_URL"
bash one_current_award_race.sh "$DATABASE_URL"
bash rule_version_activation_race.sh "$DATABASE_URL"
```

Each script prints which side won and asserts exactly one side succeeded. A nonzero exit
code means the invariant did NOT hold under real concurrency — treat that as a release
blocker, not a flaky test.

## What each script proves

- `claim_credential_race.sh`: two simultaneous guest claim submissions racing on the same
  ticket's Claim Token can only consume it once (`one_active_claim_token_per_ticket` +
  `claim_credentials.status` transition to `USED`), mirroring the Critical Transactions
  "Guest Claim Submission" locking order (ticket, then award, then Claim Token row, in that
  order) from the spec.
- `order_idempotency_race.sh`: two simultaneous retries of the same client order-creation
  request (identical `idempotency_key`) result in exactly one confirmed order.
- `one_current_award_race.sh`: two simultaneous attempts to mark a different award row
  `is_current = TRUE` for the same ticket can only leave one row current.
- `rule_version_activation_race.sh`: two simultaneous attempts to activate two DIFFERENT
  DRAFT rule versions for the same game result in exactly one ACTIVE version, a clean
  reportable conflict for the loser (not a raw constraint-violation crash), and a
  consistently-retired previous active version — proving the backend's compare-and-swap
  activation algorithm (`games.repository.ts`'s `activateRuleVersion`), not just the raw
  partial unique index.
