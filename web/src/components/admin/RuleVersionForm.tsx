"use client";

import { useId, useState } from "react";
import { useAdminI18n } from "@/lib/admin/i18n";
import type { AdminMessages } from "@/lib/i18n/admin-messages";
import { binomial } from "@/lib/six-chance";
import { newSlotId, upgradeSchedule, type ScheduleSlot } from "@/lib/admin/rules-upgrade";
import { AdminCard, Callout, Field, Pill, inputSm } from "./ui";

// Game-specific rule editor. Labelled fields for every configurable value the backend's
// rules.schemas.ts validates; values the schema fixes (selection shape, timezone, tiers,
// schedule exceptions) are shown read-only and passed through untouched. The server
// re-validates everything on save — these checks give earlier, clearer feedback.

type Rules = Record<string, unknown>;
type Errors = Record<string, string>;

const SYSTEM_DEFAULTS = {
  required_numbers_per_combination: 6,
  maximum_selected_numbers_per_line: 12,
  maximum_selected_symbols_per_line: 5,
  maximum_combinations_per_line: 5000,
  maximum_combinations_per_order: 25000,
};

function get(rules: Rules, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Rules)[key] : undefined), rules);
}

function set(rules: Rules, path: string, value: unknown): Rules {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) return { ...rules, [head]: value };
  return { ...rules, [head]: set(((rules[head] as Rules) ?? {}) as Rules, rest.join("."), value) };
}

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Mirrors the backend schema constraints for the editable fields. */
export function validateRules(gameType: string, rules: Rules, a: AdminMessages): Errors {
  const e: Errors = {};
  const h = a.rules.hints;
  const need = (path: string, min: number, max?: number) => {
    if (!isInt(get(rules, path), min, max)) e[path] = h.wholeNumber(min, max);
  };
  need("ticket_price_toman", 1);
  if (Array.isArray(get(rules, "schedule.slots"))) {
    validateSlots(rules, a, e);
  } else {
    const weekdays = get(rules, "schedule.active_weekdays");
    if (!Array.isArray(weekdays) || weekdays.length === 0) e["schedule.active_weekdays"] = h.weekdays;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(get(rules, "schedule.draw_time") ?? ""))) e["schedule.draw_time"] = h.drawTime;
    need("schedule.sales_open_hours_before_draw", 1);
    need("schedule.sales_close_minutes_before_draw", 0);
  }
  if (get(rules, "claim_period_days") !== undefined) need("claim_period_days", 1);

  if (gameType === "FOUR_LEAF") {
    need("fixed_prize_toman", 1);
    need("total_payout_cap_toman", 1);
    need("rounding_unit_toman", 1);
  } else {
    need("minimum_jackpot_toman", 0);
    need("jackpot_contribution_bps", 0, 10000);
    if (get(rules, "jackpot_max_toman") !== null) need("jackpot_max_toman", 1);
    if (get(rules, "lower_tier_payout_cap_toman") !== null) need("lower_tier_payout_cap_toman", 1);
    if (Number(get(rules, "schema_version")) >= 2) {
      need("selection.maximum_selected_numbers_per_line", 6, 33);
      need("selection.maximum_selected_symbols_per_line", 1, 5);
      need("selection.maximum_combinations_per_line", 1);
      need("selection.maximum_combinations_per_order", 1);
      const line = get(rules, "selection.maximum_combinations_per_line");
      const order = get(rules, "selection.maximum_combinations_per_order");
      if (isInt(line, 1) && isInt(order, 1) && (order as number) < (line as number)) {
        e["selection.maximum_combinations_per_order"] = h.orderBelowLine;
      }
    }
  }
  return e;
}

/** Whole-number input that keeps the typed text while editing and reports a number (or
 * NaN while the text isn't a number). */
