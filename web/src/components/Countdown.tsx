"use client";

import { formatClock, useCountdown } from "@/lib/use-countdown";

export function Countdown({ targetIso, label }: { targetIso: string; label: string }) {
  const parts = useCountdown(targetIso);
  if (!parts) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-muted">{label}</span>
      {parts.isPast ? (
        <span className="text-xl font-bold text-muted">به پایان رسید</span>
      ) : (
        // The day count is Persian text (RTL); only the hh:mm:ss clock is isolated as LTR so
        // the two never get reordered by the bidi algorithm.
        <span className="text-xl font-bold text-brand">
          {parts.days > 0 && <span>{parts.days.toLocaleString("fa-IR")} روز و </span>}
          <bdi dir="ltr" className="font-mono tabular-nums">
            {formatClock(parts)}
          </bdi>
        </span>
      )}
    </div>
  );
}
