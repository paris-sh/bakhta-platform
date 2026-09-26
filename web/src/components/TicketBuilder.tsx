"use client";

import { useId } from "react";
import { draftSelectionKey, validateFourLeafDraft, validateSixChanceDraft } from "@/lib/selection";
import type { FourLeafRules, SixChanceRules, TicketDraft } from "@/lib/types";

interface Props {
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  rules: FourLeafRules | SixChanceRules;
  drafts: TicketDraft[];
  onChange: (drafts: TicketDraft[]) => void;
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
  error: string | null;
  isDuplicate: boolean;
  onChange: (draft: TicketDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const quickPickId = useId();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-bold">ردیف {index + 1}</span>
        <div className="flex items-center gap-3">
          <label htmlFor={quickPickId} className="flex items-center gap-2 text-sm">
            <input
              id={quickPickId}
              type="checkbox"
              checked={draft.isQuickPick}
              onChange={(e) => onChange({ ...draft, isQuickPick: e.target.checked })}
              className="focus-ring h-4 w-4"
            />
            انتخاب خودکار (تصادفی)
          </label>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="focus-ring rounded-md px-2 py-1 text-sm text-danger hover:bg-danger-bg"
              aria-label={`حذف ردیف ${index + 1}`}
            >
              حذف
            </button>
          )}
        </div>
      </div>

      {!draft.isQuickPick && draft.kind === "FOUR_LEAF" && (
        <FourLeafInput
          value={draft.fourLeafNumber}
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

      {error && !draft.isQuickPick && <p className="text-sm text-danger">{error}</p>}
      {isDuplicate && (
        <p className="text-sm text-warning">
          این ترکیب در سفارش شما تکراری است. تکرار مجاز است، اما دو بلیط جداگانه محاسبه می‌شود.
        </p>
      )}
    </div>
  );
}

function FourLeafInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-muted">عدد چهار رقمی</label>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        maxLength={4}
        placeholder="0000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="focus-ring w-32 rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-widest"
        aria-label="عدد چهار رقمی چهار برگ"
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
  const { min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;

  function setNumber(i: number, raw: string) {
    const parsed = raw === "" ? null : Number(raw);
    const next = numbers.map((n, idx) => (idx === i ? parsed : n));
    onChange(next, symbol);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="mb-1 block text-sm text-muted">
          {numbers.length} عدد بین {min} تا {max}
        </label>
        <div className="flex flex-wrap gap-2" dir="ltr">
          {numbers.map((n, i) => (
            <input
              key={i}
              type="number"
              min={min}
              max={max}
              value={n ?? ""}
              onChange={(e) => setNumber(i, e.target.value)}
              className="focus-ring h-11 w-14 rounded-lg border border-border bg-background text-center font-mono"
              aria-label={`عدد شماره ${i + 1}`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm text-muted">
          نماد شانس ({symbolRange.min}-{symbolRange.max})
        </label>
        <input
          type="number"
          min={symbolRange.min}
          max={symbolRange.max}
          value={symbol ?? ""}
          onChange={(e) => onChange(numbers, e.target.value === "" ? null : Number(e.target.value))}
          dir="ltr"
          className="focus-ring h-11 w-14 rounded-lg border border-gold bg-warning-bg text-center font-mono"
          aria-label="نماد شانس"
        />
      </div>
    </div>
  );
}
