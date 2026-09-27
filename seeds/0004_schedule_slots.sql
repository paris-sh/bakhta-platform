-- 0004_schedule_slots.sql
-- Purpose: move both games' CURRENT settings to the slot-schedule rule schema (Six Chance
-- schema_version 4, Four Leaf schema_version 3) as the next rule version, activated exactly
-- like the admin "Save changes" flow (the previous active version is retired, never edited).
--
-- Behavior is unchanged: the single legacy schedule becomes ONE enabled slot with the same
-- weekdays, draw time, timezone and sales offsets, under the stable slot_id 'default' (the
-- id the application also reads a legacy schedule as, so occurrence identity is continuous).
-- Other fields are made explicit exactly as the admin upgrade does: claim_period_days 90,
-- Six Chance cash tiers FIXED_AMOUNT (amount_toman is the payout; the display multiplier is
-- dropped) and remainder_destination PRIZE_RESERVE.
--
-- This seed never creates draws: the schedule only drives reminders; a SUPER_ADMIN creates
-- every draw manually. Idempotent: skipped per game once its active version uses slots.

DO $$
DECLARE
  v_admin_id  UUID;
  v_game      RECORD;
  v_rules     JSONB;
  v_sched     JSONB;
  v_target    INT;
BEGIN
  SELECT aa.id INTO v_admin_id
  FROM admin_accounts aa
  JOIN admin_role_assignments ara ON ara.admin_id = aa.id AND ara.revoked_at IS NULL
  JOIN roles r ON r.id = ara.role_id AND r.code = 'SUPER_ADMIN'
  ORDER BY aa.created_at
  LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Run seeds/0001_roles_and_bootstrap_admin.sql first';
  END IF;

  FOR v_game IN SELECT id, game_type FROM games WHERE code IN ('SIX_CHANCE', 'FOUR_LEAF') LOOP
    v_target := CASE v_game.game_type WHEN 'SIX_CHANCE' THEN 4 ELSE 3 END;

    SELECT rules INTO v_rules FROM game_rule_versions WHERE game_id = v_game.id AND status = 'ACTIVE';
    CONTINUE WHEN v_rules IS NULL OR (v_rules ->> 'schema_version')::int >= v_target;

    v_sched := v_rules -> 'schedule';
    IF NOT (v_sched ? 'slots') THEN
      v_sched := jsonb_build_object(
        'slots', jsonb_build_array(jsonb_build_object(
          'slot_id', 'default',
          'enabled', true,
          'label', NULL,
          'weekdays', v_sched -> 'active_weekdays',
          'draw_time', v_sched -> 'draw_time',
          'timezone', v_sched -> 'timezone',
          'sales_open_hours_before_draw', v_sched -> 'sales_open_hours_before_draw',
          'sales_close_minutes_before_draw', v_sched -> 'sales_close_minutes_before_draw'
        )),
        'exceptions', COALESCE(v_sched -> 'exceptions', '[]'::jsonb)
      );
    END IF;

    v_rules := v_rules
      || jsonb_build_object('schema_version', v_target, 'schedule', v_sched)
      || jsonb_build_object('claim_period_days', COALESCE((v_rules -> 'claim_period_days'), '90'::jsonb));

    IF v_game.game_type = 'SIX_CHANCE' THEN
      v_rules := v_rules
        -- A schema-1 game sold exact picks only; keep exactly that when limits are absent.
        || jsonb_build_object('selection',
             jsonb_build_object(
               'required_numbers_per_combination', 6,
               'maximum_selected_numbers_per_line', 6,
               'maximum_selected_symbols_per_line', 1,
               'maximum_combinations_per_line', 1,
               'maximum_combinations_per_order', 1000
             ) || (v_rules -> 'selection'))
        || jsonb_build_object('tiers', (
             SELECT jsonb_agg(
               CASE WHEN t ->> 'prize_type' = 'CASH'
                 THEN (t - 'multiplier') || jsonb_build_object('payout_mode', 'FIXED_AMOUNT')
                 ELSE t END
               ORDER BY ord)
             FROM jsonb_array_elements(v_rules -> 'tiers') WITH ORDINALITY AS e(t, ord)))
        || jsonb_build_object('remainder_destination', COALESCE(v_rules -> 'remainder_destination', '"PRIZE_RESERVE"'::jsonb));
    END IF;

    UPDATE game_rule_versions SET status = 'RETIRED', retired_at = now()
    WHERE game_id = v_game.id AND status = 'ACTIVE';

    INSERT INTO game_rule_versions (
      game_id, game_type, version_number, status, rules, rules_hash,
      change_reason, created_by, activated_by, activated_at
    ) VALUES (
      v_game.id, v_game.game_type,
      (SELECT max(version_number) + 1 FROM game_rule_versions WHERE game_id = v_game.id),
      'ACTIVE', v_rules, digest(v_rules::text, 'sha256'),
      'Schedule slots: the current schedule as one default slot (unchanged behavior); claim period and payout modes explicit.',
      v_admin_id, v_admin_id, now()
    );
  END LOOP;
END
$$;
