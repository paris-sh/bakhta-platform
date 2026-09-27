"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName, scheduleText } from "@/lib/game";
import { EmptyMessage, ErrorMessage, LoadingMessage, Notice } from "@/components/StatusMessage";
import { Countdown } from "@/components/Countdown";
import { useCountdown } from "@/lib/use-countdown";
import { TicketBuilder } from "@/components/TicketBuilder";
import { ClaimTokenPanel } from "@/components/ClaimTokenPanel";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { StatusBadge } from "@/components/StatusBadge";
import { Stepper, type PurchaseStep } from "@/components/Stepper";
import { GLOW, GameIcon, GamePattern, Glow, gameTheme } from "@/components/brand";
import { ArrowIcon, BackIcon, CalendarIcon, CheckCircleIcon, ClockIcon, PlusIcon, UserIcon } from "@/components/icons";
import {
  emptyFourLeafDraft,
  emptySixChanceDraft,
  ticketPriceToman,
  validateFourLeafDraft,
  validateSixChanceDraft,
} from "@/lib/selection";
import type {
  ConfirmOrderResult,
  Draw,
  FourLeafRules,
  Game,
  GameRules,
  Order,
  SixChanceRules,
  TicketDraft,
  TicketSelection,
} from "@/lib/types";
import { DEMO_MODE } from "@/lib/config";
import { symbolsInRange } from "@/lib/chance-symbols";
import { ChanceSymbolIcon } from "@/components/ChanceSymbol";

type SubmitError = { kind: "guestEmail" } | { kind: "api"; error: unknown };

