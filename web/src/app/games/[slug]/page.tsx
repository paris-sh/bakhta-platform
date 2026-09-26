"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { Countdown } from "@/components/Countdown";
import { useCountdown } from "@/lib/use-countdown";
import { TicketBuilder } from "@/components/TicketBuilder";
import { ClaimTokenPanel } from "@/components/ClaimTokenPanel";
import { formatPersianDateTime, formatToman, weekdayNameFa } from "@/lib/format";
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
  Order,
  SixChanceRules,
  TicketDraft,
} from "@/lib/types";
import { DEMO_MODE } from "@/lib/config";

type Step = "build" | "checkout" | "result";

export default function GamePlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { token, user } = useAuth();

  const [game, setGame] = useState<Game | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [drawMissing, setDrawMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<TicketDraft[]>([]);
  const [step, setStep] = useState<Step>("build");
  const [guestEmail, setGuestEmail] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "خطا در دریافت اطلاعات بازی.");
      });
    api
      .getNextDraw(slug)
      .then((d) => {
        if (!cancelled) setDraw(d);
      })
      .catch(() => {
        if (!cancelled) setDrawMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const rules = game?.activeRules ?? null;

  const validDrafts = useMemo(() => {
    if (!rules || drafts.length === 0) return false;
    return drafts.every((d) =>
      d.kind === "FOUR_LEAF"
        ? validateFourLeafDraft(d) === null
        : validateSixChanceDraft(d, rules as SixChanceRules) === null,
    );
  }, [drafts, rules]);

  const subtotal = rules ? ticketPriceToman(rules) * drafts.length : 0;

  const opensCountdown = useCountdown(draw?.salesOpensAt ?? null);
  const cutoffCountdown = useCountdown(draw?.salesClosesAt ?? null);
  const salesOpen =
    draw !== null &&
    draw.status === "SALES_OPEN" &&
    (opensCountdown?.isPast ?? false) &&
    !(cutoffCountdown?.isPast ?? true);

  function addRow() {
    if (!game) return;
    setDrafts((prev) => [...prev, makeEmptyDraft(game.gameType, prev.length)]);
  }

  function goToCheckout() {
    setIdempotencyKey(crypto.randomUUID());
    setSubmitError(null);
    setStep("checkout");
  }

  async function submitOrder() {
    if (!game || !draw) return;
    if (!token && !guestEmail) {
      setSubmitError("برای خرید مهمان، وارد کردن ایمیل الزامی است.");
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
      setStep("result");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "ثبت سفارش با خطا مواجه شد.");
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
    setStep("build");
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorMessage message={loadError} />
        <Link href="/" className="mt-4 inline-block text-brand underline">
          بازگشت به صفحه اصلی
        </Link>
      </div>
    );
  }

  if (!game || !rules) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LoadingMessage label="در حال بارگذاری بازی..." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-2xl font-extrabold">{game.nameFa}</h1>
        <GameRulesSummary rules={rules} gameType={game.gameType} />
      </header>

      {drawMissing && (
        <ErrorMessage message="در حال حاضر قرعه‌کشی فعالی برای این بازی وجود ندارد." />
      )}

      {draw && (
        <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-3">
          <InfoBlock label="قرعه‌کشی بعدی" value={formatPersianDateTime(draw.drawAt)} iso={draw.drawAt} />
          <InfoBlock
            label="مهلت فروش"
            value={formatPersianDateTime(draw.salesClosesAt)}
            iso={draw.salesClosesAt}
          />
          <div className="flex items-center justify-center">
            <Countdown targetIso={draw.salesClosesAt} label="تا پایان مهلت فروش" />
          </div>
          {!salesOpen && (
            <div className="sm:col-span-3">
              <ErrorMessage message="فروش بلیط برای این قرعه‌کشی در حال حاضر باز نیست." />
            </div>
          )}
        </section>
      )}

      {step === "build" && draw && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">انتخاب بلیط‌ها</h2>
            <button
              type="button"
              onClick={addRow}
              className="focus-ring rounded-lg border border-brand px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand hover:text-brand-contrast"
            >
              + افزودن ردیف
            </button>
          </div>

          <TicketBuilder gameType={game.gameType} rules={rules} drafts={drafts} onChange={setDrafts} />

          <div className="flex items-center justify-between rounded-xl bg-background p-4">
            <span className="text-muted">جمع کل ({drafts.length} بلیط)</span>
            <span className="text-xl font-extrabold text-brand">{formatToman(subtotal)}</span>
          </div>

          <button
            type="button"
            disabled={!validDrafts || !salesOpen}
            onClick={goToCheckout}
            className="focus-ring rounded-lg bg-brand px-4 py-3 font-bold text-brand-contrast hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            ادامه به تسویه‌حساب
          </button>
        </section>
      )}

      {step === "checkout" && draw && (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-lg font-bold">تسویه‌حساب</h2>
          <div className="flex items-center justify-between rounded-xl bg-background p-4">
            <span className="text-muted">جمع کل ({drafts.length} بلیط)</span>
            <span className="text-xl font-extrabold text-brand">{formatToman(subtotal)}</span>
          </div>

          {user ? (
            <p className="text-sm">
              خرید به‌عنوان کاربر ثبت‌شده: <strong>{user.email}</strong>
            </p>
          ) : (
            <div>
              <label htmlFor="guestEmail" className="mb-1 block text-sm font-medium">
                ایمیل (الزامی برای خرید مهمان)
              </label>
              <input
                id="guestEmail"
                type="email"
                required
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2"
                placeholder="you@example.com"
                dir="ltr"
              />
            </div>
          )}

          {submitError && <ErrorMessage message={submitError} />}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("build")}
              className="focus-ring rounded-lg border border-border px-4 py-3 font-semibold hover:bg-background"
            >
              بازگشت
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={submitOrder}
              className="focus-ring flex-1 rounded-lg bg-brand px-4 py-3 font-bold text-brand-contrast hover:bg-brand-dark disabled:opacity-50"
            >
              {submitting ? "در حال ثبت سفارش..." : "ثبت سفارش"}
            </button>
          </div>
        </section>
      )}

      {step === "result" && order && (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-success/30 bg-success-bg p-6">
            <h2 className="text-lg font-extrabold text-success">سفارش ثبت شد</h2>
            <p className="mt-1 text-sm">
              شماره سفارش: <strong dir="ltr">{order.orderNumber}</strong> — وضعیت:{" "}
              <strong>{confirmResult ? "تأیید شده" : orderStatusFa(order.status)}</strong>
            </p>
          </div>

          {!DEMO_MODE && (
            <ErrorMessage message="پرداخت در این نسخه فعال نیست؛ سفارش در انتظار پرداخت باقی می‌ماند." />
          )}

          <div className="flex flex-col gap-3">
            {(confirmResult?.tickets ?? order.tickets).map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-surface p-4">
                <p className="font-mono font-bold" dir="ltr">
                  {t.publicCode}
                </p>
                <p className="text-sm text-muted">{describeSelection(t.selection)}</p>
                <p className="text-sm">وضعیت: {orderStatusFa(t.status)}</p>
              </div>
            ))}
          </div>

          {confirmResult && <ClaimTokenPanel tickets={confirmResult.tickets} />}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={buyAgain}
              className="focus-ring rounded-lg bg-brand px-4 py-3 font-bold text-brand-contrast hover:bg-brand-dark"
            >
              خرید بیشتر
            </button>
            <Link
              href="/"
              className="focus-ring rounded-lg border border-border px-4 py-3 font-semibold hover:bg-background"
            >
              بازگشت به صفحه اصلی
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function makeEmptyDraft(gameType: "SIX_CHANCE" | "FOUR_LEAF", index: number): TicketDraft {
  const key = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
  return gameType === "FOUR_LEAF" ? emptyFourLeafDraft(key) : emptySixChanceDraft(key);
}

