# Bakhta Technical Product and Data Architecture Specification

**Version 0.2**  
**Approved product and database implementation specification**  
**26 September 2026**

This document is the authoritative product and database implementation specification for the current Bakhta lottery platform design. Version 0.2 incorporates the completed independent review and the product owner's final decisions. Where a review recommendation conflicts with this document, this document controls implementation.

The payment implementation is intentionally outside the current scope. Crypto settlement will be designed later, but the present data model preserves the information needed to add it without rewriting lottery, ticket, result, prize, or audit records.

# Document Status and Implementation Goals

The document distinguishes approved product decisions from configurable defaults and production-readiness dependencies. Configurable values are not hardcoded. A SUPER_ADMIN may change business configuration before or after sales open, including for the current draw, through a versioned override workflow. Previous values remain available to authorized internal users.

| **Category**          | **Meaning**                                                                                                                                     |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| Approved decision     | A product rule accepted for the first release unless a later decision replaces it.                                                              |
| Configurable default  | A starting value editable by a SUPER_ADMIN for the current draw, future purchases, the whole draw, or future draws.                             |
| Deferred              | A required capability intentionally postponed, including crypto payment execution.                                                              |
| Production dependency | A legal, financial, operational, or technical decision that must be completed before real-money launch but does not block database development. |

## Implementation Priorities

- Implement the PostgreSQL schema, migrations, constraints, indexes, histories, and append-only audit controls before API or frontend work.

- Preserve unrestricted SUPER_ADMIN business authority through explicit versioned overrides rather than destructive overwrites.

- Keep game mathematics deterministic while allowing configurable prices, prizes, caps, schedules, and jackpot settings.

- Support registered and guest purchases without storing raw Claim Tokens.

- Keep payment and cryptocurrency execution outside the current implementation stage.

# Platform Scope

Bakhta is an online lottery platform with two initial games, account and guest purchases, physical offline draws, result publication, automated prize calculation, guest prize claims through a private bearer credential, and a configurable administration panel. Blockchain is not used to generate or prove draw results. It will only be considered later as a payment rail for cryptocurrency settlement.

| **Area**        | **Current scope**                                                       |
|-----------------|-------------------------------------------------------------------------|
| Brand           | Bakhta                                                                  |
| Games           | Six Chance and Four Leaf                                                |
| Purchasers      | Registered users and guests                                             |
| Draw method     | Physical offline draw broadcast through a scheduled YouTube Live stream |
| Accounting unit | Integer toman amounts                                                   |
| Database        | PostgreSQL                                                              |
| Payment         | Deferred; crypto support will be added later                            |
| Administration  | ADMIN and SUPER_ADMIN in the first release                              |

# Game Rules

## Four Leaf

Four Leaf is a daily exact-match four-digit game. The schedule is not hardcoded; a SUPER_ADMIN configures the active days, draw time, sales window, official timezone, and exceptions.

The ticket price, fixed prize, payout cap, schedule, and other business values are configurable. The values below are the current defaults and can be changed through a rule version or SUPER_ADMIN override.

| **Rule**                              | **Current decision**                                            |
|---------------------------------------|-----------------------------------------------------------------|
| Selection                             | Exactly four digits from 0000 through 9999                      |
| Order                                 | Order matters                                                   |
| Leading zero                          | Allowed                                                         |
| Repeated digits                       | Allowed                                                         |
| Winning condition                     | Exact four-digit match only                                     |
| Ticket price                          | 50,000 toman per row                                            |
| Fixed prize                           | 60,000,000 toman per winning row                                |
| Theoretical probability               | 1 in 10,000                                                     |
| Theoretical return at the fixed prize | 12 percent before the total payout cap                          |
| Total payout cap                      | Configurable; 300,000,000 toman is the current proposed default |
| Rollover                              | None                                                            |

If the sum of fixed prizes exceeds the configured total payout cap, the cap is divided equally among all winning rows. The exact handling of a remainder smaller than one toman per winner remains an open accounting decision and must be deterministic.

## Six Chance

Six Chance is the main jackpot game. A row contains six distinct main numbers from 1 through 33 and one chance symbol from 1 through 5. Main-number order does not affect matching.

Ticket prices, tier prizes, contribution percentages, caps, jackpot limits, and schedules are configurable. The values below are the current defaults.

| **Match**                        | **Prize**                                         |
|----------------------------------|---------------------------------------------------|
| 6 main numbers and chance symbol | Jackpot pool                                      |
| 6 main numbers                   | 50 times ticket price, currently 15,000,000 toman |
| 5 main numbers and chance symbol | 10 times ticket price, currently 3,000,000 toman  |
| 5 main numbers                   | 5 times ticket price, currently 1,500,000 toman   |
| 4 main numbers and chance symbol | 3 times ticket price, currently 900,000 toman     |
| 4 main numbers                   | 2 times ticket price, currently 600,000 toman     |
| 3 main numbers and chance symbol | One free row                                      |

| **Rule**              | **Current decision**                                                                               |
|-----------------------|----------------------------------------------------------------------------------------------------|
| Ticket price          | 300,000 toman per row                                                                              |
| Jackpot odds          | 1 in 5,537,840                                                                                     |
| Minimum jackpot       | 100,000,000 toman                                                                                  |
| Jackpot contribution  | 60 percent of net sales, stored as 6000 basis points                                               |
| Net sales basis       | Confirmed sales less lower-tier prizes and refunds                                                 |
| Jackpot winner        | The current jackpot is divided equally among jackpot-winning rows                                  |
| No jackpot winner     | The current jackpot carries into the next draw                                                     |
| Maximum jackpot       | No maximum is currently defined                                                                    |
| Lower-tier payout cap | Separate configurable cap; reduce affected fixed prizes proportionally while preserving tier order |

### Jackpot Accounting Formula

The current interpretation is that the jackpot available in draw d is its opening pool Jd. The contribution generated by draw d is Cd, equal to 60 percent of net sales for that draw. The next draw opens as follows:

