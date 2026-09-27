"use client";

import { useId, useRef, useState } from "react";
import {
  draftCombinationCount,
  overlappingDraftIndexes,
  validateFourLeafDraft,
  validateSixChanceDraft,
  type SelectionError,
} from "@/lib/selection";
import { binomial, sixChanceLimits, systemPlayEnabled } from "@/lib/six-chance";
import { digitsOnly } from "@/lib/format";
import { useI18n } from "@/lib/i18n/locale-context";
import type { Messages } from "@/lib/i18n/messages";
import type { FourLeafRules, SixChanceRules, TicketDraft } from "@/lib/types";
import { AlertIcon, InfoIcon, SparkleIcon, TrashIcon } from "./icons";
import { ChanceSymbolPicker } from "./ChanceSymbol";
import { symbolsInRange } from "@/lib/chance-symbols";

interface Props {
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  rules: FourLeafRules | SixChanceRules;
  drafts: TicketDraft[];
  onChange: (drafts: TicketDraft[]) => void;
}

type SixDraft = Extract<TicketDraft, { kind: "SIX_CHANCE" }>;

export function selectionErrorText(error: SelectionError, t: Messages): string {
  switch (error.kind) {
    case "fourLeafDigits":
      return t.validation.fourLeafDigits;
    case "sixTooFew":
      return t.validation.sixTooFew(error.required);
    case "sixTooMany":
      return t.validation.sixTooMany(error.max);
    case "symbolMissing":
      return t.validation.symbolMissing;
    case "symbolTooMany":
      return t.validation.symbolTooMany(error.max);
    case "lineTooLarge":
      return t.validation.lineTooLarge(error.count, error.max);
  }
}

export function TicketBuilder({ gameType, rules, drafts, onChange }: Props) {
  const overlapping = overlappingDraftIndexes(drafts);

  function updateDraft(index: number, next: TicketDraft) {
    onChange(drafts.map((d, i) => (i === index ? next : d)));
  }

  function removeDraft(index: number) {
    onChange(drafts.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft, index) => {
        const error =
          gameType === "FOUR_LEAF"
            ? validateFourLeafDraft(draft as Extract<TicketDraft, { kind: "FOUR_LEAF" }>)
            : validateSixChanceDraft(draft as SixDraft, rules as SixChanceRules);

        return (
          <TicketRow
            key={draft.key}
            index={index}
            draft={draft}
            rules={rules}
            error={error}
            isDuplicate={overlapping.has(index)}
            onChange={(next) => updateDraft(index, next)}
            onRemove={() => removeDraft(index)}
            canRemove={drafts.length > 1}
          />
        );
      })}
    </div>
  );
}

/** An untouched row hasn't been typed into yet — no point showing a validation error on
 * it; the checkout button stays disabled until every row is valid anyway. */
function isUntouched(draft: TicketDraft): boolean {
  return draft.kind === "FOUR_LEAF"
    ? draft.fourLeafNumber === ""
    : draft.numbers.length === 0 && draft.symbols.length === 0;
}

