-- 0014_orders.up.sql
-- Purpose: one purchase for exactly one draw. Guest email is required for guest orders per
-- the product owner's current-default decision (amendment 5); this is enforced with a
-- discriminator CHECK and can be relaxed with a later migration if the product decision
-- changes, without touching any other table.

CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      VARCHAR NOT NULL,
  draw_id           UUID NOT NULL REFERENCES draws (id) ON DELETE RESTRICT,
  purchaser_type    purchaser_type_enum NOT NULL,
  purchaser_user_id UUID REFERENCES users (id) ON DELETE RESTRICT,
  guest_email       CITEXT,
  status            order_status_enum NOT NULL DEFAULT 'DRAFT',
  subtotal_toman    toman_amount NOT NULL,
  discount_toman    toman_amount NOT NULL DEFAULT 0,
  total_toman       toman_amount NOT NULL,
  idempotency_key   UUID NOT NULL,
  expires_at        TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_orders_order_number UNIQUE (order_number),
  CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT uq_orders_id_draw UNIQUE (id, draw_id),
  -- Amendment 5: guest email required for GUEST orders; purchaser_user_id required for
  -- USER orders; each purchaser_type forbids the other identity's field.
  CONSTRAINT ck_orders_purchaser_xor CHECK (
    (purchaser_type = 'USER'  AND purchaser_user_id IS NOT NULL AND guest_email IS NULL) OR
    (purchaser_type = 'GUEST' AND purchaser_user_id IS NULL AND guest_email IS NOT NULL)
  ),
  CONSTRAINT ck_orders_discount_le_subtotal CHECK (discount_toman <= subtotal_toman),
  CONSTRAINT ck_orders_total_matches CHECK (total_toman = subtotal_toman - discount_toman),
  CONSTRAINT ck_orders_confirmed_at_requires_status CHECK (
    confirmed_at IS NULL OR status IN ('CONFIRMED', 'REFUNDED')
  )
);

CREATE TRIGGER trg_orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_orders_draw ON orders (draw_id);
CREATE INDEX ix_orders_purchaser_user ON orders (purchaser_user_id) WHERE purchaser_user_id IS NOT NULL;
CREATE INDEX ix_orders_guest_email ON orders (guest_email) WHERE guest_email IS NOT NULL;

COMMENT ON TABLE orders IS 'One purchase for exactly one draw. A purchase spanning multiple draws is modeled as separate orders.';
COMMENT ON COLUMN orders.guest_email IS 'Required under the current guest-purchase default (Production Readiness Dependency: finalize verification/recovery requirements before launch).';
