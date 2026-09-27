"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { EmptyMessage, ErrorMessage, LoadingMessage, Notice } from "@/components/StatusMessage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { ArrowIcon, TicketIcon } from "@/components/icons";
import type { Ticket } from "@/lib/types";

export default function MyTicketsPage() {
  const { token, isLoading } = useAuth();
  const { t, errorText, money } = useI18n();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    api.myTickets(token).then(setTickets).catch(setError);
  }, [isLoading, token, router]);

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-10">
      <PageHeader title={t.tickets.title} icon={<TicketIcon className="h-6 w-6" />} />
      <Notice tone="info">{t.tickets.note}</Notice>

      {error !== null && <ErrorMessage message={errorText(error)} />}
      {error === null && (isLoading || tickets === null) && <LoadingMessage />}
      {error === null && tickets?.length === 0 && (
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
        {tickets?.map((ticket, i) => (
          <article
            key={ticket.id}
            className="animate-fade-up relative flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-sm"
            style={{ "--delay": `${i * 60}ms` } as React.CSSProperties}
          >
            <span className="absolute inset-y-0 start-0 w-1 bg-brand" aria-hidden="true" />
            {/* Ticket-stub notches on both edges. */}
            <span aria-hidden="true" className="absolute -start-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-border bg-background" />
            <span aria-hidden="true" className="absolute -end-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-border bg-background" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="tabular font-mono font-bold" dir="ltr">
                {ticket.publicCode}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge kind="ticket" value={ticket.status} />
                <StatusBadge kind="outcome" value={ticket.outcomeStatus} />
              </div>
            </div>
            <div className="border-t border-dashed border-border-strong pt-4">
              <SelectionDisplay selection={ticket.selection} />
            </div>
            <p className="flex items-center justify-between text-sm">
              <span className="text-muted">{t.tickets.price}</span>
              <span className="tabular font-bold text-brand">{money(ticket.unitPriceToman)}</span>
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