> If draw d has no jackpot winner:  
> J(d+1) = max(100,000,000, Jd + Cd)  
>   
> If draw d has one or more jackpot winners:  
> J(d+1) = max(100,000,000, Cd)

The winners of draw d divide Jd, not Jd plus Cd. This is the approved default calculation. Once the next draw opens, its opening jackpot remains the default settlement basis. A later correction is recorded as a reconciliation adjustment unless a SUPER_ADMIN explicitly applies a broader override after reviewing its impact.

# Draw Operations

Draws are physical and performed offline while being broadcast through a scheduled YouTube Live stream. A separately recorded replacement video is not the draw evidence. Blockchain-generated randomness is explicitly excluded. The platform stores the scheduled live URL, YouTube video identifier, stream timestamps, and archived live URL while treating the approved result record as the operational source of truth.

- Four Leaf must use a process that permits repeated digits. This can use four independent digit sets or replacement of each digit ball after selection.

- Six Chance draws six balls from 1 through 33 without replacement, then draws the chance symbol separately from 1 through 5.

- The server clock controls sales cutoffs. The system must not insert a confirmed ticket retroactively after the applicable cutoff.

- The draw schedule is generated from a recurring schedule template, but each concrete draw is stored as a separate versioned business record.

## Draw Lifecycle

> SALES_OPEN -\> SALES_CLOSED -\> DRAW_IN_PROGRESS -\> RESULT_ENTERED  
> -\> PENDING_REVIEW -\> PUBLISHED -\> SETTLED -\> CLOSED  
>   
> Exceptional states: DELAYED, CANCELLED, VOID

A delayed draw keeps its tickets valid. A cancelled draw will require a refund workflow when the payment module is implemented. A void draw preserves all historical records. A SUPER_ADMIN may move a draw between lifecycle states, reopen sales, reschedule, cancel, or void it. After sales open, the interface must show an impact preview and require a confirmation code and reason, but it must not prevent the authorized override.

# Purchases Orders and Tickets

A purchase can be made by a registered user or a guest. In the current version, each order belongs to one draw and contains one or more ticket rows. Purchases covering different draws become separate orders. This simplifies cutoffs, cancellation, refunds, and settlement.

- Only confirmed ticket rows participate in a draw.

- Every row is a separate ticket and a separate share of a prize.

- Manual number selection and Quick Pick are supported.

- Duplicate selections are allowed because each row is a separate paid share, but the user receives a warning.

- Row limits per order, per draw, and per day are configurable separately for guests and registered users.

- A confirmed ticket stores its unit price and the rule version effective at purchase. A later whole-draw override is stored separately and is referenced by the applicable calculation run.

- The public QR code contains a public ticket code, never the private Claim Token.

## Guest Purchase

Guest purchase is a required feature. The current design assumes that a guest email address is required for receipt delivery and recovery, but this assumption has not been explicitly finalized. A guest order keeps its original purchaser type even if one of its tickets is later attached to a user account.

## Ticket Status

Purchase validity and draw outcome are stored separately to avoid contradictory states.

| **Dimension**   | **States**                                    |
|-----------------|-----------------------------------------------|
| Ticket validity | PENDING, CONFIRMED, CANCELLED, REFUNDED, VOID |
| Ticket outcome  | PENDING, WINNER, NOT_WINNER, VOID             |

# Results Preview Publication and Corrections

The first release does not require two administrators. An ADMIN may enter or review a result when permitted, and a SUPER_ADMIN may enter, review, publish, correct, or override it. Before publication, the system must show the entered result, all winner counts, tier amounts, caps, jackpot effects, total liability, and calculation warnings. Publication requires a separate confirmation code and a mandatory reason.

- A Four Leaf result is stored as a four-character string so a leading zero is preserved.

- A Six Chance result stores both physical draw order and normalized sorted values.

- A published result is never overwritten in place. A correction creates a new version and supersedes the prior version.

- The public API returns only the current published result. It does not display a correction badge, old values, correction history, or the reason for correction.

- Internal users with permission can view every result version and the complete reason and actor history.

- Publishing a corrected result recalculates all awards. Existing claims follow their tickets to the replacement awards, and an already paid affected award enters manual reconciliation.

- Affected ticket owners receive a private notification if their result or prize changes.

# Prize Awards and Claims

Prize calculation and prize claiming are separate. A prize award is the system-calculated entitlement for a winning ticket. A prize claim is the claimant's request to receive that entitlement.

- The default claim period is 90 days after result publication and is configurable per rules version.

- A registered owner submits from My Tickets.

- A guest submits the public ticket code and private Claim Token.

- Each ticket can have only one continuing claim record. Additional information, rejection, appeal, reopening, or a corrected award continues on the same claim with status and award-link history.

- Payment destination and crypto execution are deferred to the future payment module.

| **Claim status**  | **Meaning**                                            |
|-------------------|--------------------------------------------------------|
| PENDING_REVIEW    | Submitted and awaiting review                          |
| NEEDS_INFO        | Claimant must provide additional information           |
| APPROVED          | Claim approved                                         |
| READY_FOR_PAYMENT | Ready for the future settlement module                 |
| PAYMENT_PENDING   | Settlement initiated but not final                     |
| PAID              | Payment completed                                      |
| REJECTED          | Claim rejected with a recorded reason                  |
| DISPUTED          | Claim or decision is under dispute                     |
| FROZEN            | Security or correction review prevents progress        |
| EXPIRED           | Claim period ended without a valid submission          |
| SUPERSEDED        | Underlying award was superseded by a result correction |

# Claim Token Security

The Claim Token is the digital equivalent of a bearer ticket for a guest purchase. Possession authorizes a sensitive ownership or claim action, so it must be treated as a high-entropy secret rather than as a public ticket number.

