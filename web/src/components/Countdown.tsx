"use client";

import { useCountdown } from "@/lib/use-countdown";
import { useI18n } from "@/lib/i18n/locale-context";

/** Labeled day/hour/minute/second tiles. `tone="dark"` sits on coloured headers. The
 * target instant always comes from the server; this only ticks the display. */
export function Countdown({
  targetIso,
  label,
  tone = "light",
  size = "md",
}: {
  targetIso: string;
  label?: string;
  tone?: "light" | "dark";
  size?: "sm" | "md";
}) {
  const { t, digits } = useI18n();
  const parts = useCountdown(targetIso);
  if (!parts) return null;

  const labelCls = tone === "dark" ? "text-white/70" : "text-muted";

  if (parts.isPast) {
    return (
      <div className="flex flex-col gap-1.5">
        {label && <span className={`text-xs font-semibold uppercase tracking-wide ${labelCls}`}>{label}</span>}
        <span className="badge badge-neutral self-start">{t.countdown.ended}</span>
      </div>
    );
  }

  const units = [
    { value: parts.days, label: t.countdown.days },
    { value: parts.hours, label: t.countdown.hours },
    { value: parts.minutes, label: t.countdown.minutes },
    { value: parts.seconds, label: t.countdown.seconds },
  ];

  const tile =
    tone === "dark"
      ? "border-white/15 bg-white/10 text-white backdrop-blur-sm"
      : "border-border bg-surface text-foreground shadow-xs";
  const dims = size === "sm" ? "min-w-[2.9rem] px-1.5 py-1.5" : "min-w-[3.6rem] px-2 py-2";
  const numCls = size === "sm" ? "text-lg" : "text-2xl";

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={`text-xs font-semibold tracking-wide ${labelCls}`}>{label}</span>}
      <div className="flex gap-1.5" role="timer" aria-live="off">
        {units.map((u) => (
          <div key={u.label} className={`flex flex-col items-center rounded-md border ${tile} ${dims}`}>
            <span className={`tabular font-bold leading-none ${numCls}`}>{digits(String(u.value).padStart(2, "0"))}</span>
            <span className={`mt-1 text-[0.65rem] font-medium leading-none ${tone === "dark" ? "text-white/70" : "text-muted"}`}>
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
