"use client";

import { useId, useState } from "react";
import { useAdminI18n } from "@/lib/admin/i18n";
import type { AdminMessages } from "@/lib/i18n/admin-messages";
import { binomial } from "@/lib/six-chance";
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
  const weekdays = get(rules, "schedule.active_weekdays");
  if (!Array.isArray(weekdays) || weekdays.length === 0) e["schedule.active_weekdays"] = h.weekdays;
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(get(rules, "schedule.draw_time") ?? ""))) e["schedule.draw_time"] = h.drawTime;
  need("schedule.sales_open_hours_before_draw", 1);
  need("schedule.sales_close_minutes_before_draw", 0);

  if (gameType === "FOUR_LEAF") {
    need("fixed_prize_toman", 1);
    need("total_payout_cap_toman", 1);
    need("rounding_unit_toman", 1);
  } else {
    need("minimum_jackpot_toman", 0);
    need("jackpot_contribution_bps", 0, 10000);
    if (get(rules, "jackpot_max_toman") !== null) need("jackpot_max_toman", 1);
    if (get(rules, "lower_tier_payout_cap_toman") !== null) need("lower_tier_payout_cap_toman", 1);
    if (get(rules, "schema_version") === 2) {
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

  const weekdays = (get(rules, "schedule.active_weekdays") as number[] | undefined) ?? [];
  const schemaVersion = Number(get(rules, "schema_version") ?? 1);
  const maxNumbers = Number(get(rules, "selection.maximum_selected_numbers_per_line"));
  const maxSymbols = Number(get(rules, "selection.maximum_selected_symbols_per_line"));
  const perLine = Number(get(rules, "selection.maximum_combinations_per_line"));
  const largest = isInt(maxNumbers, 6, 33) && isInt(maxSymbols, 1, 5) ? binomial(maxNumbers, 6) * maxSymbols : null;
  const bps = Number(get(rules, "jackpot_contribution_bps"));
  const tiers = (get(rules, "tiers") as { code: string; match: string; prize_type: string; amount_toman?: number; multiplier?: number; quantity?: number }[] | undefined) ?? [];
  const exceptions = (get(rules, "schedule.exceptions") as unknown[] | undefined) ?? [];

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

      <AdminCard title={a.rules.sections.schedule}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label={f.weekdays} error={errors["schedule.active_weekdays"]} className="md:col-span-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={f.weekdays}>
              {a.weekdaysShort.map((label, d) => {
                const on = weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={readOnly}
                    onClick={() => update("schedule.active_weekdays", on ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort((x, y) => x - y))}
                    className={`min-h-9 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors ${
                      on ? "border-brand bg-brand text-brand-contrast" : "border-border-strong bg-surface text-ink-soft hover:border-brand-300"
                    } disabled:cursor-default`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={f.drawTime} htmlFor={id("schedule.draw_time")} error={errors["schedule.draw_time"]}>
            <input
              id={id("schedule.draw_time")}
              type="time"
              dir="ltr"
              className={inputSm}
              value={String(get(rules, "schedule.draw_time") ?? "")}
              disabled={readOnly}
              onChange={(e) => update("schedule.draw_time", e.target.value)}
            />
          </Field>
          <Field label={f.timezone}>
            <p className="input flex min-h-10 items-center bg-surface-muted py-1.5 text-sm text-muted" dir="ltr">
              {String(get(rules, "schedule.timezone") ?? "")}
            </p>
          </Field>
          {numberField("schedule.sales_open_hours_before_draw", f.openHours)}
          {numberField("schedule.sales_close_minutes_before_draw", f.closeMinutes)}
          {exceptions.length > 0 && <p className="self-end text-xs text-muted">{f.exceptions(exceptions.length)}</p>}
        </div>
      </AdminCard>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierCode}</th>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierMatch}</th>
                  <th className="px-4 py-2 text-start text-xs font-semibold text-muted">{f.tierPrize}</th>
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
