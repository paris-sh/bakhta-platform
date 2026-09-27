import { describe, expect, it } from "vitest";
import {
  fourLeafRulesV1Schema,
  fourLeafRulesV2Schema,
  fourLeafRulesV3Schema,
  sixChanceRulesV3Schema,
  sixChanceRulesV4Schema,
  resolveRulesValidator,
  sixChanceRulesV1Schema,
} from "../../src/modules/games/rules.schemas.js";

// These exact payloads are copy-pasted from the REAL seeded rows in seeds/0002 (verified by
// querying a real migrated + seeded database), not reconstructed from memory — the whole
// point is to catch drift between the schema and what actually gets seeded/produced.

const REAL_SEEDED_SIX_CHANCE_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    draw_time: "21:00",
    exceptions: [],
    active_weekdays: [2, 5],
    sales_open_hours_before_draw: 72,
    sales_close_minutes_before_draw: 30,
  },
  tiers: [
    { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
    { code: "MAIN6", match: "6_MAIN", multiplier: 50, prize_type: "CASH", amount_toman: 15000000 },
    {
      code: "MAIN5_CHANCE",
      match: "5_MAIN_PLUS_CHANCE",
      multiplier: 10,
      prize_type: "CASH",
      amount_toman: 3000000,
    },
    { code: "MAIN5", match: "5_MAIN", multiplier: 5, prize_type: "CASH", amount_toman: 1500000 },
    {
      code: "MAIN4_CHANCE",
      match: "4_MAIN_PLUS_CHANCE",
      multiplier: 3,
      prize_type: "CASH",
      amount_toman: 900000,
    },
    { code: "MAIN4", match: "4_MAIN", multiplier: 2, prize_type: "CASH", amount_toman: 600000 },
    { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", quantity: 1, prize_type: "FREE_TICKET" },
  ],
  selection: {
    main_numbers: { max: 33, min: 1, count: 6, distinct: true, order_matters: false },
    chance_symbol: { max: 5, min: 1 },
  },
  jackpot_max_toman: null,
  ticket_price_toman: 300000,
  minimum_jackpot_toman: 100000000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_contribution_bps: 6000,
  jackpot_no_winner_rollover: true,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
};

const REAL_SEEDED_FOUR_LEAF_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    draw_time: "21:00",
    exceptions: [],
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
    sales_open_hours_before_draw: 24,
    sales_close_minutes_before_draw: 30,
  },
  selection: {
    digits: 4,
    min: "0000",
    max: "9999",
    order_matters: true,
    leading_zero_allowed: true,
    repeated_digits_allowed: true,
  },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
};

describe("rules schemas against the real seeded payloads", () => {
  it("accepts the real seeded SIX_CHANCE rules", () => {
    const result = sixChanceRulesV1Schema.safeParse(REAL_SEEDED_SIX_CHANCE_RULES);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it("accepts the real seeded FOUR_LEAF rules", () => {
    const result = fourLeafRulesV1Schema.safeParse(REAL_SEEDED_FOUR_LEAF_RULES);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it("rejects a SIX_CHANCE tier with an unknown prize_type", () => {
    const bad = {
      ...REAL_SEEDED_SIX_CHANCE_RULES,
      tiers: [{ code: "X", match: "Y", prize_type: "BOGUS" }],
    };
    expect(sixChanceRulesV1Schema.safeParse(bad).success).toBe(false);
  });

  it("rejects FOUR_LEAF rules missing the rounding policy keys", () => {
    const { rounding_unit_toman: _r, remainder_destination: _d, ...bad } = REAL_SEEDED_FOUR_LEAF_RULES;
    expect(fourLeafRulesV1Schema.safeParse(bad).success).toBe(false);
  });

  it("resolves by BOTH game_type and schema_version — an unsupported version resolves to nothing", () => {
    expect(resolveRulesValidator("FOUR_LEAF", 1)).toBe(fourLeafRulesV1Schema);
    expect(resolveRulesValidator("SIX_CHANCE", 1)).toBe(sixChanceRulesV1Schema);
    expect(resolveRulesValidator("FOUR_LEAF", 2)).toBe(fourLeafRulesV2Schema);
    expect(resolveRulesValidator("SIX_CHANCE", 3)).toBe(sixChanceRulesV3Schema);
    expect(resolveRulesValidator("FOUR_LEAF", 3)).toBe(fourLeafRulesV3Schema);
    expect(resolveRulesValidator("SIX_CHANCE", 4)).toBe(sixChanceRulesV4Schema);
    expect(resolveRulesValidator("FOUR_LEAF", 4)).toBeUndefined();
    expect(resolveRulesValidator("SIX_CHANCE", 999)).toBeUndefined();
  });

  it("rejects a payload missing schema_version entirely", () => {
    const { schema_version: _sv, ...withoutVersion } = REAL_SEEDED_FOUR_LEAF_RULES;
    expect(fourLeafRulesV1Schema.safeParse(withoutVersion).success).toBe(false);
  });
});
