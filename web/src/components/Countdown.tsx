"use client";

import { formatCountdown, useCountdown } from "@/lib/use-countdown";

export function Countdown({ targetIso, label }: { targetIso: string; label: string }) {
  const parts = useCountdown(targetIso);
  if (!parts) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={`font-mono text-xl font-bold tabular-nums ${parts.isPast ? "text-muted" : "text-brand"}`}
        dir="ltr"
      >
        {formatCountdown(parts)}
      </span>
    </div>
  );
}
