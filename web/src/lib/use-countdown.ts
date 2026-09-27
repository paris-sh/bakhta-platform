"use client";

import { useEffect, useState } from "react";

export interface CountdownParts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
}

function computeParts(targetIso: string): CountdownParts {
  const totalMs = new Date(targetIso).getTime() - Date.now();
  const isPast = totalMs <= 0;
  const clamped = Math.max(totalMs, 0);
  const seconds = Math.floor(clamped / 1000) % 60;
  const minutes = Math.floor(clamped / (1000 * 60)) % 60;
  const hours = Math.floor(clamped / (1000 * 60 * 60)) % 24;
  const days = Math.floor(clamped / (1000 * 60 * 60 * 24));
  return { totalMs, days, hours, minutes, seconds, isPast };
}

/** Recomputes every second on the client only — the target instant itself always comes
 * from the server (draw.drawAt / draw.salesClosesAt), this hook never invents a time. */
export function useCountdown(targetIso: string | null | undefined): CountdownParts | null {
  const [parts, setParts] = useState<CountdownParts | null>(() =>
    targetIso ? computeParts(targetIso) : null,
  );

  useEffect(() => {
    const update = () => setParts(targetIso ? computeParts(targetIso) : null);
    Promise.resolve().then(update);
    if (!targetIso) return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  return parts;
}
