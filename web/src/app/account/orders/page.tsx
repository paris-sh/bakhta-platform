"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { ArrowIcon, CalendarIcon, TicketIcon } from "@/components/icons";
import type { Order } from "@/lib/types";

export default function MyOrdersPage() {
  const { token, isLoading } = useAuth();
  const { t, errorText, money, dateTime, num } = useI18n();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    api.myOrders(token).then(setOrders).catch(setError);
  }, [isLoading, token, router]);

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-10">
      <PageHeader title={t.orders.title} subtitle={t.orders.subtitle} icon={<TicketIcon className="h-6 w-6" />} />

      {error !== null && <ErrorMessage message={errorText(error)} />}
      {error === null && (isLoading || orders === null) && <LoadingMessage />}
      {error === null && orders?.length === 0 && (
        <EmptyMessage
          label={t.orders.empty}
          action={
            <Link href="/" className="btn btn-primary btn-sm">
              {t.orders.browse}
              <ArrowIcon className="h-4 w-4" />
            </Link>
          }
        />
      )}

      <div className="flex flex-col gap-4">
        {orders?.map((order, i) => (
          <article
            key={order.id}
            className="card animate-fade-up overflow-hidden"
            style={{ "--delay": `${i * 60}ms` } as React.CSSProperties}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-5 py-4">
              <span className="tabular font-mono text-base font-bold" dir="ltr">
                {order.orderNumber}
              </span>
              <StatusBadge kind="order" value={order.status} />
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold text-muted">{t.orders.placed}</dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-medium" title={order.createdAt}>
                    <CalendarIcon className="h-4 w-4 shrink-0 text-muted" />
                    {dateTime(order.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">{t.orders.tickets}</dt>
                  <dd className="tabular mt-1 font-medium">{num(order.tickets.length)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">{t.orders.total}</dt>
                  <dd className="tabular mt-1 text-base font-extrabold text-brand">{money(order.totalToman)}</dd>
                </div>
              </dl>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {order.tickets.map((ticket) => (
                  <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="tabular font-mono text-sm font-semibold" dir="ltr">
                      {ticket.publicCode}
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <SelectionDisplay selection={ticket.selection} size="sm" combinationCount={ticket.combinationCount} />
                      <StatusBadge kind="ticket" value={ticket.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