function NumberInput({
  id,
  value,
  onValue,
  disabled,
  invalid,
}: {
  id: string;
  value: unknown;
  onValue: (n: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { num } = useAdminI18n();
  const external = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const [text, setText] = useState(external);
  const [synced, setSynced] = useState(external);
  if (external !== synced) {
    setSynced(external);
    setText(external);
  }
  return (
    <div>
      <input
        id={id}
        inputMode="numeric"
        dir="ltr"
        className={`${inputSm} tabular`}
        value={disabled && typeof value === "number" && Number.isFinite(value) ? num(value) : text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[,\s٬]/g, "");
          setText(raw);
          onValue(raw === "" ? Number.NaN : Number(raw));
        }}
      />
      {!disabled && typeof value === "number" && Number.isFinite(value) && value >= 1000 && (
        <span className="tabular mt-1 block text-[0.7rem] text-muted" aria-hidden="true">
          = {num(value)}
        </span>
      )}
    </div>
  );
}

export function RuleVersionForm({
  gameType,
  rules,
  onChange,
}: {
  gameType: string;
  rules: Rules;
  /** Omit for a read-only view. */
  onChange?: (rules: Rules) => void;
}) {
  const { a, money, num } = useAdminI18n();
  const uid = useId();
  const readOnly = !onChange;
  const errors = readOnly ? {} : validateRules(gameType, rules, a);
  const f = a.rules.fields;
  const h = a.rules.hints;
  const id = (p: string) => `${uid}-${p.replace(/\./g, "-")}`;
  const update = (path: string, value: unknown) => onChange?.(set(rules, path, value));

  const numberField = (path: string, label: string, extraHint?: string) => (
    <Field label={label} htmlFor={id(path)} error={errors[path]} hint={extraHint}>
      <NumberInput id={id(path)} value={get(rules, path)} onValue={(n) => update(path, n)} disabled={readOnly} invalid={!!errors[path]} />
    </Field>
  );

  const nullableField = (path: string, label: string) => {
    const value = get(rules, path);
    const isNull = value === null || value === undefined;
    return (
      <Field label={label} htmlFor={id(path)} error={errors[path]}>
        <div className="flex flex-col gap-1.5">
          <NumberInput id={id(path)} value={value} onValue={(n) => update(path, n)} disabled={readOnly || isNull} invalid={!!errors[path]} />
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={isNull}
              disabled={readOnly}
              onChange={(e) => update(path, e.target.checked ? null : 1)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            {f.noMax}
          </label>
        </div>
      </Field>
    );
  };

  const schemaVersion = Number(get(rules, "schema_version") ?? 1);
  const maxNumbers = Number(get(rules, "selection.maximum_selected_numbers_per_line"));
  const maxSymbols = Number(get(rules, "selection.maximum_selected_symbols_per_line"));
  const perLine = Number(get(rules, "selection.maximum_combinations_per_line"));
  const largest = isInt(maxNumbers, 6, 33) && isInt(maxSymbols, 1, 5) ? binomial(maxNumbers, 6) * maxSymbols : null;
  const bps = Number(get(rules, "jackpot_contribution_bps"));
  const tiers = (get(rules, "tiers") as { code: string; match: string; prize_type: string; amount_toman?: number; multiplier?: number; quantity?: number }[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard title={a.rules.sections.pricing}>
          <div className="grid gap-4 sm:grid-cols-2">{numberField("ticket_price_toman", f.ticketPrice)}</div>
        </AdminCard>

        {gameType === "FOUR_LEAF" ? (
          <AdminCard title={a.rules.sections.prize}>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField("fixed_prize_toman", f.fixedPrize)}
              {numberField("total_payout_cap_toman", f.payoutCap)}
            </div>
          </AdminCard>
        ) : (
          <AdminCard title={a.rules.sections.jackpot}>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField("minimum_jackpot_toman", f.minJackpot)}
              {numberField("jackpot_contribution_bps", f.contribution, Number.isFinite(bps) ? h.percent(bps) : undefined)}
              {nullableField("jackpot_max_toman", f.jackpotMax)}
              {nullableField("lower_tier_payout_cap_toman", f.lowerCap)}
              {get(rules, "remainder_destination") !== undefined && (
                <Field label={f.capRemainder} htmlFor={id("remainder_destination")}>
                  <select
                    id={id("remainder_destination")}
                    className={inputSm}
                    dir="ltr"
                    value={String(get(rules, "remainder_destination"))}
                    disabled={readOnly}
                    onChange={(e) => update("remainder_destination", e.target.value)}
                  >
                    {Array.from(new Set(["PRIZE_RESERVE", String(get(rules, "remainder_destination"))])).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(get(rules, "jackpot_no_winner_rollover"))}
                  disabled={readOnly}
                  onChange={(e) => update("jackpot_no_winner_rollover", e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                {f.rollover}
              </label>
            </div>
          </AdminCard>
        )}
      </div>

      <AdminCard title={a.rules.sections.claims}>
        <div className="grid gap-4 sm:grid-cols-2">
          {get(rules, "claim_period_days") !== undefined ? (
            numberField("claim_period_days", f.claimPeriod)
          ) : (
            <Field label={f.claimPeriod} hint={h.claimDefault}>
              <p className="input tabular flex min-h-10 items-center bg-surface-muted py-1.5 text-sm text-muted">{num(90)}</p>
            </Field>
          )}
        </div>
      </AdminCard>

      <ScheduleEditor rules={rules} readOnly={readOnly} errors={errors} onSchedule={(schedule) => update("schedule", schedule)} />

      {gameType === "FOUR_LEAF" && (
        <AdminCard title={a.rules.sections.rounding}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {numberField("rounding_unit_toman", f.roundingUnit)}
            <Field label={f.remainder} htmlFor={id("remainder_destination")}>
              <select
                id={id("remainder_destination")}
                className={inputSm}
                dir="ltr"
                value={String(get(rules, "remainder_destination") ?? "PRIZE_RESERVE")}
                disabled={readOnly}
                onChange={(e) => update("remainder_destination", e.target.value)}
              >
                {Array.from(new Set(["PRIZE_RESERVE", String(get(rules, "remainder_destination") ?? "PRIZE_RESERVE")])).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </AdminCard>
      )}

      {gameType === "SIX_CHANCE" && (
        <AdminCard title={a.rules.sections.system}>
          {schemaVersion < 2 ? (
            <div className="flex flex-col items-start gap-3">
              <Callout>{h.v1}</Callout>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    onChange?.({
                      ...rules,
                      schema_version: 2,
                      selection: { ...(rules.selection as Rules), ...SYSTEM_DEFAULTS },
                    })
                  }
                >
                  {h.enableSystem}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <Field label={f.required} hint={h.fixed}>
                  <p className="input tabular flex min-h-10 items-center bg-surface-muted py-1.5 text-sm text-muted" dir="ltr">
                    {String(get(rules, "selection.required_numbers_per_combination") ?? 6)}
                  </p>
                </Field>
                {numberField("selection.maximum_selected_numbers_per_line", f.maxNumbers)}
                {numberField("selection.maximum_selected_symbols_per_line", f.maxSymbols)}
                {numberField("selection.maximum_combinations_per_line", f.perLine)}
                {numberField("selection.maximum_combinations_per_order", f.perOrder)}
              </div>
              {largest !== null && (
                <div className="flex flex-col gap-2">
                  <Callout>{h.maxPossible(maxNumbers, maxSymbols, largest)}</Callout>
                  {isInt(perLine, 1) && perLine < largest && <Callout tone="warning">{h.capBelow(perLine, largest)}</Callout>}
                </div>
              )}
            </div>
          )}
        </AdminCard>
      )}

      {gameType === "SIX_CHANCE" && tiers.length > 0 && (
        <AdminCard title={a.rules.sections.tiers} bodyClassName="">
          <p className="border-b border-border px-4 py-2.5 text-xs text-muted">{h.fixedAmount}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierCode}</th>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierMatch}</th>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierPrize}</th>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierMultiple}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tiers.map((tier) => (
                  <tr key={tier.code}>
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                      {tier.code}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted" dir="ltr">
                      {tier.match}
                    </td>
                    <td className="px-4 py-2">
                      <Pill tone={tier.prize_type === "JACKPOT_POOL" ? "gold" : "neutral"}>{a.rules.prizeTypes[tier.prize_type] ?? tier.prize_type}</Pill>{" "}
                      {tier.amount_toman !== undefined && <span className="tabular text-xs text-ink-soft">{money(tier.amount_toman)}</span>}
                      {tier.quantity !== undefined && <span className="tabular text-xs text-ink-soft">× {num(tier.quantity)}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {tier.prize_type === "CASH" && tier.amount_toman !== undefined && Number(get(rules, "ticket_price_toman")) > 0
                        ? h.derivedMultiple(tier.amount_toman / Number(get(rules, "ticket_price_toman")))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- schedule slots

const TIMEZONES = ["Asia/Tehran", "Asia/Dubai", "Europe/Istanbul", "UTC"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Slot checks mirroring the backend's slotScheduleSchema. Keys: schedule.slots.<i>.<field>. */
function validateSlots(rules: Rules, a: AdminMessages, e: Errors) {
  const s = a.workflow.slots;
  const slots = (get(rules, "schedule.slots") as ScheduleSlot[] | undefined) ?? [];
  if (slots.length === 0) e["schedule.slots"] = s.atLeastOne;
  const seen = new Set<string>();
  slots.forEach((slot, i) => {
    const p = `schedule.slots.${i}`;
    if (!Array.isArray(slot.weekdays) || slot.weekdays.length === 0) e[`${p}.weekdays`] = a.rules.hints.weekdays;
    if (!HHMM.test(String(slot.draw_time ?? ""))) e[`${p}.draw_time`] = a.rules.hints.drawTime;
    const open = slot.sales_open_hours_before_draw;
    const close = slot.sales_close_minutes_before_draw;
    if (!(typeof open === "number" && Number.isFinite(open) && open > 0)) e[`${p}.sales_open_hours_before_draw`] = s.positive;
    if (!isInt(close, 1)) e[`${p}.sales_close_minutes_before_draw`] = a.rules.hints.wholeNumber(1);
    else if (typeof open === "number" && open > 0 && close >= open * 60) e[`${p}.sales_close_minutes_before_draw`] = s.windowInvalid;
    if (slot.enabled && Array.isArray(slot.weekdays)) {
      for (const d of slot.weekdays) {
        const key = `${slot.timezone}|${d}|${slot.draw_time}`;
        if (seen.has(key)) e[`${p}.draw_time`] = s.duplicateTime;
        seen.add(key);
      }
    }
  });
}

function ScheduleEditor({ rules, readOnly, errors, onSchedule }: { rules: Rules; readOnly: boolean; errors: Errors; onSchedule: (schedule: Rules) => void }) {
  const { a, num } = useAdminI18n();
  const uid = useId();
  const f = a.rules.fields;
  const s = a.workflow.slots;
  // Old snapshots store one draw time; they are shown (never edited) as their single slot.
  const schedule = upgradeSchedule(get(rules, "schedule"));
  const slots = schedule.slots;
  const setSlots = (next: ScheduleSlot[]) => onSchedule({ ...schedule, slots: next });
  const patch = (i: number, p: Partial<ScheduleSlot>) => setSlots(slots.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const err = (i: number, field: string) => errors[`schedule.slots.${i}.${field}`];

  return (
    <AdminCard
      title={a.rules.sections.schedule}
      action={
        !readOnly && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const last = slots[slots.length - 1];
              const drawTime = "12:00";
              setSlots([
                ...slots,
                {
                  slot_id: newSlotId(drawTime, slots.map((x) => x.slot_id)),
                  enabled: true,
                  label: null,
                  weekdays: last ? [...last.weekdays] : [0, 1, 2, 3, 4, 5, 6],
                  draw_time: drawTime,
                  timezone: last?.timezone ?? "Asia/Tehran",
                  sales_open_hours_before_draw: last?.sales_open_hours_before_draw ?? 24,
                  sales_close_minutes_before_draw: last?.sales_close_minutes_before_draw ?? 30,
                },
              ]);
            }}
          >
            + {s.add}
          </button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{s.hint}</p>
        {errors["schedule.slots"] && <p className="text-xs font-semibold text-danger">{errors["schedule.slots"]}</p>}
        {slots.length > 0 && slots.every((x) => !x.enabled) && <Callout tone="warning">{s.noneEnabled}</Callout>}
        {slots.map((slot, i) => {
          const pid = `${uid}-slot-${i}`;
          return (
            <fieldset key={slot.slot_id} className={`rounded-lg border p-3 ${slot.enabled ? "border-border" : "border-dashed border-border bg-surface-muted/60"}`}>
              <legend className="sr-only">{slot.label || s.unnamed(i + 1)}</legend>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={slot.enabled ? "success" : "neutral"}>{slot.enabled ? s.enabled : s.disabled}</Pill>
                <span className="font-semibold">
                  {slot.label || s.unnamed(i + 1)} · <span dir="ltr">{slot.draw_time}</span>
                </span>
                {!readOnly && (
                  <span className="ms-auto flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch(i, { enabled: !slot.enabled })}>
                      {slot.enabled ? s.disable : s.enable}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm text-danger" disabled={slots.length === 1} title={slots.length === 1 ? s.atLeastOne : undefined} onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                      {s.remove}
                    </button>
                  </span>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label={s.label} htmlFor={`${pid}-label`} hint={s.labelHint}>
                  <input id={`${pid}-label`} className={inputSm} value={slot.label ?? ""} maxLength={60} disabled={readOnly} onChange={(e) => patch(i, { label: e.target.value.trim() === "" ? null : e.target.value })} />
                </Field>
                <Field label={f.drawTime} htmlFor={`${pid}-time`} error={err(i, "draw_time")}>
                  <input id={`${pid}-time`} type="time" dir="ltr" className={inputSm} value={slot.draw_time} disabled={readOnly} onChange={(e) => patch(i, { draw_time: e.target.value })} />
                </Field>
                <Field label={f.timezone} htmlFor={`${pid}-tz`}>
                  <select id={`${pid}-tz`} dir="ltr" className={inputSm} value={slot.timezone} disabled={readOnly} onChange={(e) => patch(i, { timezone: e.target.value })}>
                    {Array.from(new Set([slot.timezone, ...TIMEZONES])).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={f.openHours} htmlFor={`${pid}-open`} error={err(i, "sales_open_hours_before_draw")}>
                  <NumberInput id={`${pid}-open`} value={slot.sales_open_hours_before_draw} onValue={(n) => patch(i, { sales_open_hours_before_draw: n })} disabled={readOnly} invalid={!!err(i, "sales_open_hours_before_draw")} />
                </Field>
                <Field label={f.closeMinutes} htmlFor={`${pid}-close`} error={err(i, "sales_close_minutes_before_draw")}>
                  <NumberInput id={`${pid}-close`} value={slot.sales_close_minutes_before_draw} onValue={(n) => patch(i, { sales_close_minutes_before_draw: n })} disabled={readOnly} invalid={!!err(i, "sales_close_minutes_before_draw")} />
                </Field>
                <Field label={f.weekdays} error={err(i, "weekdays")} className="sm:col-span-2 xl:col-span-3">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={f.weekdays}>
                    {a.weekdaysShort.map((dayLabel, d) => {
                      const on = slot.weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          disabled={readOnly}
                          onClick={() => patch(i, { weekdays: on ? slot.weekdays.filter((x) => x !== d) : [...slot.weekdays, d].sort((x, y) => x - y) })}
                          className={`min-h-9 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors ${
                            on ? "border-brand bg-brand text-brand-contrast" : "border-border-strong bg-surface text-ink-soft hover:border-brand-300"
                          } disabled:cursor-default`}
                        >
                          {dayLabel}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            </fieldset>
          );
        })}
        {schedule.exceptions.length > 0 && <p className="text-xs text-muted">{f.exceptions(schedule.exceptions.length)}</p>}
        <p className="text-[0.7rem] text-muted">{s.count(num(slots.filter((x) => x.enabled).length))}</p>
      </div>
    </AdminCard>
  );
}
