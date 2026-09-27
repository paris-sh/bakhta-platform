"use client";

import type { Locale } from "@/lib/i18n/messages";
import { useAdminI18n } from "@/lib/admin/i18n";
import type { AdminAuditItem, CustomerRef, DrawSalesState } from "@/lib/admin/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Pill, type Tone } from "./ui";

/** The catalog's own localized game name. */
export function gameLabel(g: { nameEn: string; nameFa: string }, locale: Locale): string {
  return locale === "fa" ? g.nameFa : g.nameEn;
}

/** Guest vs registered, with the only customer identifiers the admin API returns: a user
 * number for registered customers and a masked email. */
export function CustomerCell({ customer }: { customer: CustomerRef }) {
  const { a } = useAdminI18n();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span>
        <Pill tone={customer.kind === "USER" ? "brand" : "gold"}>{a.status.purchaser[customer.kind]}</Pill>
      </span>
      <span className="truncate text-xs text-muted" dir="ltr">
        {customer.userNumber ? `${customer.userNumber} · ` : ""}
        {customer.maskedEmail ?? a.common.none}
      </span>
    </div>
  );
}

export function AuditActor({ actor }: { actor: AdminAuditItem["actor"] }) {
  const { a } = useAdminI18n();
  if (actor.type === "ADMIN") return <span dir="ltr">{actor.adminEmail ?? actor.adminNumber ?? a.common.none}</span>;
  if (actor.type === "USER") return <span dir="ltr">{actor.userNumber ?? a.common.none}</span>;
  return <span>{a.audit.system}</span>;
}

const RULE_TONE: Record<string, Tone> = { ACTIVE: "success", DRAFT: "warning", RETIRED: "neutral" };

export function RuleStatusPill({ status }: { status: string }) {
  const { a } = useAdminI18n();
  return <Pill tone={RULE_TONE[status] ?? "neutral"}>{a.status.rule[status] ?? status}</Pill>;
}

const GAME_TONE: Record<string, Tone> = { ACTIVE: "success", PAUSED: "warning", ARCHIVED: "neutral" };

export function GameStatusPill({ status }: { status: string }) {
  const { a } = useAdminI18n();
  return <Pill tone={GAME_TONE[status] ?? "neutral"}>{a.status.game[status] ?? status}</Pill>;
}

/** A draw's availability right now, as the backend's sales-window rule reports it. A row
 * stored as SALES_OPEN is only "Sales open" inside its window; before that it is "Sales not
 * started". Later lifecycle statuses (drawing, results, settled, cancelled…) show verbatim. */
export function DrawAvailabilityPill({ status, salesState }: { status: string; salesState: DrawSalesState }) {
  const { a } = useAdminI18n();
  if (salesState === "NOT_ON_SALE") return <StatusBadge kind="draw" value={status} />;
  const tone: Tone = salesState === "OPEN" ? "success" : salesState === "UPCOMING" ? "ocean" : "neutral";
  return <Pill tone={tone}>{a.salesState[salesState]}</Pill>;
}
