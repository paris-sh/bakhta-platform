"use client";

import { useId } from "react";
import {
  draftSelectionKey,
  validateFourLeafDraft,
  validateSixChanceDraft,
  type SelectionError,
} from "@/lib/selection";
import { digitsOnly } from "@/lib/format";
import { useI18n } from "@/lib/i18n/locale-context";
import type { Messages } from "@/lib/i18n/messages";
import type { FourLeafRules, SixChanceRules, TicketDraft } from "@/lib/types";
import { AlertIcon, SparkleIcon, TrashIcon } from "./icons";
import { ChanceSymbolPicker } from "./ChanceSymbol";
import { symbolsInRange } from "@/lib/chance-symbols";

interface Props {
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  rules: FourLeafRules | SixChanceRules;
  drafts: TicketDraft[];
  onChange: (drafts: TicketDraft[]) => void;
}

export function selectionErrorText(error: SelectionError, t: Messages): string {
  switch (error.kind) {
    case "fourLeafDigits":
      return t.validation.fourLeafDigits;
    case "sixCount":
      return t.validation.sixCount(error.count);
    case "sixRange":
      return t.validation.sixRange(error.min, error.max);
    case "sixDistinct":
      return t.validation.sixDistinct;
    case "symbolMissing":
      return t.validation.symbolMissing;
  }
}

function countDuplicates(drafts: TicketDraft[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    const key = draftSelectionKey(draft);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function TicketBuilder({ gameType, rules, drafts, onChange }: Props) {
  const duplicateCounts = countDuplicates(drafts);

  function updateDraft(index: number, next: TicketDraft) {
    onChange(drafts.map((d, i) => (i === index ? next : d)));
  }

  function removeDraft(index: number) {
    onChange(drafts.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft, index) => {
        const key = draftSelectionKey(draft);
        const isDuplicate = key !== null && (duplicateCounts.get(key) ?? 0) > 1;
        const error =
          gameType === "FOUR_LEAF"
            ? validateFourLeafDraft(draft as Extract<TicketDraft, { kind: "FOUR_LEAF" }>)
            : validateSixChanceDraft(
                draft as Extract<TicketDraft, { kind: "SIX_CHANCE" }>,
                rules as SixChanceRules,
              );

        return (
          <TicketRow
            key={draft.key}
            index={index}
            draft={draft}
            rules={rules}
            error={error}
            isDuplicate={isDuplicate}
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
    : draft.numbers.every((n) => n === null) && draft.symbol === null;
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

  return (
    <div
      className={`animate-fade-up flex flex-col gap-4 rounded-xl border bg-surface p-4 shadow-xs transition-colors duration-200 sm:p-5 ${
        showError ? "border-danger-border" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-bold text-foreground">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
          {t.play.rowLabel(index + 1)}
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
          numbers={draft.numbers}
          symbol={draft.symbol}
          rules={rules as SixChanceRules}
          onChange={(numbers, symbol) => onChange({ ...draft, numbers, symbol })}
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
  numbers,
  symbol,
  rules,
  onChange,
}: {
  numbers: (number | null)[];
  symbol: number | null;
  rules: SixChanceRules;
  onChange: (numbers: (number | null)[], symbol: number | null) => void;
}) {
  const { t, digits } = useI18n();
  const { min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;
  const symbolLabelId = useId();

  function setNumber(i: number, raw: string) {
    const d = digitsOnly(raw).slice(0, 2);
    const parsed = d === "" ? null : Number(d);
    onChange(
      numbers.map((n, idx) => (idx === i ? parsed : n)),
      symbol,
    );
  }

  const ball =
    "tabular aspect-square w-full max-w-12 rounded-full border text-center text-lg font-bold sm:h-13 sm:w-13 sm:max-w-none transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus:shadow-[var(--ring)]";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="field-label">{t.play.sixNumbersLabel(numbers.length, min, max)}</p>
        <div className="grid grid-cols-6 gap-1.5 sm:flex sm:gap-2">
          {numbers.map((n, i) => (
            <input
              key={i}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={n === null ? "" : digits(n)}
              onChange={(e) => setNumber(i, e.target.value)}
              className={`${ball} ${
                n === null
                  ? "border-border-strong bg-surface-muted text-foreground"
                  : "border-ocean-300 bg-ocean-50 text-ocean-700"
              } focus:border-ocean-500`}
              aria-label={t.play.numberAria(i + 1)}
            />
          ))}
        </div>
      </div>
      <div>
        <p id={symbolLabelId} className="field-label">
          {t.play.symbolLabel} <span className="font-normal text-muted">· {t.play.symbolHint}</span>
        </p>
        {/* Selecting a symbol stores its integer id (1–5) — the API representation. */}
        <ChanceSymbolPicker
          symbols={symbolsInRange(symbolRange.min, symbolRange.max)}
          value={symbol}
          onChange={(id) => onChange(numbers, id)}
          labelledBy={symbolLabelId}
        />
      </div>
    </div>
  );
}
