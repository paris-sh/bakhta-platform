"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminGame, Paged, ResultListItem } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  EmptyState,
  ErrorState,
  Field,
  Forbidden,
  Pagination,
  Pill,
  TableSkeleton,
  TableWrap,
  inputSm,
  td,
  th,
} from "@/components/admin/ui";
import { gameLabel } from "@/components/admin/cells";
import { WinningValueView } from "@/components/admin/results";

const PAGE_SIZE = 20;
type View = "awaiting" | "published";

export default function AdminResultsPage() {
  const { can, run } = useAdminAuth();
  const { a, locale, dateTime, money, num, errorText } = useAdminI18n();
  const [games, setGames] = useState<AdminGame[]>([]);
  const [view, setView] = useState<View>("awaiting");
  const [gameId, setGameId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ResultListItem> | null>(null);
  const [error, setError] = useState<unknown>(null);
  useBreadcrumbs([{ label: a.nav.results }]);

  useEffect(() => {
    adminApi.listGames().then(setGames).catch(() => setGames([]));
  }, []);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    run((token) => adminApi.listResults(token, { view, gameId, page, pageSize: PAGE_SIZE }))
      .then(setData)
      .catch(setError);
  }, [run, view, gameId, page]);

  useEffect(() => {
    if (can("results.view")) void Promise.resolve().then(load);
  }, [can, load]);

  if (!can("results.view")) return <Forbidden />;

  const tab = (v: View, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => {
        setView(v);
        setPage(1);
      }}
      className={`focus-ring rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
        view === v ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={a.results.title} subtitle={a.results.subtitle} />

      <AdminCard bodyClassName="">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end sm:justify-between">
          <div role="tablist" aria-label={a.results.title} className="inline-flex w-fit gap-1 rounded-lg bg-background-subtle p-1">
            {tab("awaiting", a.results.awaiting)}
            {tab("published", a.results.published)}
          </div>
          <Field label={a.draws.game} htmlFor="r-game" className="sm:w-60">
            <select
              id="r-game"
              className={inputSm}
              value={gameId}
              onChange={(e) => {
                setGameId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{a.draws.allGames}</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameLabel(g, locale)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error !== null ? (
          <div className="p-4">
            <ErrorState message={errorText(error)} onRetry={load} />
          </div>
        ) : data === null ? (
          <TableSkeleton rows={5} cols={5} />
        ) : data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState message={view === "awaiting" ? a.results.noAwaiting : a.results.noPublished} />
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[46rem]">
                <thead className="border-b border-border bg-surface-muted">
                  <tr>
                    <th className={th}>{a.draws.drawNo}</th>
                    <th className={th}>{a.draws.game}</th>
                    <th className={th}>{a.draws.drawTime}</th>
                    {view === "awaiting" ? (
                      <>
                        <th className={`${th} text-end`}>{a.results.confirmedTickets}</th>
                        <th className={th}>{a.results.entry}</th>
                      </>
                    ) : (
                      <>
                        <th className={th}>{a.results.currentPublic}</th>
                        <th className={`${th} text-end`}>{a.results.winningTickets}</th>
                        <th className={`${th} text-end`}>{a.results.liability}</th>
                      </>
                    )}
                    <th className={th}>
                      <span className="sr-only">{a.results.open}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((item) => (
                    <tr key={item.draw.id} className="hover:bg-surface-muted">
                      <td className={`${td} font-bold`}>#{item.draw.drawNumber}</td>
                      <td className={`${td} font-semibold`}>{gameLabel(item.draw.game, locale)}</td>
                      <td className={`${td} text-xs text-ink-soft`}>{dateTime(item.draw.drawAt)}</td>
                      {view === "awaiting" ? (
                        <>
                          <td className={`${td} tabular text-end`}>{num(item.confirmedTickets)}</td>
                          <td className={td}>
                            {item.draftVersion ? <Pill tone="warning">{a.results.draftSaved(item.draftVersion)}</Pill> : <Pill tone="neutral">{a.results.noDraft}</Pill>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={td}>{item.published && <WinningValueView value={item.published.value} size="sm" />}</td>
                          <td className={`${td} tabular text-end`}>{num(item.published?.winningTickets ?? 0)}</td>
                          <td className={`${td} tabular text-end font-semibold`}>{money(item.published?.totalCashLiabilityToman ?? "0")}</td>
                        </>
                      )}
                      <td className={`${td} text-end`}>
                        <Link href={`/admin/draws/${item.draw.id}`} className="btn btn-secondary btn-sm">
                          {view === "awaiting" && can("results.enter") ? a.results.enter : a.results.open}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </AdminCard>
      <p className="text-xs text-muted">{a.common.tehranTime}</p>
    </div>
  );
}
