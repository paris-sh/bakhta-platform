"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/locale-context";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { GameCard } from "@/components/GameCard";
import { CloverPattern, GLOW, Glow } from "@/components/brand";
import { ArrowIcon, CheckIcon, SearchIcon } from "@/components/icons";
import { WinnerBanner } from "@/components/prize/WinnerBanner";
import { JackpotAnnouncements } from "@/components/prize/JackpotAnnouncement";
import type { Draw, Game } from "@/lib/types";

export default function HomePage() {
  const { t, digits, errorText } = useI18n();
  const [games, setGames] = useState<Game[] | null>(null);
  const [draws, setDraws] = useState<Record<string, Draw | null>>({});
  const [error, setError] = useState<unknown>(null);

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
              return [g.slug, await api.getNextDraw(g.slug)] as const;
            } catch {
              return [g.slug, null] as const;
            }
          }),
        );
        if (!cancelled) setDraws(Object.fromEntries(entries));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-14 pb-4">
      {/* Signed-in winners only: the server returns the caller's own winning tickets. */}
      <WinnerBanner />
      <Hero />
      {games && <JackpotAnnouncements games={games} />}

      <section className="container-page" aria-labelledby="how-title">
        <h2 id="how-title" className="sr-only">
          {t.home.howTitle}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {t.home.how.map((step, i) => (
            <li
              key={step.title}
              className="animate-fade-up flex items-start gap-3.5 rounded-xl border border-border bg-surface/80 p-4"
              style={{ "--delay": `${320 + i * 90}ms` } as React.CSSProperties}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-50 text-sm font-extrabold text-gold-700 ring-1 ring-gold-100">
                {digits(i + 1)}
              </span>
              <div>
                <p className="font-bold text-foreground">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="games" className="container-page scroll-mt-24" aria-labelledby="games-title">
        <div className="mb-6 flex flex-col gap-1">
          <h2 id="games-title" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t.home.gamesTitle}
          </h2>
          <p className="text-muted">{t.home.gamesSubtitle}</p>
        </div>
        {error !== null && <ErrorMessage message={errorText(error)} />}
        {error === null && games === null && <LoadingMessage label={t.home.loadingGames} />}
        {error === null && games !== null && games.length === 0 && <EmptyMessage label={t.home.noGames} />}
        {error === null && games !== null && games.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            {games.map((game, i) => (
              <GameCard key={game.id} game={game} draw={draws[game.slug] ?? null} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Hero() {
  const { t } = useI18n();
  return (
    <section className="container-page pt-6 sm:pt-8">
      <div className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(140deg,#0f7a58_0%,var(--brand-700)_38%,var(--brand-900)_100%)] px-6 py-12 text-white shadow-lg sm:px-12 sm:py-16">
        <CloverPattern opacity={0.07} />
        <Glow className="-end-40 -top-48 h-[42rem] w-[42rem]" color={GLOW.gold} />
        <Glow className="-bottom-56 -start-40 h-[36rem] w-[36rem]" color={GLOW.green} />

        <div className="relative grid items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col items-start">
            <span
              className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-gold-100"
              style={{ "--delay": "0ms" } as React.CSSProperties}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gold-300" />
              {t.home.eyebrow}
            </span>
            <h1
              className="animate-fade-up mt-5 max-w-xl text-4xl font-extrabold leading-[1.15] tracking-tight text-balance sm:text-5xl"
              style={{ "--delay": "70ms" } as React.CSSProperties}
            >
              {t.home.heroTitle}
            </h1>
            <p
              className="animate-fade-up mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg"
              style={{ "--delay": "140ms" } as React.CSSProperties}
            >
              {t.home.heroSubtitle}
            </p>
            <div
              className="animate-fade-up mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
              style={{ "--delay": "210ms" } as React.CSSProperties}
            >
              <a href="#games" className="btn btn-gold btn-lg">
                {t.home.ctaPlay}
                <ArrowIcon />
              </a>
              <Link href="/tickets/check" className="btn btn-on-dark btn-lg">
                <SearchIcon />
                {t.home.ctaCheck}
              </Link>
            </div>
            <ul
              className="animate-fade-up mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/80"
              style={{ "--delay": "280ms" } as React.CSSProperties}
            >
              {t.home.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <CheckIcon className="h-4 w-4 text-gold-300" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <HeroArt />
        </div>
      </div>
    </section>
  );
}

/** Decorative composition: soft rings, a gold clover and a few lottery balls. */
function HeroArt() {
  const { digits } = useI18n();
  return (
    <div
      className="animate-fade-in pointer-events-none relative mx-auto hidden aspect-square w-full max-w-sm lg:block"
      style={{ "--delay": "200ms" } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 320 320" className="h-full w-full">
        <defs>
          <radialGradient id="hero-ball" cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#f3ead6" />
            <stop offset="1" stopColor="#cfae66" />
          </radialGradient>
          <radialGradient id="hero-ball-green" cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#5fc39a" />
            <stop offset="1" stopColor="#075a41" />
          </radialGradient>
          <linearGradient id="hero-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6dc98" />
            <stop offset="1" stopColor="#c99a3b" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="#ffffff">
          <circle cx="160" cy="160" r="150" strokeOpacity="0.08" />
          <circle cx="160" cy="160" r="112" strokeOpacity="0.12" />
          <circle cx="160" cy="160" r="74" strokeOpacity="0.16" strokeDasharray="3 6" />
        </g>
        <g fill="url(#hero-gold)" opacity="0.95">
          <circle cx="160" cy="128" r="30" />
          <circle cx="192" cy="160" r="30" />
          <circle cx="160" cy="192" r="30" />
          <circle cx="128" cy="160" r="30" />
        </g>
        <circle cx="160" cy="160" r="11" fill="#06432f" />
        <g fontFamily="system-ui, sans-serif" fontWeight="800" textAnchor="middle">
          <circle cx="62" cy="86" r="24" fill="url(#hero-ball)" />
          <text x="62" y="93" fontSize="19" fill="#104457">{digits(7)}</text>
          <circle cx="262" cy="232" r="28" fill="url(#hero-ball)" />
          <text x="262" y="240" fontSize="21" fill="#104457">{digits(24)}</text>
          <circle cx="258" cy="70" r="17" fill="url(#hero-ball-green)" />
          <text x="258" y="76" fontSize="14" fill="#ffffff">{digits(4)}</text>
          <circle cx="74" cy="250" r="18" fill="url(#hero-ball-green)" />
          <text x="74" y="256" fontSize="14" fill="#ffffff">{digits(12)}</text>
        </g>
      </svg>
    </div>
  );
}
