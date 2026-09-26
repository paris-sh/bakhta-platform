-- 0022_prize_awards.up.sql
-- Purpose: calculated ticket entitlement. Per the product owner's amendment:
--   * calculation_run_id is now mandatory and result_id must match the referenced run's own
--     result_id (composite FK), replacing the spec's original UNIQUE(result_id, ticket_id)
--     with UNIQUE(calculation_run_id, ticket_id) so several preview/calculation runs can
--     coexist for one result without collision.
--   * draw_id is denormalized and pinned to both the calculation run's draw and the
--     ticket's draw via composite foreign keys, enforcing "a prize award's ticket must
--     belong to the same draw as its result/calculation run" without a trigger.
--   * A non-winning ticket never receives a row here at all (see prize_claims / README);
--     only tickets with an entitlement get an award row.

CREATE TABLE prize_awards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_run_id   UUID NOT NULL REFERENCES prize_calculation_runs (id) ON DELETE RESTRICT,
  result_id            UUID NOT NULL,
  draw_id              UUID NOT NULL,
  ticket_id            UUID NOT NULL,
  tier_code            VARCHAR NOT NULL,
  award_type           award_type_enum NOT NULL,
  amount_toman         toman_amount,
  free_ticket_quantity nonneg_int,
  calculation_details  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               award_status_enum NOT NULL DEFAULT 'ACTIVE',
  is_current           BOOLEAN NOT NULL DEFAULT TRUE,
  claim_deadline_at    TIMESTAMPTZ NOT NULL,
  supersedes_award_id  UUID REFERENCES prize_awards (id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_prize_awards_run_ticket UNIQUE (calculation_run_id, ticket_id),
  CONSTRAINT uq_prize_awards_id_ticket UNIQUE (id, ticket_id),
  CONSTRAINT uq_prize_awards_id_draw UNIQUE (id, draw_id),
  -- result_id must be the calculation run's own result_id (prize_calculation_runs has
  -- UNIQUE(id, result_id) from 0021).
  CONSTRAINT fk_prize_awards_run_result
    FOREIGN KEY (calculation_run_id, result_id) REFERENCES prize_calculation_runs (id, result_id),
  -- draw_id must be the calculation run's own draw_id.
  CONSTRAINT fk_prize_awards_run_draw
    FOREIGN KEY (calculation_run_id, draw_id) REFERENCES prize_calculation_runs (id, draw_id),
  -- draw_id must also be the ticket's own draw_id (tickets has UNIQUE(id, draw_id) from
  -- 0015); combined with the FK above, this transitively forces ticket.draw_id =
  -- calculation_run.draw_id.
  CONSTRAINT fk_prize_awards_ticket_draw
    FOREIGN KEY (ticket_id, draw_id) REFERENCES tickets (id, draw_id),
  CONSTRAINT ck_prize_awards_type_shape CHECK (
    (award_type = 'CASH'        AND amount_toman IS NOT NULL AND free_ticket_quantity IS NULL) OR
    (award_type = 'FREE_TICKET' AND free_ticket_quantity IS NOT NULL AND amount_toman IS NULL)
  ),
  CONSTRAINT ck_prize_awards_free_ticket_positive CHECK (
    award_type <> 'FREE_TICKET' OR free_ticket_quantity >= 1
  )
);

-- Appendix Key PostgreSQL Constraints: one_current_award_per_ticket
CREATE UNIQUE INDEX one_current_award_per_ticket
  ON prize_awards (ticket_id) WHERE is_current = TRUE;

CREATE INDEX ix_prize_awards_calculation_run ON prize_awards (calculation_run_id);
CREATE INDEX ix_prize_awards_ticket ON prize_awards (ticket_id);
CREATE INDEX ix_prize_awards_result ON prize_awards (result_id);

COMMENT ON TABLE prize_awards IS 'Calculated entitlement for a winning ticket only; a NOT_WINNER ticket receives no row here. calculation_run_id identifies which run produced this award; only the selected PUBLISHED run''s awards may be is_current (enforced in 0034).';
