"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { formatToman } from "@/lib/format";
import { ticketOutcomeFa, ticketStatusFa } from "@/lib/labels";
import type { Ticket } from "@/lib/types";

export default function MyTicketsPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    api
      .myTickets(token)
      .then(setTickets)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "خطا در دریافت بلیط‌ها."));
  }, [isLoading, token, router]);

  if (isLoading || (!error && tickets === null)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LoadingMessage />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold">بلیط‌های من</h1>
      <p className="text-sm text-muted">
        بلیط‌های ثبت‌شده با حساب کاربری هیچ کد ادعا (Claim Token) ندارند — چون مالکیت آن‌ها مستقیماً
        به حساب شما متصل است.
      </p>
      {error && <ErrorMessage message={error} />}
      {!error && tickets?.length === 0 && <EmptyMessage label="هنوز بلیطی ندارید." />}
      {tickets?.map((t) => (
        <div key={t.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold" dir="ltr">
              {t.publicCode}
            </span>
            <span className="text-sm text-muted">
              {ticketStatusFa(t.status)} · {ticketOutcomeFa(t.outcomeStatus)}
            </span>
          </div>
          <p className="mt-1 text-sm">
            {t.selection.kind === "FOUR_LEAF"
              ? `عدد: ${t.selection.numberValue}`
              : `اعداد: ${t.selection.numbers.join(" - ")} | نماد شانس: ${t.selection.symbol}`}
          </p>
          <p className="mt-1 font-bold text-brand">{formatToman(t.unitPriceToman)}</p>
        </div>
      ))}
    </div>
  );
}
