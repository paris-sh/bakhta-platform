"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { GameCard } from "@/components/GameCard";
import type { Draw, Game } from "@/lib/types";

export default function HomePage() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [draws, setDraws] = useState<Record<string, Draw | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listGames()
      .then(async (list) => {
        if (cancelled) return;
        setGames(list);
        const entries = await Promise.all(
          list.map(async (g) => {
            try {
              const draw = await api.getNextDraw(g.slug);
              return [g.slug, draw] as const;
            } catch {
              return [g.slug, null] as const;
            }
          }),
        );
        if (!cancelled) setDraws(Object.fromEntries(entries));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "خطا در دریافت اطلاعات بازی‌ها.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <section className="rounded-2xl bg-brand px-6 py-12 text-center text-brand-contrast sm:px-12">
        <h1 className="text-3xl font-extrabold sm:text-4xl">به بخت‌آ خوش آمدید</h1>
        <p className="mx-auto mt-3 max-w-xl text-brand-contrast/90">
          در قرعه‌کشی‌های چهار برگ و شش شانس شرکت کنید و شانس خود را برای بردن جایزه امتحان کنید.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">بازی‌ها</h2>
        {error && <ErrorMessage message={error} />}
        {!error && games === null && <LoadingMessage label="در حال بارگذاری بازی‌ها..." />}
        {!error && games !== null && games.length === 0 && (
          <EmptyMessage label="در حال حاضر بازی فعالی وجود ندارد." />
        )}
        {!error && games !== null && games.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            {games.map((game) => (
              <GameCard key={game.id} game={game} draw={draws[game.slug] ?? null} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