| **Control**        | **Design**                                                                             |
|--------------------|----------------------------------------------------------------------------------------|
| Generation         | 32 random bytes from a cryptographically secure random number generator                |
| Encoding           | Base64url for user display                                                             |
| Storage            | SHA-256 digest stored as BYTEA with a global unique constraint                         |
| Raw token          | Displayed or delivered once; never stored or shown to an administrator                 |
| Lookup             | Hash submitted token, then use the unique index for lookup                             |
| Collision handling | Insert directly; retry generation only on a unique-constraint violation                |
| Lifecycle          | ACTIVE, USED, ROTATED, REVOKED                                                         |
| Per-ticket rule    | At most one ACTIVE credential for a ticket                                             |
| Recovery           | Verified guest email may initiate rotation; the previous digest is retained as ROTATED |
| Public QR          | Never contains the Claim Token                                                         |

The system must rate-limit token attempts and record suspicious activity. The global unique index is the final collision and race-condition protection. It also makes token lookup faster. A SELECT-before-INSERT check is not sufficient because concurrent requests can both pass the check.

The raw token is generated in memory and delivered once through the secure purchase-completion response or an explicitly approved one-time delivery channel. Only its digest is committed. The raw token must never enter notifications, notification payloads, rendered-message snapshots, outbox events, support records, application logs, audit logs, analytics, or QR codes.

# Administration and Audit

A SUPER_ADMIN has unrestricted business override authority, including after sales open. The application must not block an authorized change because tickets already exist. Sensitive changes create new versions, transitions, or override records rather than destroying history. Every high-risk action requires an impact preview, confirmation code, reason, and append-only audit event. A board decision reference can be recorded but is not a technical approval dependency.

- Sensitive changes include results, sold-draw rules, schedules after ticket sales, payout amounts, caps, payment status, wallet addresses, user balances, draw cancellation, and draw reopening.

- The SUPER_ADMIN selects whether an override applies to new purchases only, the entire current draw, future draws, or a specific record.

- The audit event records old values, new values, reason, actor, time, IP address, user agent, affected entity, request identifier, and evidence where applicable.

- Application SUPER_ADMIN accounts cannot update or delete audit or override history, even though they may issue a new business override.

- Passwords, raw Claim Tokens, one-time codes, private keys, and payment secrets are never written to audit logs.

- Database-owner access remains an infrastructure responsibility and must be separated from application administration.

## Roles and Permissions

The first release has ADMIN and SUPER_ADMIN roles. The model supports future SUPPORT, DRAW_OPERATOR, FINANCE, and AUDITOR roles. Authorization is enforced by backend permission checks, not by hiding controls in the interface.

| **Module**           | **Representative permissions**                                                                      |
|----------------------|-----------------------------------------------------------------------------------------------------|
| Games                | view, edit, activate rule version                                                                   |
| Draws                | view, create, reschedule, cancel                                                                    |
| Results              | enter, publish, correct                                                                             |
| Orders and tickets   | view, cancel, refund, invalidate                                                                    |
| Prizes and claims    | view, approve, reject, freeze, mark paid                                                            |
| Support              | view, reply, add internal note, close                                                               |
| Users                | view, suspend, close                                                                                |
| Notifications        | manage templates, send                                                                              |
| Audit                | view, export                                                                                        |
| Administration       | create admin, assign role, disable admin                                                            |
| SUPER_ADMIN override | preview and apply any business configuration, lifecycle, result, prize, claim, or schedule override |

# Notifications and Support

The first release supports email and in-application notifications for registered users and email delivery for guests where applicable. SMS, WhatsApp, and push notifications remain future channels. Transactional notifications cannot be disabled; reminders, jackpot updates, and marketing are optional.

- Mandatory events include ticket confirmation, win notification, schedule change, cancellation, claim status, prize status, and security alerts.

- A winning email subject does not reveal the prize amount.

- The raw Claim Token never appears in a stored notification, outbox payload, rendered delivery snapshot, later message, or administrator interface.

- Each channel delivery has a unique idempotency key to prevent duplicates and supports retries with recorded provider status.

- Support categories include missing ticket, lost Claim Token, result or prize dispute, account attachment, claim problem, account problem, and payment problem.

- Internal support notes are not visible to the requester. Claim Tokens pasted into support text should be detected and masked.

# Data Architecture Principles

| **Principle**        | **Decision**                                                                              |
|----------------------|-------------------------------------------------------------------------------------------|
| Primary database     | PostgreSQL                                                                                |
| Internal identifiers | UUID                                                                                      |
| Money                | BIGINT integer toman; never floating point                                                |
| Percentages          | Integer basis points where practical                                                      |
| Time                 | TIMESTAMPTZ stored in UTC; display official and user-local timezones                      |
| Deletion             | Financial, draw, result, award, claim, credential, and audit records are not hard-deleted |
| Rule history         | Versioned rules, purchase-time references, and explicit SUPER_ADMIN overrides             |
| Result history       | Append new versions; never edit a published result in place                               |
| Foreign key deletion | RESTRICT for business records                                                             |
| Public identifiers   | Random non-sequential codes separate from internal UUIDs                                  |

# Core Table Catalog

