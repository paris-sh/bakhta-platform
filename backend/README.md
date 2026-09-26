# Bakhta Backend

Fastify + TypeScript + Kysely, wired to the existing PostgreSQL schema in `../migrations`.
This project does not use Docker anywhere.

**Phase 1** (skeleton): config, DB connectivity, error handling, and the scripts that run
the existing migrations/seeds/pgTAP/concurrency tests without Docker.

**Phase 2** (auth & sessions): registration, login/logout for both USER and ADMIN
principals, session verification, RBAC permission resolution. See "Auth & sessions" below.

**Phase 3** (games & rule versions): game catalog reads (public), rule-version drafting and
activation (admin), with per-(game_type, schema_version) JSON validation of the `rules`
payload, DRAFT-only editing, and audit logging. See "Games & rule versions" below.

**Phase 4** (draws & evidence): explicit draw records materialized from the active rule
version's `schedule`, YouTube Live evidence recording, and a real two-connection
concurrency proof for rule-version activation. See "Draws & evidence" below.

**Phase 5** (orders & tickets): the real purchase flow for both guests and registered
users, snapshotted selection validation, idempotent order creation, and a strictly
dev-only order-confirmation endpoint (payment is deferred). See "Orders & tickets" below.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL and, if seeding, the bootstrap admin vars
```

`DATABASE_URL` should point at the restricted `bakhta_app` runtime role for normal app use.
For running migrations you need a privileged owner/migrator connection instead (see the
root README) — the scripts below don't distinguish this for you, pass whichever connection
string the operation actually needs via `DATABASE_URL`.

## Commands

```bash
npm run db:migrate           # applies ../migrations/*.up.sql, in order
npm run db:rollback          # rolls back *.down.sql, reverse order (see root README caveats)
npm run test:pgtap           # runs ../tests/pgtap/* against the real pgtap extension —
                              # run this BEFORE seeding (see note in the script/root README)
npm run db:seed              # runs ../seeds/*.sql (requires BAKHTA_BOOTSTRAP_ADMIN_EMAIL/NUMBER)
npm run test:concurrency     # runs the 4 two-connection race scripts in ../tests/concurrency
npm run db:generate-types    # regenerates src/db/types.ts from the live schema (kysely-codegen)

npm run dev                  # starts the API with tsx watch
npm test                     # Vitest — 89 tests across health/auth/games/draws/schedule/orders
npm run typecheck
```

`db:migrate`, `db:rollback`, and `db:seed` are thin wrappers that shell out to the real
`psql` binary (must be on PATH) rather than executing SQL over the app's own driver
connection — the seed files use psql-only meta-commands (`\if`, `:'var'` interpolation)
that only work through the real client. See `scripts/lib/psql.ts` for why.

## Auth & sessions (Phase 2)

- **Authentication**: `Authorization: Bearer <opaque_session_token>` only, for both `USER`
  and `ADMIN` principals. No cookies, no CSRF handling (doesn't apply to header-based bearer
  auth). Only the session token's SHA-256 digest is ever stored (`sessions.token_digest`);
  the raw token is returned once, in the login response body, and never logged.
- **Password hashing**: Argon2id via `hash-wasm` — a pure WebAssembly implementation with
  zero native (`.node`) bindings. This is deliberate: this environment has a Windows
  Application Control policy that blocks native addon binaries outright (confirmed by
  trying both `argon2` and `@node-rs/argon2` first — both failed with "An Application
  Control policy has blocked this file"). Do not swap in a native Argon2 binding without
  first confirming the target environment allows native addons.
- **Login safety**: unknown-email and wrong-password both return the identical generic
  `401` message (a fixed dummy hash is verified even when the account doesn't exist, so
  response timing doesn't leak account existence); durable rate limiting is backed by the
  real `auth_attempts` table, not in-memory state.
- **Session lifecycle**: idle and absolute expiry (admin sessions are shorter-lived than
  user sessions, per spec), a sliding idle window on every authenticated request, instant
  global logout via `auth_version` mismatch detection, and RBAC permission resolution for
  `ADMIN` principals via `admin_role_assignments → role_permissions → permissions`.
- **Claim Tokens remain completely separate** — a different table (`claim_credentials`), a
  different module (not yet built), never accepted as a session credential.

Endpoints: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/admin/auth/login`,
`POST /v1/auth/logout`, `GET /v1/me`, `GET /v1/admin/me`.

## Games & rule versions (Phase 3)

