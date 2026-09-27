"use client";

import { useI18n } from "@/lib/i18n/locale-context";

type Kind = "order" | "ticket" | "outcome" | "draw";
type Tone = "success" | "warning" | "danger" | "neutral" | "gold" | "brand";

const TONE_BY_VALUE: Record<Kind, Record<string, Tone>> = {
  order: {
    CONFIRMED: "success",
    PENDING_PAYMENT: "warning",
    DRAFT: "neutral",
    EXPIRED: "neutral",
    CANCELLED: "danger",
    REFUNDED: "neutral",
  },
  ticket: { CONFIRMED: "success", PENDING: "warning", CANCELLED: "danger", REFUNDED: "neutral", VOID: "danger" },
  outcome: { PENDING: "brand", WINNER: "gold", NOT_WINNER: "neutral", VOID: "danger" },
  draw: { SALES_OPEN: "success", SALES_CLOSED: "neutral", DELAYED: "warning", CANCELLED: "danger", VOID: "danger" },
};

/** Localized status pill. Raw enum values are never rendered — unknown ones read "Unknown". */
export function StatusBadge({ kind, value }: { kind: Kind; value: string }) {
  const { t } = useI18n();
  const label = t.status[kind][value] ?? t.status.unknown;
  const tone = TONE_BY_VALUE[kind][value] ?? "neutral";
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