| **Table**                    | **Purpose**                            | **Key content**                            | **Primary invariant**                                         |
|------------------------------|----------------------------------------|--------------------------------------------|---------------------------------------------------------------|
| games                        | Game identity and lifecycle            | id; code; slug                             | Unique code and slug; no mutable prize rules                  |
| game_rule_versions           | Versioned game configuration           | game_id; version_number; rules             | Unique game and version; one ACTIVE version per game          |
| draws                        | Concrete draw instance                 | game_id; draw_number; schedule; snapshot   | Unique game and draw number; time ordering checks             |
| draw_status_history          | Append-only draw transitions           | draw_id; from; to; actor; reason           | Insert only; records normal and override transitions          |
| draw_evidence                | YouTube Live evidence                  | draw_id; live URL; video ID; timestamps    | Versioned evidence; no replacement upload as source           |
| admin_overrides              | Sensitive business overrides           | actor; target; scope; snapshots; reason    | Append only; confirmation and impact evidence                 |
| orders                       | One purchase for one draw              | draw_id; purchaser; totals; status         | Unique order number and idempotency key                       |
| tickets                      | One purchased or awarded row           | order_id; line_number; owner; price        | Unique public code and order line                             |
| four_leaf_ticket_selections  | Four Leaf selection                    | ticket_id; number_value                    | Exactly four digit characters                                 |
| six_chance_ticket_selections | Six Chance selection                   | ticket_id; n1 through n6; symbol           | Strictly increasing values 1 through 33; symbol 1 through 5   |
| results                      | Versioned result record                | draw_id; version; status                   | Unique draw and version; one public current result            |
| four_leaf_results            | Four Leaf result value                 | result_id; number_value                    | Exactly four digit characters                                 |
| six_chance_results           | Six Chance result values               | result_id; draw_order; normalized values   | Six unique main values and one valid symbol                   |
| prize_calculation_runs       | Preview and settlement calculations    | draw; result; rules; totals; status        | Idempotent run and calculation hash                           |
| prize_awards                 | Calculated ticket entitlement          | result_id; ticket_id; tier; amount         | One award per ticket per result; one current award per ticket |
| claim_credentials            | Hashed guest bearer credentials        | ticket_id; token_digest; status            | Unique digest; one ACTIVE credential per ticket               |
| prize_claims                 | Continuing ticket claim                | ticket_id; current award; claimant; status | One claim per ticket and unique claim number                  |
| prize_claim_award_links      | Claim and award version history        | claim_id; award_id; reason                 | Unique claim and award link                                   |
| prize_claim_status_history   | Append-only claim transitions          | claim_id; from; to; actor                  | Insert only                                                   |
| audit_logs                   | Append-only sensitive event history    | actor; action; entity; before; after       | No application update or delete permission                    |
| support_tickets              | Support case                           | requester; category; related entities      | Unique case number                                            |
| support_messages             | Case conversation and internal notes   | case_id; sender; body                      | Internal-note visibility enforced                             |
| notifications                | One delivery per recipient and channel | event; recipient; channel; status          | Unique idempotency key                                        |
| outbox_events                | Post-commit event delivery             | event; aggregate; safe payload; attempts   | No raw Claim Token; idempotent processing                     |
| users                        | Customer account                       | email; status; auth version                | Unique case-insensitive email and user number                 |
| user_credentials             | Customer password credential           | user_id; password hash                     | One credential row per user                                   |
| admin_accounts               | Separate administrator account         | email; status; auth version                | Unique email and admin number                                 |
| admin_credentials            | Administrator password credential      | admin_id; password hash                    | One credential row per admin                                  |
| roles                        | Named administrative role              | code; system flag                          | Unique code                                                   |
| permissions                  | Atomic backend authorization           | code; module; action; risk                 | Unique code                                                   |
| role_permissions             | Role-to-permission map                 | role_id; permission_id                     | Composite primary key                                         |
| admin_role_assignments       | Versioned role assignments             | admin_id; role_id; assign and revoke data  | One active assignment per admin and role                      |
| sessions                     | Opaque user or admin session           | principal; token digest; expiry            | Unique token digest and one valid principal                   |
| auth_attempts                | Login attempt and rate-limit evidence  | identifier hash; result; IP; time          | No raw unknown email identifier required                      |

# Important Table Designs

## games

| **Field**                 | **Type**    | **Purpose**                           |
|---------------------------|-------------|---------------------------------------|
| id                        | UUID        | Primary key                           |
| code                      | VARCHAR     | Unique stable code such as SIX_CHANCE |
| slug                      | VARCHAR     | Unique public URL slug                |
| name_fa and name_en       | VARCHAR     | Localized names                       |
| status                    | ENUM        | ACTIVE, PAUSED, ARCHIVED              |
| created_at and updated_at | TIMESTAMPTZ | Record timestamps                     |

## game_rule_versions

| **Field**                   | **Type** | **Purpose**                     |
|-----------------------------|----------|---------------------------------|
| id                          | UUID     | Primary key                     |
| game_id                     | UUID     | Game foreign key                |
| version_number              | INTEGER  | Monotonic within the game       |
| status                      | ENUM     | DRAFT, ACTIVE, RETIRED          |
| rules                       | JSONB    | Complete validated rule payload |
| rules_hash                  | BYTEA    | Integrity and equality check    |
| change_reason               | TEXT     | Required reason                 |
| created_by and activated_by | UUID     | Administrator references        |

## draws

| **Field**                   | **Type**    | **Purpose**                          |
|-----------------------------|-------------|--------------------------------------|
| id                          | UUID        | Primary key                          |
| game_id                     | UUID        | Game foreign key                     |
| draw_number                 | BIGINT      | Public sequence within game          |
| status                      | ENUM        | Draw lifecycle                       |
| sales_opens_at              | TIMESTAMPTZ | Server-enforced opening              |
| sales_closes_at             | TIMESTAMPTZ | Server-enforced cutoff               |
| draw_at                     | TIMESTAMPTZ | Scheduled draw time                  |
| official_timezone           | VARCHAR     | Display context snapshot             |
| current_rule_version_id     | UUID        | Rule version for new purchases       |
| current_rules_snapshot      | JSONB       | Current effective draw configuration |
| opening_jackpot_toman       | BIGINT      | Opening jackpot for Six Chance       |
| final_jackpot_toman         | BIGINT      | Final approved pool                  |
| youtube_live_url            | TEXT        | Scheduled public YouTube Live URL    |
| published_at and settled_at | TIMESTAMPTZ | Lifecycle timestamps                 |

## draw_status_history