export default function GamePlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { token, user } = useAuth();
  const { t, errorText, money } = useI18n();

  const [game, setGame] = useState<Game | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [drawState, setDrawState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [loadError, setLoadError] = useState<unknown>(null);

  const [drafts, setDrafts] = useState<TicketDraft[]>([]);
  const [step, setStep] = useState<PurchaseStep>("build");
  const [guestEmail, setGuestEmail] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmOrderResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getGame(slug)
      .then((g) => {
        if (cancelled) return;
        setGame(g);
        setDrafts([makeEmptyDraft(g.gameType, 0)]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err);
      });
    api
      .getNextDraw(slug)
      .then((d) => {
        if (cancelled) return;
        setDraw(d);
        setDrawState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 = no draw currently open for sales; anything else is a real failure.
        setDrawState(err instanceof ApiError && err.status === 404 ? "none" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Price, validation and the selection UI must follow the selected draw's own snapshotted
  // rule version (the backend prices orders from it), never the game's current active rules
  // — those may already be a newer version than the one this draw was created under.
  const rules = draw?.currentRulesSnapshot ?? null;
  // Banner summary only: before a draw is known (or when none is open) fall back to the
  // game's active rules purely for display.
  const summaryRules = rules ?? game?.activeRules ?? null;

  const validDrafts = useMemo(() => {
    if (!rules || drafts.length === 0) return false;
    return drafts.every((d) =>
      d.kind === "FOUR_LEAF"
        ? validateFourLeafDraft(d) === null
        : validateSixChanceDraft(d, rules as SixChanceRules) === null,
    );
  }, [drafts, rules]);

  const unitPrice = rules ? ticketPriceToman(rules) : 0;
  const subtotal = unitPrice * drafts.length;

  const opensCountdown = useCountdown(draw?.salesOpensAt ?? null);
  const cutoffCountdown = useCountdown(draw?.salesClosesAt ?? null);
  const salesOpen =
    draw !== null &&
    draw.status === "SALES_OPEN" &&
    (opensCountdown?.isPast ?? false) &&
    !(cutoffCountdown?.isPast ?? true);

  function goTo(next: PurchaseStep) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addRow() {
    if (!game) return;
    setDrafts((prev) => [...prev, makeEmptyDraft(game.gameType, prev.length)]);
  }

  function goToCheckout() {
    setIdempotencyKey(crypto.randomUUID());
    setSubmitError(null);
    goTo("checkout");
  }

  async function submitOrder() {
    if (!game || !draw) return;
    if (!token && !guestEmail) {
      setSubmitError({ kind: "guestEmail" });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tickets = drafts.map((d) =>
        d.kind === "FOUR_LEAF"
          ? { isQuickPick: d.isQuickPick, ...(d.isQuickPick ? {} : { fourLeafNumber: d.fourLeafNumber }) }
          : {
              isQuickPick: d.isQuickPick,
              ...(d.isQuickPick
                ? {}
                : { sixChanceNumbers: d.numbers as number[], sixChanceSymbol: d.symbol as number }),
            },
      );
      const createdOrder = await api.createOrder(
        { drawId: draw.id, guestEmail: token ? undefined : guestEmail, tickets },
        idempotencyKey,
        token,
      );
      setOrder(createdOrder);

      if (DEMO_MODE) {
        const confirmed = await api.confirmOrderDev(createdOrder.id);
        setConfirmResult(confirmed);
      }
      goTo("result");
    } catch (err) {
      setSubmitError({ kind: "api", error: err });
    } finally {
      setSubmitting(false);
    }
  }

  function buyAgain() {
    if (!game) return;
    setDrafts([makeEmptyDraft(game.gameType, 0)]);
    setOrder(null);
    setConfirmResult(null);
    setGuestEmail("");
    goTo("build");
  }

  if (loadError !== null) {
    return (
      <div className="container-page max-w-3xl py-12">
        <ErrorMessage
          message={loadError instanceof ApiError && loadError.status === 404 ? t.play.gameNotFound : errorText(loadError)}
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              <BackIcon className="h-4 w-4" />
              {t.common.backHome}
            </Link>
          }
        />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container-page py-12">
        <LoadingMessage label={t.play.loadingGame} />
      </div>
    );
  }

  const submitErrorText =
    submitError?.kind === "guestEmail"
      ? t.play.guestEmailRequired
      : submitError?.kind === "api"
        ? errorText(submitError.error)
        : null;

  return (
    <div className="flex flex-col gap-8 pb-4">
      <GameBanner game={game} draw={draw} rules={summaryRules} />

      <div className="container-page flex flex-col gap-6">
        {drawState === "loading" && <LoadingMessage label={t.play.loadingDraw} />}

        {drawState === "none" && (
          <EmptyMessage
            label={`${t.play.noOpenDraw} ${t.play.noOpenDrawHint}`}
            action={
              <Link href="/" className="btn btn-secondary btn-sm">
                <BackIcon className="h-4 w-4" />
                {t.common.backHome}
              </Link>
            }
          />
        )}

        {drawState === "error" && <ErrorMessage message={t.play.drawLoadError} />}

        {draw && rules && (
          <>
            <div className="card px-4 py-3.5 sm:px-6">
              <Stepper step={step} />
            </div>

            {step !== "result" && !salesOpen && <Notice tone="warning">{t.play.salesNotOpenNow}</Notice>}

            {step === "build" && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <section className="flex min-w-0 flex-col gap-4" aria-labelledby="select-title">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id="select-title" className="text-xl font-extrabold tracking-tight">
                      {t.play.selectTitle}
                    </h2>
                    <button type="button" onClick={addRow} className="btn btn-secondary btn-sm">
                      <PlusIcon className="h-4 w-4" />
                      {t.play.addRow}
                    </button>
                  </div>
                  <TicketBuilder gameType={game.gameType} rules={rules} drafts={drafts} onChange={setDrafts} />
                </section>

                <OrderSummary count={drafts.length} unitPrice={unitPrice} total={subtotal}>
                  <button
                    type="button"
                    disabled={!validDrafts || !salesOpen}
                    onClick={goToCheckout}
                    className="btn btn-primary btn-lg w-full"
                  >
                    {t.play.continue}
                    <ArrowIcon />
                  </button>
                </OrderSummary>
              </div>
            )}

            {step === "checkout" && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <section className="card card-pad animate-fade-up flex min-w-0 flex-col gap-5" aria-labelledby="review-title">
                  <h2 id="review-title" className="text-xl font-extrabold tracking-tight">
                    {t.play.reviewTitle}
                  </h2>

                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {drafts.map((d, i) => (
                      <li key={d.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <span className="text-sm font-semibold text-ink-soft">{t.play.rowLabel(i + 1)}</span>
                        {d.isQuickPick ? (
                          <span className="badge badge-gold">
                            {t.play.quickPick}
                          </span>
                        ) : (
                          <SelectionDisplay selection={draftSelection(d)} size="sm" />
                        )}
                      </li>
                    ))}
                  </ul>

                  {user ? (
                    <div className="flex items-center gap-3 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
                      <UserIcon className="h-5 w-5 shrink-0" />
                      <span className="font-semibold">{t.play.buyingAs}</span>
                      <span className="ms-auto truncate font-mono text-xs" dir="ltr">
                        {user.email}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="guestEmail" className="field-label">
                        {t.play.guestEmailLabel}
                      </label>
                      <input
                        id="guestEmail"
                        type="email"
                        required
                        autoComplete="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        className="input"
                        placeholder="you@example.com"
                        dir="ltr"
                        aria-invalid={submitError?.kind === "guestEmail"}
                      />
                      <p className="field-hint">{t.play.guestEmailHint}</p>
                    </div>
                  )}

                  {submitErrorText && <ErrorMessage message={submitErrorText} />}
                </section>

                <OrderSummary count={drafts.length} unitPrice={unitPrice} total={subtotal}>
                  <div className="flex flex-col gap-2.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={submitOrder}
                      className="btn btn-primary btn-lg w-full"
                    >
                      {submitting ? t.play.placingOrder : t.play.placeOrder}
                      {!submitting && <CheckCircleIcon />}
                    </button>
                    <button type="button" onClick={() => goTo("build")} className="btn btn-ghost w-full">
                      <BackIcon className="h-4 w-4" />
                      {t.play.back}
                    </button>
                  </div>
                </OrderSummary>
              </div>
            )}

            {step === "result" && order && (
              <section className="flex flex-col gap-6" aria-labelledby="result-title">
                <div className="animate-fade-up relative overflow-hidden rounded-2xl border border-success-border bg-[linear-gradient(135deg,var(--success-bg)_0%,#ffffff_70%)] p-6 shadow-sm sm:p-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-success text-white shadow-md">
                      <CheckCircleIcon className="h-8 w-8" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 id="result-title" className="text-2xl font-extrabold tracking-tight text-foreground">
                        {confirmResult ? t.play.orderConfirmed : t.play.orderPlaced}
                      </h2>
                      <p className="mt-1 text-muted">{t.play.orderConfirmedHint}</p>
                    </div>
                  </div>
                  <dl className="mt-6 grid gap-4 border-t border-success-border/70 pt-5 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs font-semibold text-muted">{t.play.orderNumber}</dt>
                      <dd className="tabular mt-1 font-mono font-bold" dir="ltr">
                        {order.orderNumber}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted">{t.play.status}</dt>
                      <dd className="mt-1">
                        <StatusBadge kind="order" value={confirmResult?.order.status ?? order.status} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted">{t.play.total}</dt>
                      <dd className="tabular mt-1 font-bold">{money(order.totalToman)}</dd>
                    </div>
                  </dl>
                </div>

                {!DEMO_MODE && <Notice tone="warning">{t.play.paymentDisabled}</Notice>}

                <div>
                  <h3 className="mb-3 text-lg font-bold">{t.play.yourTickets}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(confirmResult?.tickets ?? order.tickets).map((ticket, i) => (
                      <div
                        key={ticket.id}
                        className="animate-fade-up relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-xs"
                        style={{ "--delay": `${80 + i * 70}ms` } as React.CSSProperties}
                      >
                        <span className="absolute inset-y-0 start-0 w-1 bg-brand" aria-hidden="true" />
                        <div className="flex items-center justify-between gap-2">
                          <span className="tabular font-mono text-sm font-bold" dir="ltr">
                            {ticket.publicCode}
                          </span>
                          <StatusBadge kind="ticket" value={ticket.status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SelectionDisplay selection={ticket.selection} size="sm" />
                          {ticket.isQuickPick && (
                            <span className="badge badge-gold">
                              {t.play.quickPick}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {confirmResult && <ClaimTokenPanel tickets={confirmResult.tickets} />}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={buyAgain} className="btn btn-primary btn-lg">
                    <PlusIcon />
                    {t.play.buyMore}
                  </button>
                  <Link href="/" className="btn btn-secondary btn-lg">
                    <BackIcon className="h-4 w-4" />
                    {t.common.backHome}
                  </Link>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrderSummary({
  count,
  unitPrice,
  total,
  children,
}: {
  count: number;
  unitPrice: number;
  total: number;
  children: React.ReactNode;
}) {
  const { t, money, num } = useI18n();
  return (
    <aside className="card card-pad flex flex-col gap-4 lg:sticky lg:top-24" aria-label={t.play.summaryTitle}>
      <h2 className="text-base font-bold">{t.play.summaryTitle}</h2>
      <dl className="flex flex-col gap-2.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t.play.pricePerTicket}</dt>
          <dd className="tabular font-semibold">{money(unitPrice)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t.play.ticketsLabel}</dt>
          <dd className="tabular font-semibold">× {num(count)}</dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-border-strong pt-3.5">
          <dt className="font-bold">{t.play.total}</dt>
          <dd className="tabular text-2xl font-extrabold text-brand">{money(total)}</dd>
        </div>
      </dl>
      {children}
    </aside>
  );
}

function GameBanner({
  game,
  draw,
  rules,
}: {
  game: Game;
  draw: Draw | null;
  rules: GameRules | null;
}) {
  const { t, locale, money, dateTime } = useI18n();
  const theme = gameTheme(game.gameType);
  const isSix = game.gameType === "SIX_CHANCE";

  const prize = rules
    ? isSix
      ? money(draw?.openingJackpotToman ?? (rules as SixChanceRules).minimum_jackpot_toman)
      : money((rules as FourLeafRules).fixed_prize_toman)
    : null;

  const rulesText = rules
    ? isSix
      ? t.play.rulesSixChance(
          (rules as SixChanceRules).selection.main_numbers.count,
          (rules as SixChanceRules).selection.main_numbers.min,
          (rules as SixChanceRules).selection.main_numbers.max,
          new Intl.ListFormat(locale, { type: "disjunction" }).format(
            symbolsInRange(
              (rules as SixChanceRules).selection.chance_symbol.min,
              (rules as SixChanceRules).selection.chance_symbol.max,
            ).map((sym) => sym.label[locale]),
          ),
        )
      : t.play.rulesFourLeaf
    : null;

  return (
    <section className="container-page pt-6 sm:pt-8">
      <div className={`animate-fade-up relative isolate overflow-hidden rounded-2xl px-6 py-7 text-white shadow-lg sm:px-10 sm:py-9 ${theme.header}`}>
        <GamePattern gameType={game.gameType} />
        <Glow className="-end-32 -top-40 h-[34rem] w-[34rem]" color={isSix ? GLOW.ocean : GLOW.gold} />

        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <GameIcon gameType={game.gameType} size={52} />
              <div className="min-w-0">
                <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{gameName(game, locale, t)}</h1>
                {draw && <p className="mt-0.5 text-sm text-white/70">{t.play.drawNumber(draw.drawNumber)}</p>}
              </div>
            </div>
            {rulesText && <p className="mt-4 max-w-xl leading-relaxed text-white/85">{rulesText}</p>}
            {isSix && rules && (
              <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
                {symbolsInRange(
                  (rules as SixChanceRules).selection.chance_symbol.min,
                  (rules as SixChanceRules).selection.chance_symbol.max,
                ).map((sym) => (
                  <ChanceSymbolIcon key={sym.id} symbol={sym} size={26} />
                ))}
              </div>
            )}
            {rules && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-white/70">
                <CalendarIcon className="h-4 w-4 shrink-0" />
                {scheduleText(rules, t, locale)} ({t.common.tehranTime})
              </p>
            )}

            {rules && (
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="grow rounded-lg border border-gold-300/40 bg-black/15 px-4 py-2.5 backdrop-blur-sm sm:grow-0">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/65">
                    {isSix ? t.gameCard.jackpot : t.gameCard.fixedPrize}
                  </p>
                  <p className="prize-text-on-dark tabular text-2xl font-extrabold">{prize}</p>
                </div>
                <div className="grow rounded-lg border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-sm sm:grow-0">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/65">{t.play.pricePerTicket}</p>
                  <p className="tabular text-2xl font-extrabold">{money(rules.ticket_price_toman)}</p>
                </div>
              </div>
            )}
          </div>

          {draw && (
            <div className="flex flex-col gap-4 rounded-xl border border-white/15 bg-black/15 p-4 backdrop-blur-sm sm:p-5">
              <Countdown targetIso={draw.salesClosesAt} label={t.play.salesCloseIn} tone="dark" />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="flex items-center gap-1 text-xs text-white/65">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {t.play.drawAt}
                  </dt>
                  <dd className="mt-0.5 font-semibold" title={draw.drawAt}>
                    {dateTime(draw.drawAt)}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-xs text-white/65">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {t.play.salesClose}
                  </dt>
                  <dd className="mt-0.5 font-semibold" title={draw.salesClosesAt}>
                    {dateTime(draw.salesClosesAt)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function draftSelection(d: TicketDraft): TicketSelection {
  return d.kind === "FOUR_LEAF"
    ? { kind: "FOUR_LEAF", numberValue: d.fourLeafNumber }
    : { kind: "SIX_CHANCE", numbers: d.numbers as number[], symbol: d.symbol as number };
}

function makeEmptyDraft(gameType: "SIX_CHANCE" | "FOUR_LEAF", index: number): TicketDraft {
  const key = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
  return gameType === "FOUR_LEAF" ? emptyFourLeafDraft(key) : emptySixChanceDraft(key);
}