function InfoBlock({ label, value, iso }: { label: string; value: string; iso: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold" title={iso}>
        {value}
      </p>
    </div>
  );
}

function GameRulesSummary({
  rules,
  gameType,
}: {
  rules: FourLeafRules | SixChanceRules;
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
}) {
  const activeDays = rules.schedule.active_weekdays.map(weekdayNameFa).join("، ");
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm text-muted">
      <p>
        {gameType === "FOUR_LEAF"
          ? "یک عدد چهار رقمی انتخاب کنید (صفر ابتدایی مجاز است) یا انتخاب خودکار بزنید."
          : `${(rules as SixChanceRules).selection.main_numbers.count} عدد متمایز بین ${
              (rules as SixChanceRules).selection.main_numbers.min
            } تا ${(rules as SixChanceRules).selection.main_numbers.max} به‌همراه یک نماد شانس بین ${
              (rules as SixChanceRules).selection.chance_symbol.min
            } تا ${(rules as SixChanceRules).selection.chance_symbol.max} انتخاب کنید.`}
      </p>
      <p>روزهای قرعه‌کشی: {activeDays} — ساعت {rules.schedule.draw_time}</p>
      <p>قیمت هر بلیط: {formatToman(rules.ticket_price_toman)}</p>
    </div>
  );
}

function describeSelection(selection: { kind: string; numberValue?: string; numbers?: number[]; symbol?: number }) {
  if (selection.kind === "FOUR_LEAF") return `عدد: ${selection.numberValue}`;
  return `اعداد: ${selection.numbers?.join(" - ")} | نماد شانس: ${selection.symbol}`;
}

function orderStatusFa(status: string): string {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "در انتظار پرداخت",
    CONFIRMED: "تأیید شده",
    PENDING: "در انتظار",
    CANCELLED: "لغو شده",
  };
  return map[status] ?? status;
}