| **Field**                 | **Type**         | **Purpose**                                        |
|---------------------------|------------------|----------------------------------------------------|
| id                        | UUID             | Primary key                                        |
| draw_id                   | UUID             | Draw foreign key                                   |
| from_status and to_status | VARCHAR          | Recorded lifecycle transition                      |
| reason                    | TEXT             | Required for overrides and exceptional transitions |
| actor_type and actor_id   | VARCHAR and UUID | Admin, super admin, or system                      |
| override_id               | UUID             | Optional SUPER_ADMIN override reference            |
| created_at                | TIMESTAMPTZ      | Append-only event time                             |

## draw_evidence

| **Field**                        | **Type**    | **Purpose**                               |
|----------------------------------|-------------|-------------------------------------------|
| id                               | UUID        | Primary key                               |
| draw_id                          | UUID        | Draw foreign key                          |
| youtube_live_url                 | TEXT        | Scheduled live broadcast URL              |
| youtube_video_id                 | VARCHAR     | Stable YouTube identifier                 |
| scheduled_at started_at ended_at | TIMESTAMPTZ | Broadcast timing                          |
| archive_url                      | TEXT        | Archive of the same live stream           |
| evidence_hash                    | BYTEA       | Optional retained-evidence integrity hash |
| status                           | VARCHAR     | SCHEDULED, LIVE, ENDED, UNAVAILABLE       |

## admin_overrides

| **Field**                          | **Type**         | **Purpose**                                               |
|------------------------------------|------------------|-----------------------------------------------------------|
| id                                 | UUID             | Primary key                                               |
| admin_id                           | UUID             | SUPER_ADMIN actor                                         |
| entity_type and entity_id          | VARCHAR and UUID | Target business record                                    |
| action_type                        | VARCHAR          | Stable override action code                               |
| scope                              | ENUM             | NEW_PURCHASES, ENTIRE_DRAW, FUTURE_DRAWS, SPECIFIC_RECORD |
| reason                             | TEXT             | Mandatory explanation                                     |
| board_decision_reference           | TEXT             | Optional external decision reference                      |
| before_snapshot and after_snapshot | JSONB            | Versioned business values                                 |
| impact_snapshot                    | JSONB            | Affected tickets, claims, liability, and warnings         |
| confirmation_method                | VARCHAR          | Confirmation code method without the raw code             |
| effective_at and created_at        | TIMESTAMPTZ      | Application and audit timing                              |
| request_id                         | UUID             | Correlation and idempotency reference                     |

## orders

| **Field**                   | **Type**    | **Purpose**                                                     |
|-----------------------------|-------------|-----------------------------------------------------------------|
| id                          | UUID        | Primary key                                                     |
| order_number                | VARCHAR     | Unique public reference                                         |
| draw_id                     | UUID        | Exactly one draw                                                |
| purchaser_type              | ENUM        | USER or GUEST                                                   |
| purchaser_user_id           | UUID        | Required for USER                                               |
| guest_email                 | CITEXT      | Required under current guest assumption                         |
| status                      | ENUM        | DRAFT, PENDING_PAYMENT, CONFIRMED, EXPIRED, CANCELLED, REFUNDED |
| subtotal discount total     | BIGINT      | Integer toman values with nonnegative checks                    |
| idempotency_key             | UUID        | Unique client operation key                                     |
| expires_at and confirmed_at | TIMESTAMPTZ | Lifecycle timing                                                |

## tickets

| **Field**        | **Type** | **Purpose**                               |
|------------------|----------|-------------------------------------------|
| id               | UUID     | Primary key                               |
| public_code      | VARCHAR  | Unique random public code                 |
| order_id         | UUID     | Parent order                              |
| line_number      | INTEGER  | Unique within order                       |
| owner_user_id    | UUID     | Nullable until a guest ticket is attached |
| source           | ENUM     | PURCHASE or FREE_PRIZE                    |
| status           | ENUM     | Validity lifecycle                        |
| outcome_status   | ENUM     | PENDING, WINNER, NOT_WINNER, VOID         |
| unit_price_toman | BIGINT   | Price snapshot                            |
| rule_version_id  | UUID     | Rule version effective at purchase        |
| is_quick_pick    | BOOLEAN  | Selection source                          |

## results

| **Field**                           | **Type**    | **Purpose**                                               |
|-------------------------------------|-------------|-----------------------------------------------------------|
| id                                  | UUID        | Primary key                                               |
| draw_id                             | UUID        | Draw foreign key                                          |
| version_number                      | INTEGER     | Monotonic correction version                              |
| status                              | ENUM        | ENTERED through SUPERSEDED or VOID                        |
| is_public_current                   | BOOLEAN     | Partial unique per draw                                   |
| correction_reason                   | TEXT        | Required after version one                                |
| entered_by reviewed_by published_by | UUID        | Administrator references; the same SUPER_ADMIN is allowed |
| draw_evidence_id                    | UUID        | YouTube Live evidence reference                           |
| publication_reason                  | TEXT        | Mandatory publication or correction reason                |
| entered reviewed published times    | TIMESTAMPTZ | Lifecycle timestamps                                      |

## prize_calculation_runs

| **Field**              | **Type**    | **Purpose**                                                 |
|------------------------|-------------|-------------------------------------------------------------|
| id                     | UUID        | Primary key                                                 |
| draw_id and result_id  | UUID        | Calculation inputs                                          |
| rule_version_id        | UUID        | Effective settlement rules                                  |
| override_id            | UUID        | Optional SUPER_ADMIN override source                        |
| run_number             | INTEGER     | Monotonic within the result                                 |
| status                 | ENUM        | RUNNING, COMPLETED, APPROVED, PUBLISHED, SUPERSEDED, FAILED |
| calculation_hash       | BYTEA       | Deterministic input and output fingerprint                  |
| summary                | JSONB       | Winner counts, caps, jackpot effects, and total liability   |
| created_by approved_by | UUID        | Administrator references; same SUPER_ADMIN permitted        |
| created_at approved_at | TIMESTAMPTZ | Lifecycle timestamps                                        |

## prize_awards

