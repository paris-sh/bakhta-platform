"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDrawListItem, AdminGame } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  EmptyState,
  ErrorState,
  Forbidden,
  Pill,
  TableSkeleton,
  TableWrap,
  td,
  th,
  useToast,
} from "@/components/admin/ui";
import { DrawAvailabilityPill, GameStatusPill, gameLabel } from "@/components/admin/cells";
import { GameIcon } from "@/components/brand";
import { EditGameModal } from "@/components/admin/EditGameModal";

export default function AdminGamesPage() {
  const { can, run } = useAdminAuth();
  const { a, locale, money, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [nextDraws, setNextDraws] = useState<Record<string, AdminDrawListItem>>({});
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<AdminGame | null>(null);
  useBreadcrumbs([{ label: a.nav.games }]);

  const load = useCallback(() => {
    setError(null);
    setGames(null);
    adminApi.listGames().then(setGames).catch(setError);
    if (can("draws.view")) {
      run((token) => adminApi.listDraws(token, { state: "OPEN_OR_UPCOMING", pageSize: 100 }))
        .then((res) => setNextDraws(Object.fromEntries(res.items.filter((d) => d.isNextForGame).map((d) => [d.gameId, d]))))
        .catch(() => setNextDraws({}));
    }
  }, [can, run]);

  useEffect(() => {
    if (can("games.view")) void Promise.resolve().then(load);
  }, [can, load]);

  if (!can("games.view")) return <Forbidden />;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={a.games.title} subtitle={a.games.subtitle} />
      <AdminCard bodyClassName="">
        {error !== null ? (
          <ErrorState message={errorText(error)} onRetry={load} />
        ) : games === null ? (
          <TableSkeleton rows={2} cols={6} />
        ) : games.length === 0 ? (
          <EmptyState message={a.common.noResults} />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[52rem]">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th className={th}>{a.games.name}</th>
                  <th className={th}>{a.games.status}</th>
                  <th className={th}>{a.games.price}</th>
                  <th className={th}>{a.games.activeVersion}</th>
                  <th className={th}>{a.games.nextDraw}</th>
                  <th className={`${th} text-end`}>{a.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g) => {
                  const next = nextDraws[g.id];
                  return (
                    <tr key={g.id} className="hover:bg-surface-muted">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${g.gameType === "SIX_CHANCE" ? "bg-ocean-700" : "bg-brand-700"}`}>
                            <GameIcon gameType={g.gameType} size={30} />
                          </span>
                          <div className="min-w-0">
                            <Link href={`/admin/games/${g.id}`} className="font-bold text-foreground hover:text-brand hover:underline">
                              {gameLabel(g, locale)}
                            </Link>
                            <p className="text-xs text-muted">
                              <span lang={locale === "fa" ? "en" : "fa"}>{locale === "fa" ? g.nameEn : g.nameFa}</span> ·{" "}
                              <span className="font-mono" dir="ltr">
                                {g.code}
                              </span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        <GameStatusPill status={g.status} />
                      </td>
                      <td className={`${td} tabular font-semibold`}>
                        {g.activeRules ? money(g.activeRules.ticket_price_toman) : a.common.none}
                      </td>
                      <td className={td}>
                        {g.activeRuleVersionNumber ? (
                          <span className="flex items-center gap-1.5">
                            <Pill tone="success">{a.common.version(g.activeRuleVersionNumber)}</Pill>
                            <span className="text-xs text-muted">{a.common.schema(Number(g.activeRules?.schema_version ?? 1))}</span>
                          </span>
                        ) : (
                          a.common.none
                        )}
                      </td>
                      <td className={td}>
                        {next ? (
                          <div>
                            <p className="flex items-center gap-1.5 font-semibold">
                              #{next.drawNumber}
                              <Pill tone="neutral">{a.common.version(next.ruleVersionNumber)}</Pill>
                              <DrawAvailabilityPill status={next.status} salesState={next.salesState} />
                            </p>
                            <p className="text-xs text-muted">{dateTime(next.drawAt)}</p>
                          </div>
                        ) : (
                          <span className="text-muted">{a.common.none}</span>
                        )}
                      </td>
                      <td className={`${td} text-end`}>
                        <div className="flex justify-end gap-2">
                          {can("games.edit") && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(g)}>
                              {a.games.edit}
                            </button>
                          )}
                          <Link href={`/admin/games/${g.id}`} className="btn btn-primary btn-sm">
                            {can("games.edit") ? a.games.manage : a.games.view}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </AdminCard>

      {editing && (
        <EditGameModal
          game={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast("success", a.games.saved);
            load();
          }}
        />
      )}
    </div>
  );
}
