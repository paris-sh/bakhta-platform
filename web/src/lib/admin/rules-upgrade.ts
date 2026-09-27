// New rule versions must use the creatable schema_version (backend CREATABLE_SCHEMA_VERSION):
// Four Leaf 3 and Six Chance 4, which make the claim period and the payout mode explicit and
// use a slot schedule (any number of draw times per day). When the settings form starts from
// an older ACTIVE version it is upgraded here, preserving every business value; the admin
// reviews the result in the form before saving.

type Rules = Record<string, unknown>;

export const CREATABLE_SCHEMA_VERSION = { FOUR_LEAF: 3, SIX_CHANCE: 4 } as const;
export const DEFAULT_CLAIM_PERIOD_DAYS = 90;
/** The id a legacy single-time schedule is read as (backend DEFAULT_SLOT_ID). */
export const DEFAULT_SLOT_ID = "default";

export interface ScheduleSlot {
  slot_id: string;
  enabled: boolean;
  label: string | null;
  weekdays: number[];
  draw_time: string;
  timezone: string;
  sales_open_hours_before_draw: number;
  sales_close_minutes_before_draw: number;
}

/** A schema-1 Six Chance game sold exact picks only; these limits keep exactly that. */
const EXACT_PICKS_ONLY = {
  required_numbers_per_combination: 6,
  maximum_selected_numbers_per_line: 6,
  maximum_selected_symbols_per_line: 1,
  maximum_combinations_per_line: 1,
  maximum_combinations_per_order: 1000,
};

/** A legacy single-time schedule becomes ONE enabled slot with identical behavior. */
export function upgradeSchedule(schedule: unknown): { slots: ScheduleSlot[]; exceptions: unknown[] } {
  const s = (schedule && typeof schedule === "object" ? schedule : {}) as Rules;
  if (Array.isArray(s.slots)) {
    // Stored data is validated by the backend, but never let a malformed entry crash the form.
    const slots = s.slots
      .filter((x): x is Rules => !!x && typeof x === "object")
      .map((x, i) => ({
        ...(x as unknown as ScheduleSlot),
        slot_id: typeof x.slot_id === "string" ? x.slot_id : `slot-${i + 1}`,
        enabled: x.enabled !== false,
        label: typeof x.label === "string" ? x.label : null,
        weekdays: Array.isArray(x.weekdays) ? (x.weekdays as unknown[]).filter((d): d is number => Number.isInteger(d)) : [],
        draw_time: typeof x.draw_time === "string" ? x.draw_time : "",
        timezone: typeof x.timezone === "string" ? x.timezone : "Asia/Tehran",
      }));
    return { slots, exceptions: Array.isArray(s.exceptions) ? s.exceptions : [] };
  }
  return {
    slots: [
      {
        slot_id: DEFAULT_SLOT_ID,
        enabled: true,
        label: null,
        weekdays: Array.isArray(s.active_weekdays) ? (s.active_weekdays as number[]) : [],
        draw_time: typeof s.draw_time === "string" ? s.draw_time : "21:00",
        timezone: typeof s.timezone === "string" ? s.timezone : "Asia/Tehran",
        sales_open_hours_before_draw: typeof s.sales_open_hours_before_draw === "number" ? s.sales_open_hours_before_draw : 24,
        sales_close_minutes_before_draw: typeof s.sales_close_minutes_before_draw === "number" ? s.sales_close_minutes_before_draw : 30,
      },
    ],
    exceptions: Array.isArray(s.exceptions) ? s.exceptions : [],
  };
}

/** A new, unique slot id (lowercase letters/digits) derived from a draw time. */
export function newSlotId(drawTime: string, taken: string[]): string {
  const base = `slot-${drawTime.replace(":", "")}`;
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

export function upgradeRulesForNewVersion(gameType: "FOUR_LEAF" | "SIX_CHANCE", rules: Rules): Rules {
  const claim = typeof rules.claim_period_days === "number" ? rules.claim_period_days : DEFAULT_CLAIM_PERIOD_DAYS;
  const schedule = upgradeSchedule(rules.schedule);
  if (gameType === "FOUR_LEAF") {
    return { ...rules, schema_version: CREATABLE_SCHEMA_VERSION.FOUR_LEAF, claim_period_days: claim, schedule };
  }
  const selection = (rules.selection ?? {}) as Rules;
  const tiers = Array.isArray(rules.tiers) ? (rules.tiers as Rules[]) : [];
  return {
    ...rules,
    schema_version: CREATABLE_SCHEMA_VERSION.SIX_CHANCE,
    schedule,
    selection: "maximum_selected_numbers_per_line" in selection ? selection : { ...selection, ...EXACT_PICKS_ONLY },
    // amount_toman is the payout; a legacy multiplier is dropped so there is one source only.
    tiers: tiers.map((t) => {
      if (t.prize_type !== "CASH") return t;
      const rest = { ...t };
      delete rest.multiplier;
      return { ...rest, payout_mode: "FIXED_AMOUNT" };
    }),
    claim_period_days: claim,
    remainder_destination: typeof rules.remainder_destination === "string" ? rules.remainder_destination : "PRIZE_RESERVE",
  };
}