| **Field**             | **Type**         | **Purpose**                                       |
|-----------------------|------------------|---------------------------------------------------|
| id                    | UUID             | Primary key                                       |
| result_id             | UUID             | Calculation source                                |
| ticket_id             | UUID             | Winning ticket                                    |
| tier_code             | VARCHAR          | Matched tier                                      |
| award_type            | ENUM             | CASH or FREE_TICKET                               |
| amount_toman          | BIGINT           | Cash amount when applicable                       |
| free_ticket_quantity  | INTEGER          | Free rows when applicable                         |
| calculation_details   | JSONB            | Cap, split, multiplier, and winner count evidence |
| status and is_current | ENUM and BOOLEAN | Entitlement lifecycle                             |
| claim_deadline_at     | TIMESTAMPTZ      | Snapshot of the deadline                          |
| supersedes_award_id   | UUID             | Correction lineage                                |

## claim_credentials

| **Field**                          | **Type**    | **Purpose**                    |
|------------------------------------|-------------|--------------------------------|
| id                                 | UUID        | Primary key                    |
| ticket_id                          | UUID        | Credential owner ticket        |
| token_digest                       | BYTEA       | Unique SHA-256 digest          |
| status                             | ENUM        | ACTIVE, USED, ROTATED, REVOKED |
| replaces_credential_id             | UUID        | Rotation lineage               |
| created_reason                     | ENUM        | Initial or recovery reason     |
| created used rotated revoked times | TIMESTAMPTZ | Lifecycle timestamps           |
| revocation_reason                  | TEXT        | Reason when revoked            |

## prize_claims

| **Field**                              | **Type**    | **Purpose**                              |
|----------------------------------------|-------------|------------------------------------------|
| id                                     | UUID        | Primary key                              |
| claim_number                           | VARCHAR     | Unique public tracking number            |
| ticket_id                              | UUID        | Unique ticket claim anchor               |
| current_award_id                       | UUID        | Current entitlement after any correction |
| claimant_type                          | ENUM        | USER or GUEST                            |
| claimant_user_id                       | UUID        | Registered claimant                      |
| claim_credential_id                    | UUID        | Guest credential consumed                |
| contact_email_snapshot                 | CITEXT      | Claim contact snapshot                   |
| submission_method                      | ENUM        | ACCOUNT, CLAIM_TOKEN, ADMIN_ASSISTED     |
| status                                 | ENUM        | Claim lifecycle                          |
| decision_reason                        | TEXT        | Required for decisions                   |
| submitted reviewed approved paid times | TIMESTAMPTZ | Lifecycle timestamps                     |

## prize_claim_award_links

| **Field**   | **Type**    | **Purpose**                        |
|-------------|-------------|------------------------------------|
| claim_id    | UUID        | Claim foreign key                  |
| award_id    | UUID        | Award version foreign key          |
| link_reason | VARCHAR     | INITIAL_CLAIM or RESULT_CORRECTION |
| linked_at   | TIMESTAMPTZ | Append-only link time              |
| linked_by   | UUID        | Administrator or system actor      |

## audit_logs

| **Field**                       | **Type**         | **Purpose**                                 |
|---------------------------------|------------------|---------------------------------------------|
| id                              | UUID             | Primary key                                 |
| actor_type and actor_id         | ENUM and UUID    | User, guest, admin, super admin, or system  |
| action                          | VARCHAR          | Stable event code                           |
| entity_type and entity_id       | VARCHAR and UUID | Affected record                             |
| changed_fields                  | TEXT array       | Changed field names                         |
| old_values and new_values       | JSONB            | Redacted before and after data              |
| reason                          | TEXT             | Required for sensitive actions              |
| request_id                      | UUID             | Correlation identifier                      |
| ip user_agent evidence severity | Mixed            | Security and investigation context          |
| created_at                      | TIMESTAMPTZ      | No updated_at because entries are immutable |

## notifications

| **Field**                     | **Type** | **Purpose**                                                 |
|-------------------------------|----------|-------------------------------------------------------------|
| id                            | UUID     | Primary key                                                 |
| event_type                    | VARCHAR  | Business event                                              |
| recipient fields              | Mixed    | User, guest email, or admin                                 |
| channel                       | ENUM     | EMAIL or IN_APP initially                                   |
| template key version language | Mixed    | Rendering identity                                          |
| rendered subject body         | TEXT     | Sanitized snapshot that can never contain a raw Claim Token |
| payload                       | JSONB    | Safe template variables only                                |
| status                        | ENUM     | QUEUED through DELIVERED or FAILED                          |
| idempotency_key               | VARCHAR  | Unique event recipient channel key                          |
| attempt and provider fields   | Mixed    | Retry and delivery evidence                                 |

## outbox_events

| **Field**                       | **Type**         | **Purpose**                                     |
|---------------------------------|------------------|-------------------------------------------------|
| id                              | UUID             | Primary key                                     |
| event_type                      | VARCHAR          | Stable post-commit event code                   |
| aggregate_type and aggregate_id | VARCHAR and UUID | Related business entity                         |
| payload                         | JSONB            | Safe variables only; raw Claim Tokens forbidden |
| idempotency_key                 | VARCHAR          | Unique processing key                           |
| status                          | VARCHAR          | PENDING, PROCESSING, PROCESSED, FAILED          |
| attempts and last_error         | Mixed            | Retry state                                     |
| created_at processed_at         | TIMESTAMPTZ      | Lifecycle timestamps                            |

## sessions

| **Field**                 | **Type**    | **Purpose**                             |
|---------------------------|-------------|-----------------------------------------|
| id                        | UUID        | Primary key                             |
| principal_type            | ENUM        | USER or ADMIN                           |
| user_id or admin_id       | UUID        | Exactly one must be present             |
| token_digest              | BYTEA       | Unique digest of opaque session token   |
| auth_version_at_issue     | INTEGER     | Global logout control                   |
| status                    | ENUM        | ACTIVE, EXPIRED, REVOKED                |
| IP user agent device hash | Mixed       | Security context                        |
| idle and absolute expiry  | TIMESTAMPTZ | Different policies for users and admins |

