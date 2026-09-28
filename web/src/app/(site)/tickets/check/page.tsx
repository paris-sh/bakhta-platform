"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import { ErrorMessage, LoadingMessage, Notice } from "@/components/StatusMessage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { GameIcon, GamePattern, gameTheme } from "@/components/brand";
import { SearchIcon, ShieldIcon } from "@/components/icons";
import { PrizeBadge, PrizeDetails } from "@/components/prize/PrizeDetails";
import type { Game, PublicTicketCheck } from "@/lib/types";

export default function TicketCheckPage() {
  const { t, locale, errorText, money, dateTime, digits } = useI18n();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<PublicTicketCheck | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setGame(null);
    setSearched(true);
    try {
      const found = await api.checkTicket(code.trim());
      setResult(found);
      // The catalog entry supplies the localized game name (nameEn / nameFa).
      api.getGame(found.gameSlug).then(setGame).catch(() => undefined);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) setError(err);
    } finally {
      setLoading(false);
    }
  }

  const name = result ? gameName(game ?? { gameType: result.gameCode }, locale, t) : "";

  return (
    <div className="container-page flex max-w-2xl flex-col gap-6 py-10">
      <PageHeader title={t.check.title} subtitle={t.check.subtitle} icon={<SearchIcon className="h-6 w-6" />} />

      <form onSubmit={onSubmit} className="card card-pad animate-fade-up flex flex-col gap-3" style={{ "--delay": "80ms" } as React.CSSProperties}>
        <label htmlFor="ticket-code" className="field-label mb-0">
          {t.check.codeLabel}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="ticket-code"
            type="text"
            required
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="T-XXXXXXXXXXXX"
            className="input tabular flex-1 font-mono uppercase tracking-wider"
          />
          <button type="submit" disabled={loading || code.trim() === ""} className="btn btn-primary btn-lg">
            <SearchIcon />
            {loading ? t.check.searching : t.check.search}
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldIcon className="h-4 w-4 shrink-0 text-brand" />
          {t.check.privacy}
        </p>
      </form>

      {loading && <LoadingMessage label={t.check.searching} />}
      {error !== null && <ErrorMessage message={errorText(error)} />}
      {!loading && error === null && searched && !result && <Notice tone="warning">{t.check.notFound}</Notice>}

      {result && (
        <article className="card animate-fade-up overflow-hidden">
          <div className={`relative isolate flex items-center justify-between gap-4 overflow-hidden px-6 py-5 text-white ${gameTheme(result.gameCode).header}`}>
            <GamePattern gameType={result.gameCode} />
            <div className="relative min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/65">{t.check.game}</p>
              <p className="text-xl font-extrabold">{name}</p>
              <p className="tabular mt-1 font-mono text-sm text-white/85" dir="ltr">
                {result.publicCode}
              </p>
            </div>
            <span className="relative">
              <GameIcon gameType={result.gameCode} size={48} />
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
            <Row label={t.check.selection} wide>
              <SelectionDisplay selection={result.selection} combinationCount={result.combinationCount} />
            </Row>
            <Row label={t.check.drawNumber}>{digits(result.drawNumber)}</Row>
            <Row label={t.check.drawTime}>
              <span title={result.drawAt}>{dateTime(result.drawAt)}</span>
            </Row>
            <Row label={t.check.drawStatus}>
              <StatusBadge kind="draw" value={result.drawStatus} />
            </Row>
            <Row label={result.combinationCount > 1 ? t.play.lineTotal : t.check.price}>
              <span className="tabular">{money(result.lineTotalToman)}</span>
              {result.combinationCount > 1 && (
                <span className="tabular block text-xs font-normal text-muted">
                  {t.play.chances(result.combinationCount)} × {money(result.unitPriceToman)}
                </span>
              )}
            </Row>
            <Row label={t.check.ticketStatus}>
              <StatusBadge kind="ticket" value={result.status} />
            </Row>
            <Row label={t.check.outcome}>
              {result.prize ? <PrizeBadge prize={result.prize} /> : <StatusBadge kind="outcome" value={result.outcomeStatus} />}
            </Row>
            {/* Public prize facts only; the Claim Token stays the separate secret for claiming. */}
            {result.prize && (
              <Row label={t.check.prizeTitle} wide>
                <div className={`rounded-lg p-4 font-normal ${result.prize.isJackpot ? "bg-gold-50" : "bg-surface-muted"}`}>
                  <PrizeDetails prize={result.prize} />
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                    <ShieldIcon className="h-4 w-4 shrink-0 text-brand" />
                    {t.check.guestClaimNote}
                  </p>
                </div>
              </Row>
            )}
          </dl>
        </article>
      )}
    </div>
  );
}

function Row({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1.5 font-semibold text-foreground">{children}</dd>
    </div>
  );
}
