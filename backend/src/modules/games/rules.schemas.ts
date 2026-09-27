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

/** The single-time schedule of schema versions before slots (Six Chance 1–3, Four Leaf 1–2). */
export type LegacySchedule = z.infer<typeof scheduleSchema>;
/** @deprecated Use LegacySchedule or NormalizedSchedule. */
export type Schedule = LegacySchedule;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Slot schedules (Six Chance schema 4, Four Leaf schema 3): any number of independent draw
// times per game — e.g. Four Leaf daily at 14:00, 18:00 and 21:00. Each expected occurrence is
// identified by (game, slot_id, intended local date); slot_id must therefore stay stable
// across rule versions for the same recurring draw. The schedule NEVER creates draws: it only
// drives reminders and prefills the SUPER_ADMIN's manual Create Draw form.
export const scheduleSlotSchema = z.object({
  slot_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "slot_id: lowercase letters, digits, - or _ (max 40)"),
  enabled: z.boolean(),
  label: z.string().trim().max(60).nullable().optional(),
  // 0 = Sunday .. 6 = Saturday, evaluated in the slot's own timezone.
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  draw_time: z.string().regex(HH_MM, "draw_time must be 24h HH:MM"),
  timezone: z.string().min(1).refine(isValidTimeZone, "must be a valid IANA timezone"),
  sales_open_hours_before_draw: z.number().positive(),
  // Sales always close strictly before the draw.
  sales_close_minutes_before_draw: z.number().int().positive(),
});

export const slotScheduleExceptionSchema = scheduleExceptionSchema.extend({
  // Absent: the date is skipped for every slot.
  slot_id: z.string().optional(),
});