# Unique Constraints and Concurrency

Unique constraints are correctness controls, not merely validation conveniences. They prevent race conditions that application-level checks cannot reliably stop. PostgreSQL B-tree unique indexes also accelerate the exact lookups used for public ticket codes, claim tokens, draw numbers, and idempotency keys.

| **Constraint**                                  | **Purpose**                                             |
|-------------------------------------------------|---------------------------------------------------------|
| games code                                      | Stable game identity                                    |
| draws game_id and draw_number                   | No duplicate draw number within a game                  |
| orders idempotency_key                          | No duplicate order from client retry                    |
| tickets public_code                             | No duplicate public ticket code                         |
| tickets order_id and line_number                | No duplicate row within an order                        |
| results draw_id and version_number              | No duplicate result version                             |
| one public current result per draw              | Atomic result correction publication                    |
| prize_calculation_runs result_id and run_number | No duplicate preview or settlement run number           |
| prize_awards result_id and ticket_id            | No duplicate calculation for one version                |
| one current award per ticket                    | No conflicting active entitlement                       |
| claim_credentials token_digest                  | No token digest reuse                                   |
| one ACTIVE credential per ticket                | No simultaneous guest bearer credentials                |
| prize_claims ticket_id                          | One continuing claim per ticket across corrected awards |
| prize_claim_award_links claim_id and award_id   | No duplicate claim-to-award history link                |
| admin_overrides request_id                      | Idempotent sensitive override request                   |
| notifications idempotency_key                   | No duplicate event delivery                             |
| outbox_events idempotency_key                   | No duplicate post-commit business event                 |

# Critical Transactions

## Guest Claim Submission

1. Start a database transaction and lock the ticket, current prize award, and relevant Claim Token row in that order.

2. Confirm that the award is current, available, unexpired, and belongs to the ticket addressed by the token.

3. Insert the ticket-anchored prize claim and its initial award link. The unique ticket_id constraint is the final duplicate-request protection.

4. Change the Claim Token from ACTIVE to USED.

5. Append claim status history and audit events.

6. Insert safe outbox events without the raw token, then commit. Notification workers deliver post-commit messages.

## Initial Result Preview and Publication

1. Lock the draw and result draft, resolve the effective rule version and any applicable SUPER_ADMIN override, and start an idempotent calculation run.

2. Calculate every award deterministically and store the preview summary, winner counts, caps, jackpot effects, total liability, warnings, and calculation hash.

3. Show the preview to the authorized ADMIN or SUPER_ADMIN. Editing the input creates or updates a draft version and triggers a new calculation run.

4. For publication, require the SUPER_ADMIN confirmation code and mandatory reason. Never store the raw code.

5. Atomically mark the approved result as public current, activate the selected calculation run and its awards, update the draw status, append audit and override history, and insert safe outbox events.

## Corrected Result Publication

1. Lock the draw and current public result.

2. Validate the new result against the effective rules selected for the correction and show the complete impact preview.

3. Create or activate the new result version and clear the previous is_public_current flag atomically.

4. Mark old current prize awards as superseded and calculate new awards deterministically.

5. Repoint existing ticket-anchored claims to replacement awards through prize_claim_award_links. Move affected claims back to review without requiring another Claim Token.

6. Move paid affected awards to manual reconciliation rather than automatically reversing financial records.

7. Append audit events and enqueue private notifications for affected owners.

8. Commit the full state change as one transaction or use a resumable settlement job with an explicit consistency boundary if the ticket volume is too large.

## SUPER ADMIN Business Override

1. Lock the target entity and load the current business state.

2. Calculate an impact preview covering affected tickets, users, claims, awards, jackpot values, and total liability.

3. Require the SUPER_ADMIN confirmation code, reason, scope, effective time, and optional board decision reference.

4. Create the new rule, result, schedule, status, award, or configuration version and insert the append-only admin_overrides record with before, after, and impact snapshots.

5. Apply the selected scope: new purchases only, the entire current draw, future draws, or a specific record.

6. Recalculate dependent projections and awards when required, append audit records, insert safe outbox events, and commit atomically or through an idempotent resumable job.

# Operational and Security Controls

- Use rate limits by IP address, email, account, device signal, and endpoint risk.

- Require CAPTCHA only for suspicious guest or recovery activity rather than every purchase.

- Use database and API idempotency for order creation, result publication, prize calculation, and notification delivery.

- Do not allow direct backdated ticket insertion. Administrative adjustments require a separate audited workflow.

- Use Argon2id for passwords and SHA-256 only for high-entropy random bearer tokens and sessions.

- Store session tokens only as digests. Use Secure, HttpOnly, and appropriate SameSite cookies.

- Keep administrator sessions shorter than customer sessions. Increment auth_version to invalidate all sessions immediately.

- Prevent deactivation or demotion of the final active SUPER_ADMIN through a locked transaction.

- Separate application administrator access from database-owner and infrastructure access.

- Add monitoring for cap activation, unusual purchase volume, repeated Claim Token failures, result corrections, and reconciliation cases.

# Responsible Gaming

The current product concept includes age and terms acknowledgement, configurable purchase limits, temporary or permanent self-exclusion, purchase history, unusual-spending warnings, and guest email blocking. Guest purchases make enforcement weaker because a person can change identifiers. The platform may also need device, network, and future payment signals, subject to privacy law and proportionality.

# Public Pages and Privacy

- The games page shows price, jackpot or fixed prize, next draw, countdown, purchase action, and rules.

- Result pages show current result, evidence video, winners by tier, prize per row, total prize amount, next jackpot, ticket count, cutoff, and publication time, subject to configurable public-statistics settings.

- The ticket-check page accepts the public ticket code or QR and shows validity, game, draw, selection, price, confirmation state, outcome, prize, and result link.

