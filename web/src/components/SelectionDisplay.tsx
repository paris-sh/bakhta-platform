"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import type { TicketSelection } from "@/lib/types";
import { chanceSymbol } from "@/lib/chance-symbols";
import { ChanceSymbolBadge } from "./ChanceSymbol";

/** A ticket's numbers drawn as digit tiles (Four Leaf) or lottery balls (Six Chance). A
 * Four Leaf number is one number, so it always reads left-to-right; Six Chance balls are a
 * sequence and follow the reading direction (first ball at the start, symbol at the end). */
export function SelectionDisplay({ selection, size = "md" }: { selection: TicketSelection; size?: "sm" | "md" }) {
  const { t, locale, digits } = useI18n();
  const cell = size === "sm" ? "h-7 min-w-7 text-sm" : "h-9 min-w-9 text-base";

  if (selection.kind === "FOUR_LEAF") {
    return (
      <div className="flex items-center gap-1" dir="ltr" aria-label={`${t.selection.number}: ${selection.numberValue}`}>
        {selection.numberValue.split("").map((d, i) => (
          <span
            key={i}
            className={`tabular inline-flex items-center justify-center rounded-md border border-brand-100 bg-brand-50 px-1.5 font-bold text-brand-800 ${cell}`}
          >
            {digits(d)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      aria-label={`${t.selection.numbers}: ${new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(selection.numbers.map((n) => digits(n)))} — ${t.selection.symbol}: ${chanceSymbol(selection.symbol)?.label[locale] ?? t.status.unknown}`}
    >
      {selection.numbers.map((n, i) => (
        <span
          key={i}
          className={`tabular inline-flex items-center justify-center rounded-full border border-ocean-300/60 bg-ocean-50 px-1 font-bold text-ocean-700 ${cell}`}
        >
          {digits(n)}
        </span>
      ))}
      <span className="mx-0.5 h-5 w-px bg-border-strong" aria-hidden="true" />
      <ChanceSymbolBadge id={selection.symbol} size={size} />
    </div>
  );
}
