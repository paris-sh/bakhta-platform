import { z } from "zod";

// Implements the spec's "Rule JSON validation" Production Readiness Dependency: a versioned
// JSON schema and service validation for every configurable rule value. These schemas
// describe SHAPE and type constraints only — they never hardcode the current business
// defaults (price, prize amounts, caps) as fixed literals, since every one of those is
// explicitly configurable through a new rule version.
//
// Every payload carries its own `schema_version` (also enforced as present at the database
// layer — see migration 0036). Validation resolves by BOTH game_type and schema_version:
// each combination gets its own permanent entry in the registry below. When a future
// schema_version is introduced for a game_type, ADD a new entry — never edit or remove an
// existing one. A rule version created under schema_version 1 must remain readable and
// re-validatable under exactly the schema_version-1 rules forever, even after a v2 exists.

// The recurring schedule definition lives inside rules, per the product owner's Phase 4
// amendment — not a separate schedule_templates table. It is versioned exactly like every
// other rule value: a later rule version's schedule change never rewrites an
// already-created draw's own current_rules_snapshot (see draws.service.ts).
export const scheduleExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  action: z.literal("SKIP"),
  reason: z.string().min(1),
});

export const scheduleSchema = z.object({
  timezone: z.string().min(1),
  // 0 = Sunday .. 6 = Saturday, matching JS Date#getDay() in that timezone.
  active_weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  draw_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "draw_time must be 24h HH:MM"),
  sales_open_hours_before_draw: z.number().positive(),
  sales_close_minutes_before_draw: z.number().int().nonnegative(),
  exceptions: z.array(scheduleExceptionSchema).default([]),
});

export type Schedule = z.infer<typeof scheduleSchema>;

const sixChanceTierSchema = z.discriminatedUnion("prize_type", [
  z.object({
    code: z.string().min(1),
    match: z.string().min(1),
    prize_type: z.literal("JACKPOT_POOL"),
  }),
  z.object({
    code: z.string().min(1),
    match: z.string().min(1),
    prize_type: z.literal("CASH"),
    multiplier: z.number().positive(),
    amount_toman: z.number().int().nonnegative(),
  }),
  z.object({
    code: z.string().min(1),
    match: z.string().min(1),
    prize_type: z.literal("FREE_TICKET"),
    quantity: z.number().int().positive(),
  }),
]);

export const sixChanceRulesV1Schema = z.object({
  schema_version: z.literal(1),
  schedule: scheduleSchema,
  selection: z.object({
    main_numbers: z.object({
      count: z.literal(6),
      min: z.literal(1),
      max: z.literal(33),
      distinct: z.literal(true),
      order_matters: z.literal(false),
    }),
    chance_symbol: z.object({ min: z.literal(1), max: z.literal(5) }),
  }),
  ticket_price_toman: z.number().int().positive(),
  tiers: z.array(sixChanceTierSchema).min(1),
  minimum_jackpot_toman: z.number().int().nonnegative(),
  jackpot_contribution_bps: z.number().int().min(0).max(10000),
  jackpot_net_sales_basis: z.string().min(1),
  jackpot_no_winner_rollover: z.boolean(),
  jackpot_max_toman: z.number().int().positive().nullable(),
  lower_tier_payout_cap_toman: z.number().int().positive().nullable(),
  lower_tier_cap_reduction_strategy: z.string().min(1),
});

// schema_version 2 = v1 + Six Chance SYSTEM PLAY limits (inside `selection`). A system line
// selects a pool of numbers and symbols and covers C(numbers, 6) × symbols combinations; each
// combination is priced at ticket_price_toman. A v1 snapshot has none of these fields and
// therefore allows exact picks only (6 numbers × 1 symbol) — see sixChanceLimits().
//
// Admin-panel reference (every field is editable per rule version via the existing
// /v1/admin/games/:id/rule-versions API):
//   required_numbers_per_combination   numbers in one combination; fixed at 6 (results and
//                                      exact-pick storage are six-number by construction)
//   maximum_selected_numbers_per_line  largest number pool on one line (6–33)
//   maximum_selected_symbols_per_line  largest symbol pool on one line (1–5)
//   maximum_combinations_per_line      cap on C(n,6)×symbols for one line
//   maximum_combinations_per_order     cap on the sum of combinations across an order
export const sixChanceSystemPlayFields = {
  required_numbers_per_combination: z.literal(6),
  maximum_selected_numbers_per_line: z.number().int().min(6).max(33),
  maximum_selected_symbols_per_line: z.number().int().min(1).max(5),
  maximum_combinations_per_line: z.number().int().positive(),
  maximum_combinations_per_order: z.number().int().positive(),
};

