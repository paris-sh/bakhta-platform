-- 00_helpers.sql
-- Purpose: fixture-building helper functions shared by every other pgTAP file in this
-- directory. This file is run ONCE, committed (not wrapped in a test transaction), against a
-- disposable test database — never against production. Every other numbered file assumes
-- these functions already exist and wraps its own assertions in BEGIN ... ROLLBACK so the
-- fixtures it creates never persist.
--
-- Run order: psql -f 00_helpers.sql, then pg_prove 01_*.sql 02_*.sql ... (or pg_prove *.sql
-- with 00_helpers.sql excluded from the pg_prove glob, since it has no plan()/finish()).

CREATE SCHEMA IF NOT EXISTS test_helpers;

CREATE OR REPLACE FUNCTION test_helpers.make_admin(p_email TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_email TEXT := COALESCE(p_email, 'admin-' || gen_random_uuid()::text || '@test.local');
BEGIN
  INSERT INTO admin_accounts (admin_number, email)
  VALUES ('A-' || substr(gen_random_uuid()::text, 1, 8), v_email)
  RETURNING id INTO v_id;
  INSERT INTO admin_credentials (admin_id, password_hash) VALUES (v_id, 'TEST_HASH');
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_user(p_email TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_email TEXT := COALESCE(p_email, 'user-' || gen_random_uuid()::text || '@test.local');
BEGIN
  INSERT INTO users (user_number, email)
  VALUES ('U-' || substr(gen_random_uuid()::text, 1, 8), v_email)
  RETURNING id INTO v_id;
  INSERT INTO user_credentials (user_id, password_hash) VALUES (v_id, 'TEST_HASH');
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_game(p_game_type game_type_enum)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_code TEXT := p_game_type::text || '-' || substr(gen_random_uuid()::text, 1, 8);
BEGIN
  INSERT INTO games (code, game_type, slug, name_fa, name_en)
  VALUES (v_code, p_game_type, lower(v_code), v_code, v_code)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_rule_version(
  p_game_id UUID, p_game_type game_type_enum, p_admin_id UUID, p_rules JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_rules JSONB := COALESCE(
    p_rules,
    CASE WHEN p_game_type = 'FOUR_LEAF'
      THEN jsonb_build_object(
        'schema_version', 1, 'rounding_unit_toman', 1, 'remainder_destination', 'PRIZE_RESERVE'
      )
      ELSE jsonb_build_object('schema_version', 1)
    END
  );
BEGIN
  INSERT INTO game_rule_versions (
    game_id, game_type, version_number, status, rules, rules_hash,
    change_reason, created_by, activated_by, activated_at
  ) VALUES (
    p_game_id, p_game_type, 1, 'ACTIVE', v_rules, digest(v_rules::text, 'sha256'),
    'test fixture', p_admin_id, p_admin_id, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_draw(
  p_game_id UUID, p_game_type game_type_enum, p_rule_version_id UUID, p_draw_number BIGINT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO draws (
    game_id, game_type, draw_number, status,
    sales_opens_at, sales_closes_at, draw_at, official_timezone,
    current_rule_version_id, current_rules_snapshot
  ) VALUES (
    p_game_id, p_game_type,
    COALESCE(p_draw_number, (extract(epoch FROM clock_timestamp()) * 1000)::bigint),
    'SALES_CLOSED',
    -- sales_closes_at is deliberately in the FUTURE, not the past: migration 0035 added a
    -- trigger that rejects confirming a ticket once now() > sales_closes_at, and most
    -- fixtures need to insert CONFIRMED tickets against this draw. The `status` column
    -- (SALES_CLOSED) is intentionally independent of these timestamps, same as before —
    -- tests that specifically need an actually-past cutoff construct that explicitly.
    now() - interval '2 days', now() + interval '1 hour', now() + interval '2 hours', 'Asia/Tehran',
    p_rule_version_id, '{}'::jsonb
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_order(p_draw_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO orders (
    order_number, draw_id, purchaser_type, purchaser_user_id, guest_email,
    status, subtotal_toman, discount_toman, total_toman, idempotency_key, confirmed_at
  ) VALUES (
    'ORD-' || gen_random_uuid()::text, p_draw_id,
    (CASE WHEN p_user_id IS NULL THEN 'GUEST' ELSE 'USER' END)::purchaser_type_enum,
    p_user_id,
    CASE WHEN p_user_id IS NULL THEN 'guest-' || gen_random_uuid()::text || '@test.local' ELSE NULL END,
    'CONFIRMED', 100000, 0, 100000, gen_random_uuid(), now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_ticket(
  p_order_id UUID, p_draw_id UUID, p_game_type game_type_enum, p_rule_version_id UUID,
  p_line_number INTEGER DEFAULT 1
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tickets (
    public_code, order_id, draw_id, game_type, line_number,
    status, outcome_status, unit_price_toman, rule_version_id
  ) VALUES (
    'TKT-' || gen_random_uuid()::text, p_order_id, p_draw_id, p_game_type, p_line_number,
    'CONFIRMED', 'PENDING', 100000, p_rule_version_id
  ) RETURNING id INTO v_id;

  IF p_game_type = 'FOUR_LEAF' THEN
    INSERT INTO four_leaf_ticket_selections (ticket_id, number_value) VALUES (v_id, '1234');
  ELSE
    INSERT INTO six_chance_ticket_selections (ticket_id, n1, n2, n3, n4, n5, n6, symbol)
    VALUES (v_id, 1, 2, 3, 4, 5, 6, 1);
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_result(
  p_draw_id UUID, p_game_type game_type_enum, p_admin_id UUID, p_version INTEGER DEFAULT 1,
  p_status result_status_enum DEFAULT 'PUBLISHED', p_correction_reason TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_finalized BOOLEAN := p_status IN ('PUBLISHED', 'SUPERSEDED');
BEGIN
  INSERT INTO results (
    draw_id, game_type, version_number, status, is_public_current, correction_reason,
    entered_by, reviewed_by, published_by, publication_reason, reviewed_at, published_at
  ) VALUES (
    p_draw_id, p_game_type, p_version, p_status, (p_status = 'PUBLISHED'), p_correction_reason,
    p_admin_id, p_admin_id,
    CASE WHEN v_finalized THEN p_admin_id ELSE NULL END,
    CASE WHEN v_finalized THEN 'test publication' ELSE NULL END,
    CASE WHEN v_finalized THEN now() ELSE NULL END,
    CASE WHEN v_finalized THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;

  IF p_game_type = 'FOUR_LEAF' THEN
    INSERT INTO four_leaf_results (result_id, number_value) VALUES (v_id, '1234');
  ELSE
    INSERT INTO six_chance_results (
      result_id, draw_order_values,
      normalized_n1, normalized_n2, normalized_n3, normalized_n4, normalized_n5, normalized_n6,
      symbol
    ) VALUES (v_id, ARRAY[1,2,3,4,5,6]::smallint[], 1, 2, 3, 4, 5, 6, 1);
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_calculation_run(
  p_draw_id UUID, p_result_id UUID, p_rule_version_id UUID, p_admin_id UUID,
  p_run_number INTEGER DEFAULT 1, p_status calc_run_status_enum DEFAULT 'PUBLISHED'
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_approved BOOLEAN := p_status IN ('APPROVED', 'PUBLISHED');
BEGIN
  INSERT INTO prize_calculation_runs (
    draw_id, result_id, rule_version_id, run_number, status, calculation_hash,
    created_by, approved_by, approved_at
  ) VALUES (
    p_draw_id, p_result_id, p_rule_version_id, p_run_number, p_status, digest('test', 'sha256'),
    p_admin_id,
    CASE WHEN v_approved THEN p_admin_id ELSE NULL END,
    CASE WHEN v_approved THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION test_helpers.make_award(
  p_run_id UUID, p_result_id UUID, p_draw_id UUID, p_ticket_id UUID,
  p_tier_code TEXT DEFAULT 'MAIN4', p_amount BIGINT DEFAULT 600000, p_is_current BOOLEAN DEFAULT TRUE
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO prize_awards (
    calculation_run_id, result_id, draw_id, ticket_id, tier_code, award_type,
    amount_toman, is_current, claim_deadline_at
  ) VALUES (
    p_run_id, p_result_id, p_draw_id, p_ticket_id, p_tier_code, 'CASH',
    p_amount, p_is_current, now() + interval '90 days'
  ) RETURNING id INTO v_id;
  -- Migration 0038: every award is backed by components whose totals match it (checked by a
  -- deferred trigger at COMMIT, so fixtures that commit — the concurrency races — need one).
  INSERT INTO prize_award_components (award_id, tier_code, component_type, amount_toman, matched_combinations)
  VALUES (v_id, p_tier_code, 'CASH', p_amount, 1);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON SCHEMA test_helpers IS 'Test-only fixture builders. Never deploy this schema to production.';
