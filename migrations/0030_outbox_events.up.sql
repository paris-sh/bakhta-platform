-- 0030_outbox_events.up.sql
-- Purpose: post-commit event delivery. aggregate_type/aggregate_id is a DELIBERATE
-- polymorphic reference (accepted exception per the product owner's amendment) since an
-- outbox event can originate from any aggregate (order, result, claim, override, ...).

CREATE TABLE outbox_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      VARCHAR NOT NULL,
  aggregate_type  VARCHAR NOT NULL,
  aggregate_id    UUID NOT NULL,
  payload         JSONB NOT NULL,
  idempotency_key VARCHAR NOT NULL,
  status          outbox_status_enum NOT NULL DEFAULT 'PENDING',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  CONSTRAINT uq_outbox_events_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT ck_outbox_events_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT ck_outbox_events_no_raw_claim_token CHECK (
    NOT (payload ? 'raw_token') AND NOT (payload ? 'claim_token')
  )
);

CREATE INDEX ix_outbox_events_status ON outbox_events (status, created_at);
CREATE INDEX ix_outbox_events_aggregate ON outbox_events (aggregate_type, aggregate_id);

COMMENT ON TABLE outbox_events IS 'Post-commit event delivery. payload must never carry a raw Claim Token; the top-level-key CHECK is a defense-in-depth guard, not a substitute for careful payload construction (a raw token nested under another key would not be caught).';