export const sixChanceRulesV2Schema = sixChanceRulesV1Schema
  .extend({
    schema_version: z.literal(2),
    selection: sixChanceRulesV1Schema.shape.selection.extend(sixChanceSystemPlayFields),
  })
  .superRefine((rules, ctx) => {
    const s = rules.selection;
    if (s.required_numbers_per_combination !== s.main_numbers.count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection", "required_numbers_per_combination"],
        message: "must equal selection.main_numbers.count",
      });
    }
    if (s.maximum_combinations_per_order < s.maximum_combinations_per_line) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection", "maximum_combinations_per_order"],
        message: "must be at least maximum_combinations_per_line",
      });
    }
  });

export const fourLeafRulesV1Schema = z.object({
  schema_version: z.literal(1),
  schedule: scheduleSchema,
  selection: z.object({
    digits: z.literal(4),
    min: z.string().regex(/^\d{4}$/),
    max: z.string().regex(/^\d{4}$/),
    order_matters: z.literal(true),
    leading_zero_allowed: z.literal(true),
    repeated_digits_allowed: z.literal(true),
  }),
  ticket_price_toman: z.number().int().positive(),
  fixed_prize_toman: z.number().int().positive(),
  total_payout_cap_toman: z.number().int().positive(),
  rollover: z.literal(false),
  // Mirrors the DB's own ck_game_rule_versions_four_leaf_rounding CHECK — enforced twice
  // deliberately (defense in depth), once here for a fast, well-formed 400 before the
  // insert, once at the database layer as the non-bypassable final guarantee.
  rounding_unit_toman: z.number().int().positive(),
  remainder_destination: z.string().min(1),
});

type AnyRulesSchema = z.ZodType<{ schema_version: number }>;

// Add a new schema_version key here when one is introduced — never replace or remove an
// existing entry, so previously stored rule versions stay validatable under the exact
// schema_version they were created with.
const SIX_CHANCE_VALIDATORS: Record<number, AnyRulesSchema> = {
  1: sixChanceRulesV1Schema,
  2: sixChanceRulesV2Schema,
};
const FOUR_LEAF_VALIDATORS: Record<number, AnyRulesSchema> = {
  1: fourLeafRulesV1Schema,
};

export type GameType = "SIX_CHANCE" | "FOUR_LEAF";

/** Resolves the validator for a (game_type, schema_version) pair, or undefined if that
 * combination is not (or no longer, or not yet) supported. */
export function resolveRulesValidator(
  gameType: GameType,
  schemaVersion: number,
): AnyRulesSchema | undefined {
  const registry = gameType === "SIX_CHANCE" ? SIX_CHANCE_VALIDATORS : FOUR_LEAF_VALIDATORS;
  return registry[schemaVersion];
}

export function supportedSchemaVersions(gameType: GameType): number[] {
  const registry = gameType === "SIX_CHANCE" ? SIX_CHANCE_VALIDATORS : FOUR_LEAF_VALIDATORS;
  return Object.keys(registry).map(Number).sort((a, b) => a - b);
}

export type SixChanceRulesV1 = z.infer<typeof sixChanceRulesV1Schema>;
export type SixChanceRulesV2 = z.infer<typeof sixChanceRulesV2Schema>;
/** Any supported Six Chance rules payload (as stored in a draw snapshot). */
export type SixChanceRules = SixChanceRulesV1 | SixChanceRulesV2;
export type FourLeafRulesV1 = z.infer<typeof fourLeafRulesV1Schema>;
