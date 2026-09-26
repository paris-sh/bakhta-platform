-- 0002_enums_domains_and_helpers.up.sql
-- Purpose: create every enum type, reusable domain, and helper trigger function used by
-- later migrations. Enum/domain types must exist before any table references them.

-- =========================================================================
-- Domains (centralize the nonnegative / format invariants called out in the spec)
-- =========================================================================

CREATE DOMAIN toman_amount AS BIGINT CHECK (VALUE >= 0);
COMMENT ON DOMAIN toman_amount IS 'Nonnegative integer toman amount. Never floating point.';

CREATE DOMAIN nonneg_int AS INTEGER CHECK (VALUE >= 0);

CREATE DOMAIN basis_points AS INTEGER CHECK (VALUE BETWEEN 0 AND 10000);
COMMENT ON DOMAIN basis_points IS 'Integer basis points, 0-10000 (0%-100%).';

CREATE DOMAIN sha256_digest AS BYTEA CHECK (octet_length(VALUE) = 32);
COMMENT ON DOMAIN sha256_digest IS 'Fixed-length 32-byte SHA-256 digest storage.';

CREATE DOMAIN four_digit_code AS CHAR(4) CHECK (VALUE ~ '^[0-9]{4}$');
COMMENT ON DOMAIN four_digit_code IS 'Exactly four digit characters; preserves leading zero.';

-- =========================================================================
-- Enum types
-- =========================================================================

CREATE TYPE account_status_enum AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

CREATE TYPE permission_risk_enum AS ENUM ('STANDARD', 'SENSITIVE', 'CRITICAL');

CREATE TYPE session_principal_enum AS ENUM ('USER', 'ADMIN');
CREATE TYPE session_status_enum AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
CREATE TYPE auth_attempt_result_enum AS ENUM (
  'SUCCESS', 'FAILED_PASSWORD', 'FAILED_LOCKED', 'FAILED_UNKNOWN', 'RATE_LIMITED'
);

CREATE TYPE game_status_enum AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE game_type_enum AS ENUM ('SIX_CHANCE', 'FOUR_LEAF');
CREATE TYPE rule_version_status_enum AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TYPE draw_status_enum AS ENUM (
  'SALES_OPEN', 'SALES_CLOSED', 'DRAW_IN_PROGRESS', 'RESULT_ENTERED',
  'PENDING_REVIEW', 'PUBLISHED', 'SETTLED', 'CLOSED',
  'DELAYED', 'CANCELLED', 'VOID'
);
CREATE TYPE draw_evidence_status_enum AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'UNAVAILABLE');
CREATE TYPE override_scope_enum AS ENUM (
  'NEW_PURCHASES', 'ENTIRE_DRAW', 'FUTURE_DRAWS', 'SPECIFIC_RECORD'
);

-- Shared actor discriminator used by history/audit tables. Not every value applies to every
-- table; each table adds its own CHECK restricting the subset that is meaningful there.
CREATE TYPE actor_type_enum AS ENUM ('SYSTEM', 'USER', 'ADMIN', 'GUEST');

CREATE TYPE purchaser_type_enum AS ENUM ('USER', 'GUEST');
CREATE TYPE order_status_enum AS ENUM (
  'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'REFUNDED'
);

CREATE TYPE ticket_source_enum AS ENUM ('PURCHASE', 'FREE_PRIZE');
CREATE TYPE ticket_status_enum AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'VOID');
CREATE TYPE ticket_outcome_enum AS ENUM ('PENDING', 'WINNER', 'NOT_WINNER', 'VOID');

CREATE TYPE ownership_change_type_enum AS ENUM ('ATTACH', 'REASSIGN', 'DETACH');

CREATE TYPE credential_status_enum AS ENUM ('ACTIVE', 'USED', 'ROTATED', 'REVOKED');
CREATE TYPE credential_reason_enum AS ENUM ('INITIAL', 'RECOVERY');

CREATE TYPE result_status_enum AS ENUM ('ENTERED', 'PENDING_REVIEW', 'PUBLISHED', 'SUPERSEDED', 'VOID');

CREATE TYPE calc_run_status_enum AS ENUM (
  'RUNNING', 'COMPLETED', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'FAILED'
);

CREATE TYPE award_type_enum AS ENUM ('CASH', 'FREE_TICKET');
CREATE TYPE award_status_enum AS ENUM ('ACTIVE', 'SUPERSEDED', 'VOID');

CREATE TYPE claimant_type_enum AS ENUM ('USER', 'GUEST');
CREATE TYPE claim_submission_method_enum AS ENUM ('ACCOUNT', 'CLAIM_TOKEN', 'ADMIN_ASSISTED');
CREATE TYPE claim_status_enum AS ENUM (
  'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'READY_FOR_PAYMENT', 'PAYMENT_PENDING',
  'PAID', 'REJECTED', 'DISPUTED', 'FROZEN', 'EXPIRED', 'SUPERSEDED'
);
CREATE TYPE claim_award_link_reason_enum AS ENUM ('INITIAL_CLAIM', 'RESULT_CORRECTION');

CREATE TYPE requester_type_enum AS ENUM ('USER', 'GUEST');
CREATE TYPE support_category_enum AS ENUM (
  'MISSING_TICKET', 'LOST_CLAIM_TOKEN', 'RESULT_OR_PRIZE_DISPUTE', 'ACCOUNT_ATTACHMENT',
  'CLAIM_PROBLEM', 'ACCOUNT_PROBLEM', 'PAYMENT_PROBLEM'
);
CREATE TYPE support_status_enum AS ENUM (
  'OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'
);

CREATE TYPE recipient_type_enum AS ENUM ('USER', 'ADMIN', 'GUEST');
CREATE TYPE notification_channel_enum AS ENUM ('EMAIL', 'IN_APP');
CREATE TYPE notification_status_enum AS ENUM ('QUEUED', 'SENDING', 'DELIVERED', 'FAILED');

CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- =========================================================================
-- Helper functions
-- =========================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Generic BEFORE UPDATE trigger: stamps updated_at with the current transaction time.';

-- Generic append-only guard. Applied per-table in 0031_append_only_enforcement to the
-- six tables the spec designates as immutable history: audit_logs, admin_overrides,
-- draw_status_history, prize_claim_award_links, prize_claim_status_history,
-- ticket_ownership_history.
CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted (row id/key involved: %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reject_mutation() IS
  'Generic BEFORE UPDATE OR DELETE trigger that unconditionally rejects mutation of append-only tables.';
