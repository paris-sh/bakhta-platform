# Bakhta Database — Migrations, Seeds, and Tests

This is the First Coding Deliverable for the Bakhta lottery platform (spec v0.2):
PostgreSQL schema migrations, seed data for the two initial games, and tests. Payment and
cryptocurrency modules are explicitly out of scope and not present anywhere in this schema.

## Layout

```
migrations/   36 numbered migrations, each with a .up.sql and a .down.sql (35 tables total)
seeds/        idempotent seed scripts, run once after all migrations
tests/pgtap/  pgTAP schema/invariant tests (single connection, wrapped in ROLLBACK)
tests/concurrency/  real two-connection race scripts (psql + bash) for invariants not
              provable on one connection
```

## Bootstrap admin: required environment variables, no hardcoded secrets

`seeds/0001_roles_and_bootstrap_admin.sql` hardcodes no email, password, token, or other
credential. It requires two psql variables (fed from your own environment variables — the
names below are this project's convention, not a Postgres/psql requirement) and refuses to
run without them:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v bootstrap_admin_email="$BAKHTA_BOOTSTRAP_ADMIN_EMAIL" \
  -v bootstrap_admin_number="$BAKHTA_BOOTSTRAP_ADMIN_NUMBER" \
  -f seeds/0001_roles_and_bootstrap_admin.sql
```

That script also creates **no `admin_credentials` row** — Argon2id hashing cannot be done
safely in plain SQL, so this bootstrap admin has an identity and a `SUPER_ADMIN` role
assignment but literally cannot log in. Setting its real credential is a backend-phase
task: a separate, secure admin-init command (built once the application layer exists) that
computes a real Argon2id hash and is the only thing ever allowed to write to
`admin_credentials` for this account. This is a deliberate handoff boundary, not a
placeholder to "fill in later" with another hardcoded value.

That command is `npm run admin:set-password` (in `backend/`). It targets
`BAKHTA_BOOTSTRAP_ADMIN_EMAIL` (or `-- --email <address>` for any active `SUPER_ADMIN`), reads
the new password twice from hidden terminal input only, and refuses pipes, arguments,
environment variables and files, so the password never reaches shell history, logs, seeds or
Git. It stores an Argon2id hash with the app's parameters and, in the same transaction, signs
out the admin's active sessions and writes a `SYSTEM` audit entry that contains no secret.
Running it again resets the password.

`seeds/0002_games_and_rule_versions.sql` needs no email or variable of its own — it looks up
"whichever admin currently holds an active `SUPER_ADMIN` assignment" dynamically, so it never
hardcodes or re-references the bootstrap email either.

## Commands

**Apply all migrations** (numeric order; run as a privileged owner/migrator role, never as
the application's runtime role `bakhta_app`):
```bash
for f in migrations/*.up.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

**Roll back all migrations** (reverse numeric order — see the caveats below):
```bash
for f in $(ls migrations/*.down.sql | sort -r); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

**Run the pgTAP tests** (needs the real `pgtap` extension installed in the target database
— see "Installing pgTAP natively" below if your local Postgres doesn't have it):
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgtap;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/pgtap/00_helpers.sql
pg_prove --dbname "$DATABASE_URL" tests/pgtap/[0-9][0-9]_*.sql
# or, without pg_prove installed, run each file directly and check for "not ok" lines:
for f in tests/pgtap/[0-9][0-9]_*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

> **Run this against a database with no seed data yet, right after migrating.**
> `tests/pgtap/08_super_admin_safeguard.sql` counts every active SUPER_ADMIN
> **system-wide** (that's the whole point of the safeguard — it must not be foolable by
> scoping) — if `seeds/0001` has already created the bootstrap SUPER_ADMIN, that test's own
> "only two exist" assumption is no longer true and 3 of its assertions fail. This was
> caught by actually running the full migrate → seed → pgTAP sequence once, not assumed:
> confirmed to pass cleanly as migrate → pgTAP → seed, confirmed to fail 3 assertions as
> migrate → seed → pgTAP. Keep it in that order, or use two separate databases: one
> pgTAP-only (never seeded), one seeded for real development/manual testing.

**Run seeds** (after migrations, and after pgTAP if you're running both against the same
database; requires the environment variables above):
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v bootstrap_admin_email="$BAKHTA_BOOTSTRAP_ADMIN_EMAIL" \
  -v bootstrap_admin_number="$BAKHTA_BOOTSTRAP_ADMIN_NUMBER" \
  -f seeds/0001_roles_and_bootstrap_admin.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seeds/0002_games_and_rule_versions.sql
```

**Run the concurrency tests** (needs a real, reachable database and `psql` on PATH; safe
against the same disposable database used above):
```bash
bash tests/concurrency/claim_credential_race.sh "$DATABASE_URL"
bash tests/concurrency/order_idempotency_race.sh "$DATABASE_URL"
bash tests/concurrency/one_current_award_race.sh "$DATABASE_URL"
bash tests/concurrency/rule_version_activation_race.sh "$DATABASE_URL"
```

## Installing pgTAP natively (no Docker)

This project does not use Docker anywhere — not for development, testing, CI, or
deployment. pgTAP is pure SQL/PL-pgSQL (it declares a `module_pathname` in its control file
for historical reasons, but ships no C code and needs no compiler), so it installs directly
into any native PostgreSQL 18 instance:

```bash
# 1. Download the pinned release's control file and main SQL source.
PGTAP_VERSION=v1.3.3
curl -fsSL "https://raw.githubusercontent.com/theory/pgtap/${PGTAP_VERSION}/pgtap.control" -o pgtap.control
curl -fsSL "https://raw.githubusercontent.com/theory/pgtap/${PGTAP_VERSION}/sql/pgtap.sql.in" -o pgtap--1.3.3.sql

# 2. Fill in the two placeholders pgTAP's own Makefile would otherwise substitute at build
#    time (MODULE_PATHNAME is unused by pgTAP but substituted for safety; __OS__ only
#    affects the informational os_name() function; __VERSION__ feeds pgtap_version()).
sed -i \
  -e 's,MODULE_PATHNAME,$libdir/pgtap,g' \
  -e 's,__OS__,YourOSName,g' \
  -e 's,__VERSION__,1.3,g' \
  pgtap--1.3.3.sql

# 3. Copy both files into your Postgres installation's extension directory. This is
#    typically the one step that needs elevated/admin privileges, since it writes into the
#    Postgres install location rather than a data directory you own.
cp pgtap.control pgtap--1.3.3.sql "$(pg_config --sharedir)/extension/"

# 4. Enable it in your target database.
psql "$DATABASE_URL" -c "CREATE EXTENSION pgtap;"
```

On Windows, step 3's destination is typically
`C:\Program Files\PostgreSQL\18\share\extension\`, which usually requires an elevated
(administrator) copy. This install is standalone and does not depend on anything else in
this repository; uninstalling is `DROP EXTENSION pgtap;` followed by deleting the two
copied files.

## Rollback caveats

Rolling back a foundational migration (0001-0009) after later tables/data exist is not
safe — those `.down.sql` files exist for pre-deployment iteration, not for un-doing a live
schema with data in it. `0031`-`0036` (trigger/privilege/CHECK-only migrations) are always safe to
roll back. `0001`'s `DROP ROLE bakhta_app` is cluster-wide: if any *other* database in the
same Postgres cluster still grants privileges to `bakhta_app` (e.g. a leftover disposable
test database), the drop fails with "cannot be dropped because some objects depend on it" —
this is normal Postgres role semantics, not a migration defect; drop or revoke in those
other databases first.

If you ran the pgTAP tests against this database, `tests/pgtap/00_helpers.sql` will have
left a committed `test_helpers` schema behind (by design — see that file's own header
comment). Its fixture functions reference the migrations' enum types, so `0002`'s down
migration will fail with "cannot drop type ... because other objects depend on it" unless
you drop it first:
```bash
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS test_helpers CASCADE;"
```

## Migration order and why

| # | Migration | Depends on | Notes |
|---|---|---|---|
| 0001 | extensions_and_roles | — | `pgcrypto`, `citext`; creates the restricted `bakhta_app` runtime role |
| 0002 | enums_domains_and_helpers | 0001 | every ENUM/domain, `set_updated_at()`, `reject_mutation()` |
| 0003 | identity_core | 0002 | `users`, `admin_accounts` — two separate identity domains |
| 0004 | identity_credentials | 0003 | `user_credentials`, `admin_credentials` |
| 0005 | rbac | 0002 | `roles`, `permissions`, `role_permissions` |
| 0006 | admin_role_assignments | 0003, 0005 | versioned; `one_active_assignment_per_role` |
| 0007 | sessions_auth | 0003 | `sessions`, `auth_attempts` |
| 0008 | games | 0002 | adds `game_type` (structural discriminator; see Deviations) |
| 0009 | game_rule_versions | 0008 | `one_active_rule_version_per_game`; Four Leaf rounding-policy CHECK |
| 0010 | draws | 0009 | time-ordering CHECKs |
| 0011 | admin_overrides | 0003 | polymorphic `entity_type/entity_id` (deliberate exception) |
| 0012 | draw_status_history | 0010, 0011 | typed actor (ADMIN/SYSTEM only) |
| 0013 | draw_evidence | 0010 | |
| 0014 | orders | 0003, 0010 | guest-email discriminator CHECK |
| 0015 | tickets | 0003, 0009, 0010, 0014 | denormalizes `draw_id`/`game_type`, pinned by composite FKs |
| 0016 | ticket_ownership_history | 0003, 0015 | new table (amendment); append-only |
| 0017 | ticket_selections | 0015 | game-type-matched composite FK + deferred cardinality trigger |
| 0018 | claim_credentials | 0015 | `one_active_claim_token_per_ticket` |
| 0019 | results | 0003, 0010, 0013 | `one_public_result_per_draw`; publication-field CHECKs |
| 0020 | result_values | 0019 | same game-type-matching pattern as 0017 |
| 0021 | prize_calculation_runs | 0009, 0010, 0019 | composite unique targets for 0022 |
| 0022 | prize_awards | 0015, 0021 | `calculation_run_id` (amendment), draw-matching composite FK chain |
| 0023 | prize_claims | 0003, 0015, 0018, 0022 | nullable `current_award_id` (amendment) |
| 0024 | prize_claim_award_links | 0003, 0022, 0023 | typed `linked_by`; ticket-matching composite FK |
| 0025 | prize_claim_status_history | 0003, 0023 | |
| 0026 | audit_logs | 0003 | typed actor; polymorphic entity (deliberate exception) |
| 0027 | support_tickets | 0003 | polymorphic related-entity (deliberate exception) |
| 0028 | support_messages | 0027 | |
| 0029 | notifications | 0003 | typed recipient |
| 0030 | outbox_events | — | polymorphic aggregate (deliberate exception) |
| 0031 | append_only_enforcement | 0011,0012,0016,0024,0025,0026 | REVOKE + trigger on the 6 append-only tables |
| 0032 | result_immutability | 0019, 0020 | conditional (draft-editable, publish-frozen) guard |
| 0033 | super_admin_safeguard | 0003, 0006 | locked-transaction final-SUPER_ADMIN protection |
| 0034 | prize_award_run_published_guard | 0021, 0022 | only a PUBLISHED run's awards may be `is_current` |
| 0035 | ticket_cutoff_guard | 0010, 0015 | defense-in-depth: rejects confirming a ticket after `sales_closes_at` |
| 0036 | game_rule_versions_schema_version | 0009 | requires `rules.schema_version` (int) present; app resolves validators by (game_type, schema_version) |

## Table list (35)

Every table in the spec's Core Table Catalog, plus `ticket_ownership_history` (added by
product-owner amendment). No payment, wallet, blockchain, transaction, or cryptocurrency
settlement table exists anywhere in this schema.

Identity & access: `users`, `user_credentials`, `admin_accounts`, `admin_credentials`,
`roles`, `permissions`, `role_permissions`, `admin_role_assignments`, `sessions`,
`auth_attempts`.
Game catalog: `games`, `game_rule_versions`.
Draws: `draws`, `draw_status_history`, `draw_evidence`, `admin_overrides`.
Orders & tickets: `orders`, `tickets`, `ticket_ownership_history`,
`four_leaf_ticket_selections`, `six_chance_ticket_selections`.
Results: `results`, `four_leaf_results`, `six_chance_results`.
Prizes: `prize_calculation_runs`, `prize_awards`.
Claims: `claim_credentials`, `prize_claims`, `prize_claim_award_links`,
`prize_claim_status_history`.
Governance/support/messaging: `audit_logs`, `support_tickets`, `support_messages`,
`notifications`, `outbox_events`.

## Deviations from the spec's literal field lists, and why

These fill gaps identified before coding began, or implement the product owner's explicit
amendments. None changes an approved business decision.

1. **`games.game_type`** (ENUM `SIX_CHANCE`/`FOUR_LEAF`) — a structural discriminator kept
   separate from the mutable branding `code`/`slug`, so composite foreign keys elsewhere can
   pin a ticket's/draw's/result's game shape to something that can never be renamed.
2. **Denormalized `draw_id`/`game_type` on `tickets`, and `game_type` on `results`,
   `draws`, `game_rule_versions`** — each pinned by a composite FK back to its true source
   (e.g. `tickets(order_id, draw_id) REFERENCES orders(id, draw_id)`), so "same draw" /
   "matching game" invariants are enforced by Postgres itself, not trusted from application
   code. See amendment #9.
3. **`prize_awards.calculation_run_id`** (mandatory) with `UNIQUE(calculation_run_id,
   ticket_id)` replacing the spec's `UNIQUE(result_id, ticket_id)`, per the product owner's
   amendment #3 — several preview/calculation runs can now coexist per result.
4. **No award row for `NOT_WINNER` tickets** (amendment #4) — an entitlement, not a
   participation record; `prize_claims.current_award_id` is nullable so a correction can
   remove an entitlement entirely while the claim record survives.
5. **`prize_claims.requires_manual_reconciliation` / `manual_reconciliation_notes`** — the
   amendment's "if the claim had reached PAID, record the manual-reconciliation requirement"
   is an operationally-queryable flag, not just prose in a status-history reason.
6. **Exactly-one-selection/-result-value-row enforcement is a deferred constraint trigger**
   (`SET CONSTRAINTS ... DEFERRABLE INITIALLY DEFERRED`), because "a row must exist" cannot
   be expressed by a foreign key against an optional child. It requires the ticket/result and
   its selection/value row to be inserted in the same transaction (true of every purchase and
   result-entry flow described in the spec).
7. **Two-layer append-only enforcement** (REVOKE + trigger) on the six tables named in
   amendment #7, plus a *separate*, narrower trigger on `results` (and its value tables) that
   allows editing while still a draft (`ENTERED`/`PENDING_REVIEW`) but freezes once
   `PUBLISHED` — `results` legitimately receives UPDATEs during review, so it could not use
   the same blanket-reject trigger as the six purely history tables.
8. **Four Leaf rounding policy lives in `game_rule_versions.rules`** (`rounding_unit_toman`,
   `remainder_destination`), enforced by a CHECK requiring both keys whenever
   `game_type = 'FOUR_LEAF'`, per amendment #10. Seed default: `rounding_unit_toman = 1`,
   `remainder_destination = 'PRIZE_RESERVE'`.
9. **`game_rule_versions.rules.schema_version`** (migration 0036) — every rule payload must
   declare an integer `schema_version`, enforced by a CHECK at the database layer
   (`rules ? 'schema_version' AND jsonb_typeof(...) = 'number'` — note the explicit key-
   presence check: `jsonb_typeof` of a missing key is SQL `NULL`, and a bare
   `NULL = 'number'` comparison is itself `NULL`, which a CHECK constraint treats as
   *passing* — a real mistake this project's own migration made and caught by actually
   running the pgTAP suite, not by inspection). The backend resolves which Zod validator to
   apply by **both** `game_type` and `schema_version` together, and never replaces or edits
   an existing schema_version's validator when a new one is introduced — see
   `backend/src/modules/games/rules.schemas.ts`.
10. **Ticket confirmation cutoff guard** (migration 0035) — defense-in-depth trigger
    rejecting a ticket write with `status = 'CONFIRMED'` once its draw's `sales_closes_at`
    has passed, on top of (not instead of) the application-transaction row-locking
    discipline that was always the primary enforcement mechanism.

## Documented referential-integrity exceptions (deliberate, per amendment #2)

Four polymorphic reference pairs are intentionally left without an enforceable single
foreign key, because their target can genuinely be many unrelated business entities:

- `admin_overrides.entity_type` / `entity_id`
- `audit_logs.entity_type` / `entity_id`
- `outbox_events.aggregate_type` / `aggregate_id`
- `support_tickets.related_entity_type` / `related_entity_id`

Every other actor/recipient/linker reference that the product owner identified as "always
one of a small known set" was converted to typed nullable columns with an exclusive-or
CHECK instead: `draw_status_history` (actor), `notifications` (recipient),
`prize_claim_award_links` (linked_by), `audit_logs` (actor), `ticket_ownership_history`
(actor), `support_tickets`/`support_messages` (requester/sender), `prize_claims`
(claimant), `orders` (purchaser), `sessions` (principal).

## Override, history, and immutability model

- **Versioned overrides, never destructive overwrites.** `admin_overrides` is append-only
  (trigger + revoked privilege) and carries `before_snapshot`/`after_snapshot`/
  `impact_snapshot`, `scope` (`NEW_PURCHASES`/`ENTIRE_DRAW`/`FUTURE_DRAWS`/
  `SPECIFIC_RECORD`), and `request_id` for idempotent retries. Nothing in the schema blocks
  a SUPER_ADMIN change merely because sales have opened.
- **Six append-only history tables** (`audit_logs`, `admin_overrides`,
  `draw_status_history`, `prize_claim_award_links`, `prize_claim_status_history`,
  `ticket_ownership_history`) cannot be UPDATEd or DELETEd by the application role
  (`bakhta_app`) — both the grant is revoked and a trigger independently rejects the
  statement, so even a role that somehow retained the privilege is stopped.
- **Published results are immutable, corrections are new versions.** A conditional trigger
  (0032) allows free editing while a result is a draft and freezes it once `PUBLISHED`,
  permitting only the `PUBLISHED -> SUPERSEDED/VOID` transition and the
  `is_public_current` flip a correction performs. `four_leaf_results`/`six_chance_results`
  follow their parent result's same draft/frozen boundary.
- **The last active SUPER_ADMIN cannot be removed.** Two triggers (0033), each using
  `SELECT ... FOR UPDATE` to lock the surviving candidate rows before counting, block both
  routes to zero active SUPER_ADMINs: revoking the role assignment, and suspending/closing
  the account.
- **Claim Tokens are never stored raw.** `claim_credentials.token_digest` is a 32-byte
  SHA-256 digest (enforced by the `sha256_digest` domain); `outbox_events` has a
  defense-in-depth CHECK rejecting a top-level `raw_token`/`claim_token` payload key (not a
  substitute for careful payload construction — a nested key would not be caught).

## Deferred: payment and cryptocurrency

No table, column, enum, or seed row in this deliverable concerns payment execution, wallet
custody, blockchain settlement, exchange rates, or transaction hashes. Toman remains the
only accounting unit (`toman_amount` domain, BIGINT, nonnegative, never floating point).
`prize_claims.status` includes `READY_FOR_PAYMENT`/`PAYMENT_PENDING`/`PAID` as forward
-compatible states a future payment module will drive, but nothing here implements payment
logic. Building that module is explicitly out of scope for this deliverable.

## Verification history

Everything in this repo has been executed against a real PostgreSQL 18 instance with the
**real** `pgtap` extension (not a mock/shim) — not just written:

- All 34 `.up.sql` migrations apply cleanly, in order, from empty.
- All 34 `.down.sql` migrations roll back cleanly, in reverse order, from a fully-migrated
  database.
- `seeds/0001` and `seeds/0002` run cleanly, are idempotent (a second run makes zero
  changes), and `seeds/0001` fails loudly with a clear error and nonzero exit code when its
  required variables are not supplied.
- All 10 pgTAP files (77 assertions total, per each file's own `plan()` count) pass against
  the real `pgtap` extension.
- All 4 `tests/concurrency/*.sh` scripts pass as genuine two-connection races against the
  same real database.

This project does not use Docker. Verification of the 77 assertions and 4 concurrency races
above was done against a native, locally installed PostgreSQL 18, using the native pgTAP
install method documented above (two small files copied into `share/extension`, with the
user's explicit one-time elevated approval for that one filesystem write).

## Test coverage

`tests/pgtap/`:
- `01` — representative UNIQUE constraints (games, draws, orders, tickets, claim
  credentials, prize_claims).
- `02` — every partial unique index in the Appendix.
- `03` — exclusive-or discriminator CHECKs and the composite-FK "matching game/draw"
  invariants, including rejecting a selection table attached to the wrong game type.
- `04` — the deferred ticket/selection cardinality constraint trigger, forced immediate via
  `SET CONSTRAINTS ... IMMEDIATE`.
- `05` — the full result-correction-removes-entitlement scenario end to end: PAID claim
  survives a correction that turns its ticket into a non-winner, `current_award_id` clears,
  status returns to `PENDING_REVIEW`, award-link and status history are preserved, no new
  Claim Token is required.
- `06` — all six append-only tables reject both UPDATE and DELETE.
- `07` — a draft result is freely editable; a published one is frozen except the one
  allowed transition.
- `08` — the last-active-SUPER_ADMIN safeguard, both via role-assignment revocation and
  account suspension, plus the "a second SUPER_ADMIN unblocks it again" case.
- `09` — an award can only be `is_current` if its calculation run is `PUBLISHED`; a
  claim_credential can only be consumed by the one claim on its own ticket.
- `10` — the ticket confirmation cutoff guard (0035): confirming before cutoff succeeds;
  confirming (on insert or update) after cutoff is rejected; a PENDING ticket is unaffected
  by a passed cutoff; an already-CONFIRMED ticket can still be updated for unrelated reasons
  after its cutoff has since passed.

`tests/concurrency/` (real two-connection races, see that directory's README): the Claim
Token consumption race, the order idempotency-key race, the one-current-award-per-ticket
race, and the rule-version-activation race.

Not covered by this deliverable (flagged, not silently skipped): load-level concurrency
(hundreds of simultaneous racers), the `bakhta_app`-role privilege-revocation half of
append-only enforcement (06 tests the trigger layer only, running as table owner), and full
JSON-schema validation of `game_rule_versions.rules` (explicitly a Production Readiness
Dependency, "during database work" — the schema stores the payload and enforces only the
load-bearing keys the product owner named, e.g. the Four Leaf rounding policy).

### pgTAP gotcha: `throws_ok`'s 3-argument overload does not take a free-text description

`throws_ok(sql, errcode, description)` is **not** a valid way to say "expect this SQLSTATE,
then use this description" — pgTAP's 3-argument overload is `throws_ok(sql, errcode_or_msg,
msg_or_description)`, and when the 2nd argument looks like a 5-character SQLSTATE, the 3rd
argument is matched against the **actual raised error message text**, not used as a
description. Every test file in this suite that checks a specific SQLSTATE therefore uses
the 4-argument form: `throws_ok(sql, errcode, NULL, description)`. This was caught by
actually running the real pgTAP extension (see Verification History below) — it silently
"worked" against a hand-rolled shim during earlier development because the shim didn't
replicate this overload-resolution quirk.
