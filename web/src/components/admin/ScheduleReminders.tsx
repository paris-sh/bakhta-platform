"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminGame, GameReminders, ScheduledOccurrence } from "@/lib/admin/types";
import { AdminCard, Pill, Skeleton, useToast } from "@/components/admin/ui";
import { gameLabel } from "@/components/admin/cells";
import { ReasonModal } from "@/components/admin/DrawWorkspace";
import { GameIcon } from "@/components/brand";
import { formatSlotTime } from "@/lib/admin/tehran-time";

/**
 * Reminder-only scheduling on the dashboard: each expected occurrence of every active draw
 * time that no manually created draw has claimed yet. Reading these never inserts anything;
 * "Create draw" opens the same prefilled form as the Draws page.
 */
export function ScheduleReminders() {
  const { run, me, can } = useAdminAuth();
  const { a, locale, dateTime, money } = useAdminI18n();
  const toast = useToast();
  const r = a.workflow.reminders;
  const isSuper = (me?.roles.includes("SUPER_ADMIN") ?? false) && can("draws.create");
  const [items, setItems] = useState<GameReminders[] | null>(null);
  const [games, setGames] = useState<Record<string, AdminGame>>({});
  const [dismissing, setDismissing] = useState<{ gameId: string; occ: ScheduledOccurrence } | null>(null);

  const load = useCallback(() => {
    run((token) => adminApi.reminders(token))
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [run]);

  useEffect(() => {
    void Promise.resolve().then(load);
    adminApi
      .listGames()
      .then((gs) => setGames(Object.fromEntries(gs.map((g) => [g.id, g]))))
      .catch(() => setGames({}));
  }, [load]);

  if (items === null) return <Skeleton className="h-24" />;
  const rows = items.flatMap((g) => g.occurrences.map((occ) => ({ g, occ })));

  return (
    <AdminCard title={r.title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{r.none}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {rows.map(({ g, occ }) => {
            const game = games[g.gameId];
            const name = game ? gameLabel(game, locale) : "…";
            const slot = g.slots.find((s) => s.slotId === occ.slotId);
            const slotName = occ.slotLabel ?? (slot ? formatSlotTime(slot.drawTime, locale) : occ.slotId);
            const tone = occ.state === "MISSED" ? "danger" : occ.state === "OVERDUE" ? "warning" : "neutral";
            const createHref = `/admin/draws?create=${g.gameId}&occurrence=${encodeURIComponent(occ.key)}`;
            return (
              <li
                key={`${g.gameId}-${occ.key}`}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${occ.state === "MISSED" ? "border-danger-border" : occ.state === "OVERDUE" ? "border-warning-border" : "border-border"}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${g.gameType === "SIX_CHANCE" ? "bg-ocean-700" : "bg-brand-700"}`}>
                    <GameIcon gameType={g.gameType} size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{occ.state === "MISSED" ? r.missed(name) : r.timeToCreate(name)}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Pill tone={tone}>{r.state[occ.state]}</Pill>
                      <span>{slotName}</span>
                      <span>· {r.settings(g.ruleVersion.versionNumber)}</span>
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted">{r.drawAt}</dt>
                  <dd className="font-semibold text-foreground">{dateTime(occ.drawAt)}</dd>
                  <dt className="text-muted">{r.salesOpen}</dt>
                  <dd className="text-ink-soft">{dateTime(occ.salesOpensAt)}</dd>
                  <dt className="text-muted">{r.salesClose}</dt>
                  <dd className="text-ink-soft">{dateTime(occ.salesClosesAt)}</dd>
                  {g.gameType === "SIX_CHANCE" && g.suggestedJackpotToman && (
                    <>
                      <dt className="text-muted">{r.jackpot}</dt>
                      <dd className="tabular text-ink-soft">{money(g.suggestedJackpotToman)}</dd>
                    </>
                  )}
                </dl>
                {occ.state === "OVERDUE" && <p className="text-xs text-warning">{r.overdueNote}</p>}
                {occ.state === "MISSED" && <p className="text-xs text-danger">{r.missedNote}</p>}
                {isSuper && (
                  <div className="flex flex-wrap gap-2">
                    <Link href={createHref} className={`btn btn-sm ${occ.state === "UPCOMING" ? "btn-secondary" : "btn-primary"}`}>
                      + {r.create}
                    </Link>
                    {occ.state === "MISSED" && (
                      <>
                        <Link href={`${createHref}&mode=replace`} className="btn btn-secondary btn-sm">
                          {r.replace}
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setDismissing({ gameId: g.gameId, occ })}>
                          {r.dismiss}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dismissing && (
        <ReasonModal
          title={r.dismissTitle}
          body={`${r.dismissBody} (${dateTime(dismissing.occ.drawAt)})`}
          confirmLabel={r.dismiss.replace("…", "")}
          danger
          onClose={() => setDismissing(null)}
          onConfirm={async (reason) => {
            await run((token) => adminApi.dismissOccurrence(token, dismissing.gameId, { slotId: dismissing.occ.slotId, localDate: dismissing.occ.localDate, reason }));
            setDismissing(null);
            toast("success", r.dismissed);
            load();
          }}
        />
      )}
    </AdminCard>
  );
}
