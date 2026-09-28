"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import { EmptyMessage, ErrorMessage, LoadingMessage, Notice } from "@/components/StatusMessage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { PrizeBadge, PrizeDetails } from "@/components/prize/PrizeDetails";
import { ArrowIcon, TicketIcon } from "@/components/icons";
import type { MyTicket } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MyTicketsPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense
      fallback={
        <div className="container-page max-w-4xl py-10">
          <LoadingMessage />
        </div>
      }
    >
      <MyTickets />
    </Suspense>
  );
}

function MyTickets() {
  const { token, isLoading } = useAuth();
  const { t, locale, errorText, money, dateTime } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const rawDrawId = params.get("drawId");
  // "All my tickets for this draw": only a well-formed draw id is ever sent to the API.
  const drawId = rawDrawId && UUID.test(rawDrawId) ? rawDrawId : null;
  const [loaded, setLoaded] = useState<{ key: string; tickets: MyTicket[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const requestKey = drawId ?? "all";
  const tickets = loaded?.key === requestKey ? loaded.tickets : null;

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    api
      .myTickets(token, drawId ?? undefined)
      .then((list) => !cancelled && setLoaded({ key: drawId ?? "all", tickets: list }))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [isLoading, token, router, drawId]);

  // "View prize details" links to #ticket-<code>: scroll there once the cards exist.
  useEffect(() => {
    if (!tickets || !window.location.hash.startsWith("#ticket-")) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [tickets]);

  // Winning tickets first; otherwise the server's newest-first order.
  const ordered = tickets ? [...tickets].sort((a, b) => Number(b.prize !== null) - Number(a.prize !== null)) : null;
  const filterDraw = drawId ? (tickets?.[0]?.draw ?? null) : null;

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-10">
      <PageHeader title={t.tickets.title} icon={<TicketIcon className="h-6 w-6" />} />
      <Notice tone="info">{t.tickets.note}</Notice>

      {drawId && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold">
            {filterDraw ? t.tickets.filteredByDraw(gameName(filterDraw.game, locale, t), filterDraw.drawNumber) : t.tickets.filteredEmpty}
          </p>
          <Link href="/account/tickets" className="btn btn-secondary btn-sm shrink-0">
            {t.tickets.showAll}
          </Link>
        </div>
      )}

      {error !== null && <ErrorMessage message={errorText(error)} />}
      {error === null && (isLoading || tickets === null) && <LoadingMessage />}
      {error === null && !drawId && tickets?.length === 0 && (
        <EmptyMessage
          label={t.tickets.empty}
          action={
            <Link href="/" className="btn btn-primary btn-sm">
              {t.orders.browse}
              <ArrowIcon className="h-4 w-4" />
            </Link>
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {ordered?.map((ticket, i) => {
          const won = ticket.prize !== null;
          return (
            <article
              key={ticket.id}
              id={`ticket-${ticket.publicCode}`}
              className={`animate-fade-up relative flex scroll-mt-24 flex-col gap-4 overflow-hidden rounded-xl border bg-surface p-5 shadow-sm ${
                won ? `sm:col-span-2 ${ticket.prize!.isJackpot ? "border-2 border-gold shadow-gold" : "border-gold-300"}` : "border-border"
              }`}
              style={{ "--delay": `${i * 60}ms` } as React.CSSProperties}
            >
              <span className={`absolute inset-y-0 start-0 w-1 ${won ? "bg-gold" : "bg-brand"}`} aria-hidden="true" />
              {/* Ticket-stub notches on both edges. */}
              <span aria-hidden="true" className="absolute -start-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-border bg-background" />
              <span aria-hidden="true" className="absolute -end-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-border bg-background" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="tabular font-mono font-bold" dir="ltr">
                    {ticket.publicCode}
                  </span>
                  <p className="text-xs text-muted">
                    {gameName(ticket.draw.game, locale, t)} · {t.tickets.draw(ticket.draw.drawNumber)} ·{" "}
                    <span title={ticket.draw.drawAt}>{dateTime(ticket.draw.drawAt)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge kind="ticket" value={ticket.status} />
                  {won ? <PrizeBadge prize={ticket.prize!} /> : <StatusBadge kind="outcome" value={ticket.outcomeStatus} />}
                </div>
              </div>
              <div className="border-t border-dashed border-border-strong pt-4">
                <SelectionDisplay selection={ticket.selection} combinationCount={ticket.combinationCount} />
              </div>
              {won && (
                <div className={`rounded-lg p-4 ${ticket.prize!.isJackpot ? "bg-gold-50" : "bg-surface-muted"}`}>
                  <PrizeDetails prize={ticket.prize!} claim={ticket.claim} showClaim />
                </div>
              )}
              {/* A correction can remove a prize that already had a claim: say it is under review. */}
              {!won && ticket.claim?.requiresManualReconciliation && (
                <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning" role="status">
                  {t.prize.reconciliation}
                </p>
              )}
              <p className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  {ticket.combinationCount > 1
                    ? `${t.play.lineTotal} · ${t.play.chances(ticket.combinationCount)} × ${money(ticket.unitPriceToman)}`
                    : won
                      ? t.prize.ticketPrice
                      : t.tickets.price}
                </span>
                <span className={`tabular font-bold ${won ? "text-ink-soft" : "text-brand"}`}>{money(ticket.lineTotalToman)}</span>
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
