"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import type { Game, PublicResultListItem } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { GameIcon } from "@/components/brand";
import { ArrowIcon, SparkleIcon } from "@/components/icons";
import { PublicWinningView } from "@/components/results/PublicWinning";

const PAGE_SIZE = 20;

export default function ResultsPage() {
  const { t, locale, dateTime } = useI18n();
  const [games, setGames] = useState<Game[]>([]);
  const [game, setGame] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: PublicResultListItem[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.listGames().then(setGames).catch(() => setGames([]));
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setData(null);
      setFailed(false);
      api
        .listResults({ page, pageSize: PAGE_SIZE, game: game || undefined })
        .then((res) => active && setData(res))
        .catch(() => active && setFailed(true));
    });
    return () => {
      active = false;
    };
  }, [game, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-10">
      <PageHeader title={t.results.title} subtitle={t.results.subtitle} icon={<SparkleIcon className="h-6 w-6" />} />

      <div className="flex flex-wrap gap-2" role="group" aria-label={t.results.title}>
        {[{ slug: "", label: t.results.allGames }, ...games.map((g) => ({ slug: g.slug, label: gameName(g, locale, t) }))].map((g) => (
          <button
            key={g.slug || "all"}
            type="button"
            aria-pressed={game === g.slug}
            onClick={() => {
              setGame(g.slug);
              setPage(1);
            }}
            className={`focus-ring rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
              game === g.slug ? "border-brand bg-brand text-white" : "border-border bg-surface text-ink-soft hover:border-brand-300"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {failed ? (
        <ErrorMessage message={t.results.loadError} />
      ) : data === null ? (
        <LoadingMessage />
      ) : data.items.length === 0 ? (
        <EmptyMessage label={t.results.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((r) => (
            <li key={`${r.game.slug}-${r.drawNumber}`}>
              <Link
                href={`/results/${r.game.slug}/${r.drawNumber}`}
                className="card focus-ring group flex flex-col gap-3 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:gap-5 sm:p-5"
              >
                <span className="flex items-center gap-3 sm:w-56 sm:shrink-0">
                  <GameIcon gameType={r.game.gameType} size={40} />
                  <span className="min-w-0">
                    <span className="block font-bold text-foreground">{gameName(r.game, locale, t)}</span>
                    <span className="block text-xs text-muted">
                      {t.results.drawNumber(r.drawNumber)} · {dateTime(r.drawAt)}
                    </span>
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <PublicWinningView winning={r.winning} size="sm" />
                </span>
                <span className="flex items-center justify-between gap-3 text-sm sm:justify-end">
                  <span className="text-muted">{t.results.winningRows(r.winningRows)}</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-brand">
                    {t.results.viewResult}
                    <ArrowIcon className="h-4 w-4 rtl:-scale-x-100" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹
          </button>
          <span className="tabular text-sm text-muted">
            {page} / {pages}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}
