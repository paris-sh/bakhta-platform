import assert from "node:assert/strict";
import { test } from "node:test";
import { newSlotId, upgradeRulesForNewVersion, upgradeSchedule } from "./rules-upgrade.ts";

const SIX_V2 = {
  schema_version: 2,
  ticket_price_toman: 100000,
  selection: { main_numbers: { count: 6 }, maximum_selected_numbers_per_line: 12 },
  tiers: [
    { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
    { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", multiplier: 2, amount_toman: 600000 },
    { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", prize_type: "FREE_TICKET", quantity: 1 },
  ],
  minimum_jackpot_toman: 100000000,
};

test("a cloned Six Chance draft gets explicit fixed-amount payouts and a claim period, keeping values", () => {
  const up = upgradeRulesForNewVersion("SIX_CHANCE", SIX_V2);
  assert.equal(up.schema_version, 4);
  assert.equal(up.claim_period_days, 90);
  assert.equal(up.remainder_destination, "PRIZE_RESERVE");
  assert.deepEqual(up.tiers[1], { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", amount_toman: 600000, payout_mode: "FIXED_AMOUNT" });
  assert.deepEqual(up.tiers[0], SIX_V2.tiers[0]);
  assert.equal(up.ticket_price_toman, 100000);
  assert.equal(up.minimum_jackpot_toman, 100000000);
  assert.equal(SIX_V2.tiers[1].multiplier, 2, "the source rules are not mutated");
});

test("a schema-1 Six Chance draft stays exact-picks-only; an existing claim period is kept", () => {
  const up = upgradeRulesForNewVersion("SIX_CHANCE", { ...SIX_V2, schema_version: 1, selection: { main_numbers: {} }, claim_period_days: 45 });
  assert.equal(up.selection.maximum_selected_numbers_per_line, 6);
  assert.equal(up.selection.maximum_combinations_per_line, 1);
  assert.equal(up.claim_period_days, 45);
});

const LEGACY_SCHEDULE = { timezone: "Asia/Tehran", active_weekdays: [0, 1, 2, 3, 4, 5, 6], draw_time: "21:00", sales_open_hours_before_draw: 24, sales_close_minutes_before_draw: 30, exceptions: [] };

test("a Four Leaf version becomes schema 3 with the claim period and its schedule as one default slot", () => {
  assert.deepEqual(upgradeRulesForNewVersion("FOUR_LEAF", { schema_version: 1, fixed_prize_toman: 60000000, schedule: LEGACY_SCHEDULE }), {
    schema_version: 3,
    fixed_prize_toman: 60000000,
    claim_period_days: 90,
    schedule: {
      slots: [{ slot_id: "default", enabled: true, label: null, weekdays: [0, 1, 2, 3, 4, 5, 6], draw_time: "21:00", timezone: "Asia/Tehran", sales_open_hours_before_draw: 24, sales_close_minutes_before_draw: 30 }],
      exceptions: [],
    },
  });
});

test("a slot schedule is kept as is; new slot ids are unique", () => {
  const full = (id, t) => ({ slot_id: id, enabled: true, label: null, weekdays: [0, 1, 2, 3, 4, 5, 6], draw_time: t, timezone: "Asia/Tehran", sales_open_hours_before_draw: 24, sales_close_minutes_before_draw: 30 });
  const slots = { slots: [full("a", "14:00"), full("b", "18:00")], exceptions: [] };
  assert.deepEqual(upgradeSchedule(slots), slots);
  assert.equal(newSlotId("14:00", []), "slot-1400");
  assert.equal(newSlotId("14:00", ["slot-1400"]), "slot-1400-2");
});

test("malformed or missing schedules are read safely for the settings form", () => {
  assert.deepEqual(upgradeSchedule(undefined).slots.length, 1);
  const read = upgradeSchedule({ slots: [null, 7, { slot_id: "x", weekdays: "daily", draw_time: 9 }], exceptions: "none" });
  assert.equal(read.slots.length, 1);
  assert.deepEqual(read.slots[0].weekdays, []);
  assert.equal(read.slots[0].draw_time, "");
  assert.deepEqual(read.exceptions, []);
});