- **Public reads only serve the game's currently ACTIVE rule version** — never a DRAFT or
  RETIRED one, and never more than one at a time (`one_active_rule_version_per_game` is the
  database's own guarantee; this module never has to re-derive it).
- **Rule JSON validation, versioned by (game_type, schema_version) together** (the spec's
  own Production Readiness Dependency, "Rule JSON validation... During database work"):
  `rules.schemas.ts` holds a registry keyed by both, resolved together — never `game_type`
  alone. Every `rules` payload declares its own integer `schema_version` (also required at
  the database layer: migration 0036's CHECK). When a future schema_version is introduced,
  a new registry entry is ADDED; an existing entry's validator is never edited or replaced,
  so a rule version created under schema_version 1 stays validatable under exactly the
  schema_version-1 rules forever, even after a v2 exists. Both current schemas are
  unit-tested directly against the real seeded payloads (queried live from a migrated
  database, not reconstructed from memory), so schema drift would be caught immediately.
- **The recurring draw schedule lives inside `rules.schedule`** (Phase 4 amendment) — see
  "Draws & evidence" below for what reads it.
- **Four Leaf's rounding-policy requirement is enforced twice, deliberately**: once here
  (Zod, for a fast 400 before the insert) and once at the database layer
  (`ck_game_rule_versions_four_leaf_rounding`, the non-bypassable guarantee). Neither
  replaces the other. The same double-enforcement pattern now also covers `schema_version`
  itself (Zod + migration 0036's CHECK) — and that CHECK constraint taught a real lesson:
  `jsonb_typeof(rules -> 'schema_version') = 'number'` alone silently PASSED a payload
  missing the key entirely, because a missing key makes the expression SQL `NULL`, and a
  CHECK only rejects on an explicit `FALSE`, never `NULL`. Caught by actually running the
  pgTAP suite (not by inspection) — fixed by also asserting `rules ? 'schema_version'`.
- **DRAFT-only editing**: `PATCH /v1/admin/rule-versions/:id` re-validates against the same
  (game_type, schema_version) registry and re-hashes `rules_hash`, but only while the
  version is still DRAFT — ACTIVE and RETIRED are immutable, enforced by the same 409 path
  as activating a non-DRAFT version. Changing a live or historical rule requires creating a
  new DRAFT instead.
- **Every mutation is audit-logged**: game updates, rule-version create/update/activate all
  call a minimal, write-only `AuditService.recordAdminAction()` (`src/modules/audit/` — not
  the full Audit module from the architecture proposal, just the cross-cutting write
  capability every other module needs now; view/export endpoints stay deferred).
- **Activation is atomic AND genuinely race-safe** — this one was a real bug, not a
  precaution. The first implementation retired "whichever version is currently ACTIVE" as a
  generic predicate; tracing through what happens when two DIFFERENT DRAFT versions are
  activated concurrently showed BOTH requests would report success, with the second
  silently clobbering the first (no conflict ever surfaced to either caller). Fixed by
  making the retire step a compare-and-swap scoped to the SPECIFIC row this transaction
  observed as active: if a concurrent transaction already retired that exact row by the
  time this one's retire-UPDATE runs, the UPDATE affects zero rows and is reported as a
  clean `409`, not a silent clobber or a raw constraint-violation `500`. Proven with a real
  two-connection race, not just reasoned about — see `tests/concurrency/rule_version_activation_race.sh`.
- **No game-creation endpoint** — the spec ships exactly two fixed games for the first
  release (already seeded); creating new games isn't a supported first-release admin
  action, so it isn't built. `PATCH` only allows `nameFa`/`nameEn`/`status` — `code`,
  `slug`, and `game_type` are structural identity fields this module treats as immutable
  (the whole composite-FK design in the migrations assumes `game_type` never changes).
- Permission-gated per endpoint: `games.view`, `games.edit`,
  `games.activate_rule_version` — granting these to a role is an Administration-module
  concern (not yet built), so no ADMIN can reach these endpoints until that exists. Correct
  default-deny, not a gap.

Endpoints: `GET /v1/games`, `GET /v1/games/:slug`, `GET /v1/admin/games/:id`,
`PATCH /v1/admin/games/:id`, `GET /v1/admin/games/:id/rule-versions`,
`POST /v1/admin/games/:id/rule-versions`, `PATCH /v1/admin/rule-versions/:id`,
`POST /v1/admin/rule-versions/:id/activate`.

## Draws & evidence (Phase 4)

- **The recurring schedule is data, not a separate table**: `rules.schedule` (timezone,
  active weekdays, local draw time, sales-open/close offsets, dated SKIP exceptions) —
  versioned exactly like every other rule value, per the product owner's explicit amendment
  over a `schedule_templates` table.
- **Draws are explicit, materialized rows — never computed per request.**
  `POST /v1/admin/games/:id/draws/generate` reads the active rule version's schedule and
  INSERTs real `draws` rows for occurrences not already materialized (idempotent — safe to
  call repeatedly, e.g. from a daily job); the public "next draw" endpoint
  (`GET /v1/games/:slug/draws/next`) is a plain indexed query (`status = 'SALES_OPEN' ORDER
  BY draw_at LIMIT 1`) against those rows, with no schedule math at request time. If nothing
  has been generated yet, that's a `404`, not a silently-synthesized draw.
- **Timezone-aware occurrence math is unit-tested against a DST-observing zone, not just a
  fixed-offset one** — `schedule.ts`'s `zonedTimeToUtc` is verified against both Asia/Tehran
  (UTC+3:30, no DST) and America/New_York in both January (EST, UTC-5) and July (EDT,
  UTC-4), against independently-verified expected UTC instants, specifically because this
  is exactly the kind of date math that looks right for one case and is subtly wrong for
  the DST-crossing one.
- **Every draw permanently snapshots `current_rule_version_id` and
  `current_rules_snapshot` at creation time** — a real, independent JSONB value copied at
  INSERT time, never a live reference to `game_rule_versions`. A later rule-version
  activation changes what NEW draws will snapshot; it cannot reach an already-created
  draw's row at all. Verified directly: generate a draw under one price, activate a new
  rule version with a different price, re-fetch the *existing* draw, and confirm it still
  shows the original price.
- **SUPER_ADMIN-scoped overrides remain the only authorized mechanism for changing an
  already-created or already-selling draw** — enforced by absence, not by a permission
  check: this phase deliberately does not implement reschedule/cancel/delay/void endpoints
  at all. `draws.generate` only ever INSERTs new future draws; nothing in this module can
  mutate an existing draw's schedule-derived fields. Those lifecycle transitions belong to
  the future SUPER_ADMIN Overrides module (impact preview + confirmation code), not a plain
  ADMIN PATCH — building a shortcut here would directly contradict that principle, so it
  was left out rather than half-built.
- **YouTube Live evidence**: `POST /v1/admin/draws/:id/evidence` creates the one evidence
  row for a draw — a second attempt is `409 Conflict` ("a separately recorded replacement
  video is not the draw evidence," enforced, not just documented). `PATCH
  /v1/admin/draw-evidence/:id/status` only ever changes `status`/timing/`archive_url` —
  `youtube_live_url`/`youtube_video_id` are immutable by omission from that endpoint's own
  request schema, not by convention.
- Permission-gated: `draws.view`, `draws.create`, `draws.manage_evidence`.

Endpoints: `GET /v1/games/:slug/draws/next`, `GET /v1/admin/draws/:id`,
`GET /v1/admin/games/:id/draws`, `POST /v1/admin/games/:id/draws/generate`,
`POST /v1/admin/draws/:id/evidence`, `PATCH /v1/admin/draw-evidence/:id/status`.

## Orders & tickets (Phase 5)

- **Guest and registered-user purchases share one endpoint**: `POST /v1/orders` uses an
  *optional* authenticate hook (`createOptionalAuthenticateHook`) — a fully absent
  `Authorization` header means guest, but a present-and-invalid/expired one is still a
  `401`, never silently downgraded to guest (a broken session should never look like an
  intentional guest checkout). An `ADMIN` principal is explicitly rejected (`403`) —
  admins don't buy tickets.
- **Every selection is validated against the DRAW'S OWN snapshotted rule version**
  (`draws.current_rules_snapshot`), never the game's current live rule version and never a
  hardcoded bound — `orders/selections.ts` reads `main_numbers.count/min/max` and
  `chance_symbol.min/max` (Six Chance) or the 4-digit shape (Four Leaf) out of the parsed
  snapshot at request time. This is what keeps an order valid against the rules that were
  in force when its draw was created, even after a game's live rule version has since
  changed.
- **`Idempotency-Key` is required** (a header, validated as a UUID) and is the actual
  authority for "retry-safe": the app checks `orders.idempotency_key` first, but the real
  guarantee is the database's own unique index — a race between two identical concurrent
  retries is caught via `isUniqueViolation(err, "uq_orders_idempotency_key")` and answered
  by re-fetching and returning the winning order, never a duplicate and never a raw
  constraint-violation `500`. Proven both by a real two-connection race
  (`tests/concurrency/order_idempotency_race.sh`) and by an in-process Vitest retry test.
  A retried key from a *different* purchaser than the original is rejected (`409`) rather
  than silently handing back someone else's order.
- **One transaction does all of it**: lock the draw row (`FOR UPDATE`), re-verify
  `status = 'SALES_OPEN'` and the sales-open/close window under that lock (the
  authoritative check — a pre-transaction read is only used for pricing/selection
  validation), then insert the order and every ticket + its matching
  `four_leaf_ticket_selections`/`six_chance_ticket_selections` row. Migration 0035's
  cutoff trigger is a defense-in-depth backstop; the clean `409` for "sales closed" comes
  from this app-level recheck, not from catching the trigger's raw exception.
  `owner_user_id` is set for registered-user tickets and left `NULL` for guest tickets —
  that column alone is the guest/registered discriminator downstream (Claim Credential
  eligibility included).
- **Dev-only confirmation, strictly non-production**: `POST /v1/dev/orders/:id/confirm`
  is double-guarded — `NODE_ENV !== 'production'` AND an explicit
  `DEV_ORDER_CONFIRMATION_ENABLED` flag both have to hold, so flipping the flag true by
  mistake in a misconfigured production environment still isn't enough on its own. In one
  transaction it locks the order then the draw, rechecks the cutoff, flips the order and
  every ticket to `CONFIRMED`, and creates a Claim Credential **only** for tickets with a
  `NULL owner_user_id` — registered-user tickets never get one. The raw Claim Token exists
  only in a local variable and the HTTP response; only its SHA-256 digest
  (`claim_credentials.token_digest`) is ever written anywhere, and it is never logged,
  audited, or sent to any notification/outbox path. Payment (the real confirmation path)
  is out of scope for this build stage; this endpoint exists solely to unblock a clickable
  demo.
- **Claim Tokens stay structurally independent of session tokens** — `orders/claim-token.ts`
  shares no code or module boundary with `auth/session-token.ts`, per the standing
  requirement that the two mechanisms never be conflated, even though both happen to use
  "32 random bytes, base64url, SHA-256 digest."
- **The public ticket-check endpoint** (`GET /v1/tickets/check/:publicCode`) is looked up
  by `public_code` alone and returns only game/draw/selection/price/status — no
  `ownerUserId`, no internal UUIDs, no Claim Token, no guest email.
- **My Orders / My Tickets** (`GET /v1/me/orders`, `GET /v1/me/tickets`) are scoped to
  `request.principal.userId` at the query level (`WHERE purchaser_user_id = …` /
  `WHERE owner_user_id = …`), not filtered after the fact — and fetching another user's
  order directly by id (`GET /v1/orders/:id`) is a `403`.
- Duplicate selections within the same order are allowed (the spec's own rule) but flagged:
  each ticket in the response carries `duplicateInOrder: boolean`.

Endpoints: `POST /v1/orders`, `GET /v1/orders/:id`, `GET /v1/me/orders`,
`GET /v1/me/tickets`, `GET /v1/tickets/check/:publicCode`,
`POST /v1/dev/orders/:id/confirm` (dev-only, double-guarded).

## What's verified so far

Against a real local PostgreSQL 18 (not mocked): `db:migrate` (36 migrations) →
`test:pgtap` (77 assertions across 11 files, real extension) → `test:concurrency` (4
genuine two-connection races, including the rule-version-activation and order-idempotency
compare-and-swaps) → `db:seed` → app boot → full auth flow (register/login/logout/session
expiry/global logout/rate limiting/permission resolution) → full games flow (public
catalog reads, permission enforcement, versioned rule validation, DRAFT-only editing,
audit logging, atomic/race-safe activation) → full draws flow (schedule-driven generation,
idempotency, snapshot immutability against later rule changes, evidence
recording/immutability) → full orders/tickets flow (Four Leaf and Six Chance purchases,
guest and registered-user, multiple ticket rows, snapshotted selection validation,
idempotent retries, cutoff enforcement, dev-only confirmation with guest-only Claim
Credential issuance and one-time raw token return, public ticket check privacy, My
Orders/My Tickets ownership isolation) → `db:rollback` back to empty. 89 Vitest tests
total (including DST-crossing timezone math), all against the real database, zero mocks.
Running `db:seed` before `test:pgtap` against the *same* database is a known ordering
trap — documented in both the root README and `scripts/run-pgtap.ts`'s header comment,
not just here (Phase 5 re-confirmed this firsthand: seeding first left an extra active
SUPER_ADMIN in the table that defeated `08_super_admin_safeguard.sql`'s "final admin"
assumption — re-running in the documented order, migrate → pgTAP → seed, passed cleanly;
no code was at fault). Regenerating `db/types.ts` must be done against a database WITHOUT
the pgtap extension installed, or pgTAP's own internal objects pollute the generated file
— see `scripts/generate-db-types.ts`'s header comment.

## Not yet built

Results, prize calculation, claims (guest ticket recovery via the Claim Token issued at
dev-confirmation — the token exists now, but there's no submit/redeem flow yet), ticket
ownership transfer history, SUPER_ADMIN overrides (including draw reschedule/cancel/delay
/void — deliberately deferred, see "Draws & evidence" above), the full Audit module's
view/export side (Phase 5's customer-facing order actions are deliberately NOT wired to
`AuditService.recordAdminAction`, since that service is ADMIN-actor-specific and there is
no customer/system-actor variant yet), notifications/outbox, support tickets,
general-purpose rate limiting beyond login, background workers, and — the actual point of
Phase 5's dev-only confirmation endpoint — real payment. See the Backend/API Architecture
proposal (chat history) for the full plan and module boundaries before adding to this.
