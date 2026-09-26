-- 0002_games_and_rule_versions.sql
-- Purpose: seed the two initial games and their current configurable-default rule versions,
-- per the spec's Game Rules section and the product owner's rounding-policy amendment.
-- Every numeric default here is exactly what the spec lists as "current default" / "current
-- proposed default" and remains changeable later through a versioned SUPER_ADMIN override —
-- nothing here is hardcoded application logic, only the initial data row.
-- Idempotent: safe to re-run.
--
-- No email is hardcoded or referenced here: the admin used for created_by/activated_by is
-- resolved dynamically as "any admin currently holding an active SUPER_ADMIN assignment",
-- decoupling this file from whatever email seeds/0001 was run with.

DO $$
DECLARE
  v_bootstrap_admin_id  UUID;
  v_six_chance_game_id  UUID;
  v_four_leaf_game_id   UUID;
  v_six_chance_rules    JSONB;
  v_four_leaf_rules     JSONB;
BEGIN
  SELECT aa.id INTO v_bootstrap_admin_id
  FROM admin_accounts aa
  JOIN admin_role_assignments ara ON ara.admin_id = aa.id AND ara.revoked_at IS NULL
  JOIN roles r ON r.id = ara.role_id AND r.code = 'SUPER_ADMIN'
  ORDER BY aa.created_at
  LIMIT 1;

  IF v_bootstrap_admin_id IS NULL THEN
    RAISE EXCEPTION 'Run seeds/0001_roles_and_bootstrap_admin.sql first';
  END IF;

  -- ------------------------------------------------------------------
  -- Games
  -- ------------------------------------------------------------------

  SELECT id INTO v_six_chance_game_id FROM games WHERE code = 'SIX_CHANCE';
  IF v_six_chance_game_id IS NULL THEN
    INSERT INTO games (code, game_type, slug, name_fa, name_en, status)
    VALUES ('SIX_CHANCE', 'SIX_CHANCE', 'six-chance', 'شانس شش', 'Six Chance', 'ACTIVE')
    RETURNING id INTO v_six_chance_game_id;
  END IF;

  SELECT id INTO v_four_leaf_game_id FROM games WHERE code = 'FOUR_LEAF';
  IF v_four_leaf_game_id IS NULL THEN
    INSERT INTO games (code, game_type, slug, name_fa, name_en, status)
    VALUES ('FOUR_LEAF', 'FOUR_LEAF', 'four-leaf', 'چهار برگ', 'Four Leaf', 'ACTIVE')
    RETURNING id INTO v_four_leaf_game_id;
  END IF;

  -- ------------------------------------------------------------------
  -- Six Chance default rule version
  -- ------------------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1 FROM game_rule_versions WHERE game_id = v_six_chance_game_id AND version_number = 1
  ) THEN
    v_six_chance_rules := jsonb_build_object(
      'schema_version', 1,
      -- Recurring schedule lives inside the versioned rule payload (Phase 4 amendment), not
      -- a separate schedule_templates table. Current default: Tuesday and Friday nights.
      'schedule', jsonb_build_object(
        'timezone', 'Asia/Tehran',
        'active_weekdays', jsonb_build_array(2, 5),
        'draw_time', '21:00',
        'sales_open_hours_before_draw', 72,
        'sales_close_minutes_before_draw', 30,
        'exceptions', jsonb_build_array()
      ),
      'selection', jsonb_build_object(
        'main_numbers', jsonb_build_object(
          'count', 6, 'min', 1, 'max', 33, 'distinct', true, 'order_matters', false
        ),
        'chance_symbol', jsonb_build_object('min', 1, 'max', 5)
      ),
      'ticket_price_toman', 300000,
      'tiers', jsonb_build_array(
        jsonb_build_object('code', 'MAIN6_CHANCE', 'match', '6_MAIN_PLUS_CHANCE', 'prize_type', 'JACKPOT_POOL'),
        jsonb_build_object('code', 'MAIN6', 'match', '6_MAIN', 'prize_type', 'CASH', 'multiplier', 50, 'amount_toman', 15000000),
        jsonb_build_object('code', 'MAIN5_CHANCE', 'match', '5_MAIN_PLUS_CHANCE', 'prize_type', 'CASH', 'multiplier', 10, 'amount_toman', 3000000),
        jsonb_build_object('code', 'MAIN5', 'match', '5_MAIN', 'prize_type', 'CASH', 'multiplier', 5, 'amount_toman', 1500000),
        jsonb_build_object('code', 'MAIN4_CHANCE', 'match', '4_MAIN_PLUS_CHANCE', 'prize_type', 'CASH', 'multiplier', 3, 'amount_toman', 900000),
        jsonb_build_object('code', 'MAIN4', 'match', '4_MAIN', 'prize_type', 'CASH', 'multiplier', 2, 'amount_toman', 600000),
        jsonb_build_object('code', 'MAIN3_CHANCE', 'match', '3_MAIN_PLUS_CHANCE', 'prize_type', 'FREE_TICKET', 'quantity', 1)
      ),
      'minimum_jackpot_toman', 100000000,
      'jackpot_contribution_bps', 6000,
      'jackpot_net_sales_basis', 'CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS',
      'jackpot_no_winner_rollover', true,
      'jackpot_max_toman', NULL,
      'lower_tier_payout_cap_toman', NULL,
      'lower_tier_cap_reduction_strategy', 'PROPORTIONAL_PRESERVE_TIER_ORDER'
    );

    INSERT INTO game_rule_versions (
      game_id, game_type, version_number, status, rules, rules_hash,
      change_reason, created_by, activated_by, activated_at
    ) VALUES (
      v_six_chance_game_id, 'SIX_CHANCE', 1, 'ACTIVE', v_six_chance_rules,
      digest(v_six_chance_rules::text, 'sha256'),
      'Initial seed of current configurable defaults per Bakhta spec v0.2.',
      v_bootstrap_admin_id, v_bootstrap_admin_id, now()
    );
  END IF;

  -- ------------------------------------------------------------------
  -- Four Leaf default rule version
  -- ------------------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1 FROM game_rule_versions WHERE game_id = v_four_leaf_game_id AND version_number = 1
  ) THEN
    v_four_leaf_rules := jsonb_build_object(
      'schema_version', 1,
      -- Daily draw, per the spec's "Four Leaf is a daily exact-match four-digit game."
      'schedule', jsonb_build_object(
        'timezone', 'Asia/Tehran',
        'active_weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
        'draw_time', '21:00',
        'sales_open_hours_before_draw', 24,
        'sales_close_minutes_before_draw', 30,
        'exceptions', jsonb_build_array()
      ),
      'selection', jsonb_build_object(
        'digits', 4, 'min', '0000', 'max', '9999',
        'order_matters', true, 'leading_zero_allowed', true, 'repeated_digits_allowed', true
      ),
      'ticket_price_toman', 50000,
      'fixed_prize_toman', 60000000,
      'total_payout_cap_toman', 300000000,
      'rollover', false,
      -- Amendment: Four Leaf rounding policy lives in the versioned rule payload, not only
      -- in a calculation run's summary. Current seed defaults per the product owner:
      'rounding_unit_toman', 1,
      'remainder_destination', 'PRIZE_RESERVE'
    );

    INSERT INTO game_rule_versions (
      game_id, game_type, version_number, status, rules, rules_hash,
      change_reason, created_by, activated_by, activated_at
    ) VALUES (
      v_four_leaf_game_id, 'FOUR_LEAF', 1, 'ACTIVE', v_four_leaf_rules,
      digest(v_four_leaf_rules::text, 'sha256'),
      'Initial seed of current configurable defaults per Bakhta spec v0.2.',
      v_bootstrap_admin_id, v_bootstrap_admin_id, now()
    );
  END IF;
END
$$;