export const slotScheduleSchema = z
  .object({
    slots: z.array(scheduleSlotSchema).min(1),
    exceptions: z.array(slotScheduleExceptionSchema).default([]),
  })
  .superRefine((sch, ctx) => {
    const ids = new Set<string>();
    const times = new Set<string>();
    sch.slots.forEach((slot, i) => {
      if (ids.has(slot.slot_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", i, "slot_id"], message: "slot_id must be unique" });
      ids.add(slot.slot_id);
      if (new Set(slot.weekdays).size !== slot.weekdays.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", i, "weekdays"], message: "weekdays must not repeat" });
      }
      if (slot.sales_close_minutes_before_draw >= slot.sales_open_hours_before_draw * 60) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", i, "sales_close_minutes_before_draw"], message: "sales must open before they close" });
      }
      if (!slot.enabled) return;
      for (const d of slot.weekdays) {
        const key = `${slot.timezone}|${d}|${slot.draw_time}`;
        if (times.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", i, "draw_time"], message: "two enabled slots share the same day and time" });
        times.add(key);
      }
    });
    sch.exceptions.forEach((e, i) => {
      if (e.slot_id !== undefined && !ids.has(e.slot_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exceptions", i, "slot_id"], message: "unknown slot_id" });
      }
    });
  });

export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>;
export interface NormalizedSchedule {
  slots: ScheduleSlot[];
  exceptions: { date: string; action: "SKIP"; reason: string; slot_id?: string | undefined }[];
}

/** The slot id a legacy single-time schedule is read as — and upgraded to — so the occurrence
 * identity of its draws does not change when the game is moved to a slot schedule. */
export const DEFAULT_SLOT_ID = "default";

/**
 * Reads any stored schedule (legacy single-time or slot-based) as slots. A legacy schedule
 * becomes exactly one enabled slot with the same days, time, timezone and offsets, so its
 * behavior is unchanged. Returns null when the schedule is missing or invalid.
 */
export function normalizeSchedule(raw: unknown): NormalizedSchedule | null {
  const slots = slotScheduleSchema.safeParse(raw);
  if (slots.success) return slots.data;
  const legacy = scheduleSchema.safeParse(raw);
  if (!legacy.success) return null;
  const l = legacy.data;
  return {
    slots: [
      {
        slot_id: DEFAULT_SLOT_ID,
        enabled: true,
        label: null,
        weekdays: l.active_weekdays,
        draw_time: l.draw_time,
        timezone: l.timezone,
        sales_open_hours_before_draw: l.sales_open_hours_before_draw,
        sales_close_minutes_before_draw: l.sales_close_minutes_before_draw,
      },
    ],
    exceptions: l.exceptions,
  };
}

/** The game's official timezone as recorded on a draw: its first slot's timezone. */
export function scheduleTimezone(raw: unknown): string {
  return normalizeSchedule(raw)?.slots[0]?.timezone ?? "Asia/Tehran";
}

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

const sixChanceRulesV2Base = sixChanceRulesV1Schema.extend({
  schema_version: z.literal(2),
  selection: sixChanceRulesV1Schema.shape.selection.extend(sixChanceSystemPlayFields),
});

function refineSystemPlay(
  rules: { selection: z.infer<typeof sixChanceRulesV2Base>["selection"] },
  ctx: z.RefinementCtx,
) {
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
}

export const sixChanceRulesV2Schema = sixChanceRulesV2Base.superRefine(refineSystemPlay);

// schema_version 3 = v2 with every payout source made explicit (approved Phase 6 rules):
//   * an ordinary cash tier declares payout_mode FIXED_AMOUNT and amount_toman is THE payout;
//     multiplier, when present, is display information only and never read by calculation;
//   * claim_period_days: days after publication a prize can be claimed (default 90);
//   * remainder_destination: where the lower-tier cap's rounding remainder goes;
//   * minimum_jackpot_toman: the amount the jackpot resets to after a jackpot win;
//   * jackpot_contribution_bps: share of the remaining sales (after lower-tier cash prizes)
//     added to the next jackpot when nobody wins it (6000 = 60%).
// Older snapshots stay readable under their own schema_version: calculation treats their
// amount_toman as authoritative too, and uses the 90-day claim default when it is absent.
const sixChanceTierV3Schema = z.discriminatedUnion("prize_type", [
  z.object({ code: z.string().min(1), match: z.string().min(1), prize_type: z.literal("JACKPOT_POOL") }),
  z.object({
    code: z.string().min(1),
    match: z.string().min(1),
    prize_type: z.literal("CASH"),
    payout_mode: z.literal("FIXED_AMOUNT"),
    amount_toman: z.number().int().nonnegative(),
    multiplier: z.number().positive().optional(),
  }),
  z.object({
    code: z.string().min(1),
    match: z.string().min(1),
    prize_type: z.literal("FREE_TICKET"),
    quantity: z.number().int().positive(),
  }),
]);

export const sixChanceRulesV3Schema = sixChanceRulesV2Base
  .extend({
    schema_version: z.literal(3),
    tiers: z.array(sixChanceTierV3Schema).min(1),
    claim_period_days: z.number().int().positive(),
    remainder_destination: z.string().min(1),
  })
  .superRefine(refineSystemPlay);

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

// schema_version 2 = v1 + an explicit claim period (days after publication; default 90).
export const fourLeafRulesV2Schema = fourLeafRulesV1Schema.extend({
  schema_version: z.literal(2),
  claim_period_days: z.number().int().positive(),
});

// schema_version 4 (Six Chance) / 3 (Four Leaf) = the previous version with a slot schedule
// (several independent draw times per day, each with its own stable slot_id).
export const sixChanceRulesV4Schema = sixChanceRulesV2Base
  .extend({
    schema_version: z.literal(4),
    schedule: slotScheduleSchema,
    tiers: z.array(sixChanceTierV3Schema).min(1),
    claim_period_days: z.number().int().positive(),
    remainder_destination: z.string().min(1),
  })
  .superRefine(refineSystemPlay);

export const fourLeafRulesV3Schema = fourLeafRulesV2Schema.extend({
  schema_version: z.literal(3),
  schedule: slotScheduleSchema,
});

type AnyRulesSchema = z.ZodType<{ schema_version: number }>;

// Add a new schema_version key here when one is introduced — never replace or remove an
// existing entry, so previously stored rule versions stay validatable under the exact
// schema_version they were created with.
const SIX_CHANCE_VALIDATORS: Record<number, AnyRulesSchema> = {
  1: sixChanceRulesV1Schema,
  2: sixChanceRulesV2Schema,
  3: sixChanceRulesV3Schema,
  4: sixChanceRulesV4Schema,
};
const FOUR_LEAF_VALIDATORS: Record<number, AnyRulesSchema> = {
  1: fourLeafRulesV1Schema,
  2: fourLeafRulesV2Schema,
  3: fourLeafRulesV3Schema,
};

/** The schema_version every NEW rule version must use. Older versions stay registered so
 * stored rule versions and draw snapshots remain readable, but new rules must carry every
 * explicit field (claim period, payout mode) so no payout source is ever implied. */
export const CREATABLE_SCHEMA_VERSION: Record<"SIX_CHANCE" | "FOUR_LEAF", number> = { SIX_CHANCE: 4, FOUR_LEAF: 3 };

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
export type SixChanceRulesV3 = z.infer<typeof sixChanceRulesV3Schema>;
export type SixChanceRulesV4 = z.infer<typeof sixChanceRulesV4Schema>;
export type SixChanceRules = SixChanceRulesV1 | SixChanceRulesV2 | SixChanceRulesV3 | SixChanceRulesV4;
export type FourLeafRulesV1 = z.infer<typeof fourLeafRulesV1Schema>;