- Public pages never expose a name, email address, wallet address, Claim Token, internal identifier, or correction history.

- Gross sales remain administrator-only by default.

# Deferred Payment Module Requirements

The payment module is not part of the current implementation stage. The existing design reserves clear integration points but does not yet define blockchain networks, confirmation thresholds, rate providers, wallet custody, payout transactions, refunds, fees, or reconciliation ledgers.

- Toman remains the accounting unit for ticket prices and prize entitlements.

- Future crypto settlement must store asset, network, quoted exchange rate, quote timestamp, crypto amount, fee policy, transaction hash, confirmation state, and finality status.

- The design must decide how to treat payments detected before cutoff but confirmed after cutoff.

- Payment and payout operations require their own idempotency, ledger, address-risk, and reconciliation controls.

- Private keys must never be stored in application tables or logs.

# Production Readiness Dependencies

| **Topic**                     | **Required decision or work**                                                                                                                    | **Timing**              |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| Legal operating model         | Finalize jurisdiction, licensing, tax, KYC, AML, sanctions, and age-verification requirements.                                                   | Before launch           |
| Prize reserve                 | Define how minimum jackpots and fixed prizes are funded, segregated, and proven payable.                                                         | Before launch           |
| Physical draw assurance       | Complete equipment, livestream failure, evidence retention, chain-of-custody, and observer procedures as required by the operating jurisdiction. | Before launch           |
| Late payment                  | Define crypto payments initiated before cutoff and finalized after cutoff.                                                                       | Before payment module   |
| Result correction privacy     | The public sees only the current result. Confirm required legal disclosures while preserving the approved product behavior where lawful.         | Before launch           |
| Guest email                   | Finalize email verification and recovery requirements for the bearer credential.                                                                 | Before launch           |
| Payout configuration          | Finalize the production Four Leaf cap, Six Chance lower-tier cap, rounding unit, and remainder destination. All remain configurable.             | Before launch           |
| Rule JSON validation          | Define the versioned JSON schema and service validation for every configurable rule value.                                                       | During database work    |
| Prize calculation scale       | Choose synchronous settlement thresholds and the resumable batch boundary for larger draws.                                                      | During backend work     |
| Data retention                | Define retention and pseudonymization rules for guest emails, IP addresses, device signals, support content, and identity records.               | Before launch           |
| Administrative authentication | Implement the separate high-risk confirmation code, reauthentication, and production MFA policy without adding a second-admin requirement.       | Before production admin |
| Disaster recovery             | Define backups, point-in-time recovery, restore tests, audit retention, and continuity targets.                                                  | Before launch           |

# Implementation Handoff Rules

The implementation agent must treat the following product decisions as authoritative. It may identify technical defects, but it must not silently replace these decisions with recommendations from the earlier independent review.

- Do not require two different administrators to enter, review, publish, or correct a result.

- Do not freeze business settings merely because sales have opened. Implement versioned SUPER_ADMIN overrides with impact preview, confirmation code, reason, scope, and audit history.

- Do not expose result correction history publicly. Public APIs return only the current result; authorized internal users retain the complete history.

- Do not store or queue a raw Claim Token anywhere. Generate it once, deliver it once, and retain only its SHA-256 digest.

- Use scheduled YouTube Live broadcasts as draw evidence. Do not treat a separately uploaded replacement video as the source draw.

- Keep payment and cryptocurrency modules outside the current coding stage.

- Implement PostgreSQL migrations, constraints, indexes, seeds, append-only histories, and database tests before API or frontend code.

# First Coding Deliverable

1. Present the complete proposed table list and ordered migration plan before writing application code.

2. Create ordered PostgreSQL migrations, with safe rollback migrations where practical.

3. Create seed data for Six Chance and Four Leaf using the current configurable defaults.

4. Add tests for unique constraints, partial unique indexes, claims across result corrections, token uniqueness, override history, and critical concurrency cases.

5. Provide a README that explains migration order, invariants, override behavior, and deferred modules.

# Appendix Key PostgreSQL Constraints

> UNIQUE (game_id, draw_number)  
> UNIQUE (order_id, line_number)  
> UNIQUE (result_id, ticket_id)  
> UNIQUE (ticket_id) -- prize_claims  
> UNIQUE (claim_id, award_id) -- prize_claim_award_links  
> UNIQUE (token_digest)  
> UNIQUE (request_id) -- admin_overrides  
> UNIQUE (idempotency_key) -- notifications and outbox events  
>   
> CREATE UNIQUE INDEX one_active_rule_version_per_game  
> ON game_rule_versions (game_id) WHERE status = 'ACTIVE';  
>   
> CREATE UNIQUE INDEX one_public_result_per_draw  
> ON results (draw_id) WHERE is_public_current = TRUE;  
>   
> CREATE UNIQUE INDEX one_current_award_per_ticket  
> ON prize_awards (ticket_id) WHERE is_current = TRUE;  
>   
> CREATE UNIQUE INDEX one_active_claim_token_per_ticket  
> ON claim_credentials (ticket_id) WHERE status = 'ACTIVE';  
>   
> CREATE UNIQUE INDEX one_active_assignment_per_role  
> ON admin_role_assignments (admin_id, role_id) WHERE revoked_at IS NULL;

# Appendix Implementation Sequence

1. Create PostgreSQL migrations with checks, foreign keys, partial unique indexes, histories, overrides, and append-only protections.

2. Seed the two games and their current configurable default rule versions.

3. Define API contracts and backend authorization for public, user, admin, and SUPER_ADMIN operations.

4. Implement draw scheduling, orders, tickets, purchase-time rule references, and test-only confirmation.

5. Implement calculation previews, result versions, prize calculation, caps, ticket-anchored claims, overrides, audit, and notifications.

6. Build public pages and the administration panel, then run mathematical, concurrency, security, recovery, and end-to-end tests.