function TicketRow({
  index,
  draft,
  rules,
  error,
  isDuplicate,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  draft: TicketDraft;
  rules: FourLeafRules | SixChanceRules;
  error: SelectionError | null;
  isDuplicate: boolean;
  onChange: (draft: TicketDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useI18n();
  const quickPickId = useId();
  const errorId = useId();
  const showError = error !== null && !draft.isQuickPick && !isUntouched(draft);
  const combos = draftCombinationCount(draft, rules);
  const isSystem = draft.kind === "SIX_CHANCE" && !draft.isQuickPick && error === null && combos > 1;

  return (
    <div
      className={`animate-fade-up flex flex-col gap-4 rounded-xl border bg-surface p-4 shadow-xs transition-colors duration-200 sm:p-5 ${
        showError ? "border-danger-border" : isSystem ? "border-ocean-300" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-bold text-foreground">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
          {t.play.rowLabel(index + 1)}
          {isSystem && <span className="badge badge-brand">{t.play.systemBadge}</span>}
        </span>
        <div className="flex items-center gap-2">
          <label
            htmlFor={quickPickId}
            className={`flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors duration-200 ${
              draft.isQuickPick
                ? "border-gold-300 bg-gold-50 text-gold-700"
                : "border-border-strong bg-surface text-ink-soft hover:border-brand-300"
            }`}
          >
            <input
              id={quickPickId}
              type="checkbox"
              role="switch"
              checked={draft.isQuickPick}
              onChange={(e) => onChange({ ...draft, isQuickPick: e.target.checked })}
              className="sr-only"
            />
            <SparkleIcon className="h-4 w-4" />
            {t.play.quickPick}
          </label>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="btn btn-ghost btn-sm px-2 text-danger hover:text-danger"
              aria-label={t.play.removeRowAria(index + 1)}
            >
              <TrashIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.play.removeRow}</span>
            </button>
          )}
        </div>
      </div>

      {draft.isQuickPick && (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-gold-300 bg-gold-50/60 px-4 py-3 text-sm text-gold-700">
          <SparkleIcon className="h-4 w-4 shrink-0" />
          {t.play.quickPickHint}
        </p>
      )}

      {!draft.isQuickPick && draft.kind === "FOUR_LEAF" && (
        <FourLeafInput
          value={draft.fourLeafNumber}
          invalid={showError}
          describedBy={showError ? errorId : undefined}
          onChange={(fourLeafNumber) => onChange({ ...draft, fourLeafNumber })}
        />
      )}

      {!draft.isQuickPick && draft.kind === "SIX_CHANCE" && (
        <SixChanceInput
          draft={draft}
          rules={rules as SixChanceRules}
          valid={error === null}
          onChange={(numbers, symbols) => onChange({ ...draft, numbers, symbols })}
        />
      )}

      {showError && (
        <p id={errorId} className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {selectionErrorText(error, t)}
        </p>
      )}
      {isDuplicate && (
        <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
          {t.play.duplicateWarning}
        </p>
      )}
    </div>
  );
}

function FourLeafInput({
  value,
  invalid,
  describedBy,
  onChange,
}: {
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const { t, digits } = useI18n();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {t.play.fourLeafLabel}
      </label>
      {/* Stored as ASCII digits (what the API receives); shown in the active locale's digits.
          Persian or Latin input is normalized on every keystroke, leading zeroes kept. */}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={4}
        placeholder={digits("0000")}
        value={digits(value)}
        onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 4))}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-label={t.play.fourLeafAria}
        className="input digit-input tabular h-16 w-full max-w-[15rem] text-center text-3xl font-extrabold text-brand-800"
      />
    </div>
  );
}

function SixChanceInput({
  draft,
  rules,
  valid,
  onChange,
}: {
  draft: SixDraft;
  rules: SixChanceRules;
  valid: boolean;
  onChange: (numbers: number[], symbols: number[]) => void;
}) {
  const { t, digits } = useI18n();
  const { min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;
  const limits = sixChanceLimits(rules);
  const numbersLabelId = useId();
  const symbolLabelId = useId();

  const numberAtMax = draft.numbers.length >= limits.maxNumbersPerLine;

  function toggleNumber(n: number) {
    if (draft.numbers.includes(n)) {
      onChange(
        draft.numbers.filter((x) => x !== n),
        draft.symbols,
      );
    } else if (!numberAtMax) {
      onChange([...draft.numbers, n].sort((a, b) => a - b), draft.symbols);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p id={numbersLabelId} className="field-label mb-0">
            {t.play.numbersLabel(limits.requiredNumbers, limits.maxNumbersPerLine, min, max)}
          </p>
          <div className="flex items-center gap-2">
            <span className={`badge ${draft.numbers.length >= limits.requiredNumbers ? "badge-brand" : "badge-neutral"}`}>
              {t.play.selectedOf(draft.numbers.length, limits.maxNumbersPerLine)}
            </span>
            {draft.numbers.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm min-h-8 px-2 text-xs"
                onClick={() => onChange([], draft.symbols)}
              >
                {t.play.clearNumbers}
              </button>
            )}
          </div>
        </div>
        <NumberGrid
          min={min}
          max={max}
          selected={draft.numbers}
          locked={numberAtMax}
          labelledBy={numbersLabelId}
          onToggle={toggleNumber}
          numberLabel={(n) => digits(n)}
        />
      </div>

      <div>
        <p id={symbolLabelId} className="field-label">
          {t.play.symbolLabel}{" "}
          <span className="font-normal text-muted">· {t.play.symbolsHint(limits.maxSymbolsPerLine)}</span>
        </p>
        {/* Selecting symbols stores their integer ids (1–5) — the API representation. */}
        <ChanceSymbolPicker
          symbols={symbolsInRange(symbolRange.min, symbolRange.max)}
          values={draft.symbols}
          max={limits.maxSymbolsPerLine}
          onChange={(ids) => onChange(draft.numbers, ids)}
          labelledBy={symbolLabelId}
        />
      </div>

      <LineCalculation draft={draft} rules={rules} valid={valid} />
    </div>
  );
}

/** Live "numbers × symbols = chances" and price for one line. Display only — the server
 * recomputes both when the order is placed. */
function LineCalculation({ draft, rules, valid }: { draft: SixDraft; rules: SixChanceRules; valid: boolean }) {
  const { t, money } = useI18n();
  const limits = sixChanceLimits(rules);
  const complete = draft.numbers.length >= limits.requiredNumbers && draft.symbols.length > 0;

  if (!systemPlayEnabled(limits)) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <InfoIcon className="h-4 w-4 shrink-0" />
        {t.play.exactOnlyDraw}
      </p>
    );
  }

  if (!complete) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-background px-4 py-3 text-sm text-muted">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        {t.play.systemHint}
      </p>
    );
  }

  const combosPerSymbol = binomial(draft.numbers.length, limits.requiredNumbers);
  const total = combosPerSymbol * draft.symbols.length;
  const unit = rules.ticket_price_toman;

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        valid ? "border-ocean-300/60 bg-ocean-50" : "border-danger-border bg-danger-bg"
      }`}
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="tabular font-bold text-ocean-700">
          {t.play.calcLine(draft.numbers.length, draft.symbols.length, total)}
        </p>
        <p className="tabular mt-0.5 text-xs text-muted">
          {t.play.calcDetail(combosPerSymbol, draft.symbols.length)} · {t.play.pricePerChance} {money(unit)}
        </p>
      </div>
      <div className="shrink-0 sm:text-end">
        <p className="text-xs font-semibold text-muted">{t.play.lineTotal}</p>
        <p className="tabular text-lg font-extrabold text-foreground">{money(unit * total)}</p>
      </div>
    </div>
  );
}

/** 1–33 as toggleable balls. One roving tab stop: arrows move (mirrored in RTL), Up/Down
 * move a row, Home/End jump; Space/Enter toggles. Once the per-line maximum is reached,
 * unselected balls lock. */
function NumberGrid({
  min,
  max,
  selected,
  locked,
  labelledBy,
  onToggle,
  numberLabel,
}: {
  min: number;
  max: number;
  selected: number[];
  locked: boolean;
  labelledBy: string;
  onToggle: (n: number) => void;
  numberLabel: (n: number) => string;
}) {
  const { dir } = useI18n();
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  function columns(): number {
    const first = refs.current[0];
    if (!first) return 1;
    const top = first.offsetTop;
    let count = 0;
    for (const el of refs.current) {
      if (el && el.offsetTop === top) count += 1;
      else break;
    }
    return Math.max(count, 1);
  }

  function focusAt(index: number) {
    const clamped = Math.min(Math.max(index, 0), values.length - 1);
    setFocusIndex(clamped);
    refs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const moves: Record<string, number> = {
      [forward]: index + 1,
      [backward]: index - 1,
      ArrowDown: index + columns(),
      ArrowUp: index - columns(),
      Home: 0,
      End: values.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      focusAt(moves[e.key]);
    }
  }

  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-7 gap-1.5 sm:grid-cols-11 sm:gap-2">
      {values.map((n, i) => {
        const on = selected.includes(n);
        const disabled = locked && !on;
        return (
          <button
            key={n}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={on}
            aria-disabled={disabled || undefined}
            tabIndex={i === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(i)}
            onClick={() => onToggle(n)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`tabular aspect-square w-full rounded-full border text-base font-bold transition-[transform,background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 sm:text-lg ${
              on
                ? "scale-[1.03] border-ocean-700 bg-ocean-700 text-white shadow-md"
                : disabled
                  ? "cursor-not-allowed border-border bg-surface-muted text-muted opacity-45"
                  : "border-border-strong bg-surface text-foreground hover:-translate-y-0.5 hover:border-ocean-500 hover:bg-ocean-50 motion-reduce:hover:translate-y-0"
            }`}
          >
            {numberLabel(n)}
          </button>
        );
      })}
    </div>
  );
}
