"use client";

import { useRef, useState } from "react";
import { chanceSymbol, type ChanceSymbol as ChanceSymbolT, type ChanceSymbolKey } from "@/lib/chance-symbols";
import { useI18n } from "@/lib/i18n/locale-context";
import { CheckIcon } from "./icons";

// One drawing per symbol on a 24px grid. Shared by the icon, the picker and the Six Chance
// background pattern so every appearance of a symbol is the same shape.
export function SymbolGlyph({ symbolKey, color }: { symbolKey: ChanceSymbolKey; color: string }) {
  switch (symbolKey) {
    case "sun":
      return (
        <g>
          <circle cx="12" cy="12" r="4.6" fill={color} />
          <g stroke={color} strokeWidth="1.9" strokeLinecap="round">
            <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.35 5.35l1.62 1.62M17.03 17.03l1.62 1.62M5.35 18.65l1.62-1.62M17.03 6.97l1.62-1.62" />
          </g>
        </g>
      );
    case "moon":
      return <path d="M19.6 14.9A8.1 8.1 0 0 1 9.1 4.4a8.1 8.1 0 1 0 10.5 10.5z" fill={color} />;
    case "star":
      return (
        <path
          d="M12 2.9l2.7 5.6 6.1.85-4.45 4.25 1.1 6.05L12 16.75l-5.45 2.9 1.1-6.05L3.2 9.35l6.1-.85z"
          fill={color}
          strokeLinejoin="round"
        />
      );
    case "diamond":
      return (
        <g>
          <path d="M7.2 4h9.6l4.2 5.2L12 20.4 3 9.2z" fill={color} />
          <path d="M3 9.2h18M9.8 4 8.2 9.2 12 20.4l3.8-11.2L14.2 4" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" strokeLinejoin="round" />
        </g>
      );
    case "crown":
      return (
        <g>
          <path d="M3.4 7.6l4.4 3.9L12 4.8l4.2 6.7 4.4-3.9-1.9 9.9H5.3z" fill={color} strokeLinejoin="round" />
          <rect x="5.2" y="18.6" width="13.6" height="2.2" rx="1.1" fill={color} />
        </g>
      );
  }
}

/** A symbol in its tinted round tile. */
export function ChanceSymbolIcon({ symbol, size = 28 }: { symbol: ChanceSymbolT; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-black/5"
      style={{ width: size, height: size, background: symbol.tint }}
      aria-hidden="true"
    >
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" focusable="false">
        <SymbolGlyph symbolKey={symbol.key} color={symbol.color} />
      </svg>
    </span>
  );
}

/** Stored integer → icon + localized name. Unknown values degrade to a neutral label
 * rather than a raw number. */
export function ChanceSymbolBadge({
  id,
  size = "md",
  showLabel = true,
}: {
  id: number;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const { t, locale } = useI18n();
  const symbol = chanceSymbol(id);
  const label = symbol ? symbol.label[locale] : t.status.unknown;
  const iconSize = size === "sm" ? 24 : 30;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-surface py-0.5 pe-2.5 ps-0.5 text-sm font-semibold"
      style={{ borderColor: symbol ? `${symbol.color}40` : undefined, color: symbol?.color }}
      title={`${t.selection.symbol}: ${label}`}
    >
      {symbol ? (
        <ChanceSymbolIcon symbol={symbol} size={iconSize} />
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-background-subtle text-xs text-muted">?</span>
      )}
      {showLabel ? <span className={size === "sm" ? "text-xs" : undefined}>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Chance-symbol picker. With `max` 1 it is a radio group (choose exactly one — arrow keys
 * move and select). With `max` > 1 it is a group of toggle buttons (system play — arrow keys
 * move focus, Space/Enter toggles; unselected options lock once `max` is reached). Either
 * way, arrows are mirrored in RTL, Home/End jump, and only one option is in the tab order.
 * Values are the symbols' integer ids (1–5) — the API representation. */
export function ChanceSymbolPicker({
  symbols,
  values,
  max,
  onChange,
  labelledBy,
  invalid,
}: {
  symbols: ChanceSymbolT[];
  values: number[];
  max: number;
  onChange: (ids: number[]) => void;
  labelledBy: string;
  invalid?: boolean;
}) {
  const { locale, dir } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const multi = max > 1;
  const firstSelected = symbols.findIndex((s) => values.includes(s.id));
  const [focusIndex, setFocusIndex] = useState(firstSelected >= 0 ? firstSelected : 0);
  const atMax = values.length >= max;

  function toggle(id: number) {
    if (!multi) {
      onChange([id]);
      return;
    }
    if (values.includes(id)) onChange(values.filter((v) => v !== id));
    else if (!atMax) onChange([...values, id].sort((a, b) => a - b));
  }

  function focusAt(index: number) {
    const next = (index + symbols.length) % symbols.length;
    setFocusIndex(next);
    refs.current[next]?.focus();
    if (!multi) onChange([symbols[next].id]);
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key === forward || e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(index + 1);
    } else if (e.key === backward || e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(symbols.length - 1);
    }
  }

  return (
    <div
      role={multi ? "group" : "radiogroup"}
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      className="grid grid-cols-5 gap-2 sm:flex sm:flex-wrap"
    >
      {symbols.map((s, i) => {
        const checked = values.includes(s.id);
        const locked = multi && atMax && !checked;
        return (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={multi ? undefined : "radio"}
            aria-checked={multi ? undefined : checked}
            aria-pressed={multi ? checked : undefined}
            aria-disabled={locked || undefined}
            tabIndex={i === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(i)}
            onClick={() => toggle(s.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`group/sym relative flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-lg border-2 px-1.5 py-2 text-xs font-semibold transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out-soft focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-[5.5rem] ${
              checked
                ? "shadow-md"
                : locked
                  ? "cursor-not-allowed border-border bg-surface text-muted opacity-45"
                  : "border-border bg-surface text-ink-soft hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md motion-reduce:hover:translate-y-0"
            }`}
            style={
              checked
                ? { borderColor: s.color, background: s.tint, color: s.color, outlineColor: s.color }
                : { outlineColor: s.color }
            }
          >
            <span className="transition-transform duration-200 group-hover/sym:scale-110 motion-reduce:transform-none">
              <ChanceSymbolIcon symbol={s} size={34} />
            </span>
            <span>{s.label[locale]}</span>
            {checked && (
              <span
                className="absolute -end-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm"
                style={{ background: s.color }}
                aria-hidden="true"
              >
                <CheckIcon className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
