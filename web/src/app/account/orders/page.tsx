"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { EmptyMessage, ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { formatPersianDateTime, formatToman } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function MyOrdersPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    api
      .myOrders(token)
      .then(setOrders)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "خطا در دریافت سفارش‌ها."));
  }, [isLoading, token, router]);

  if (isLoading || (!error && orders === null)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LoadingMessage />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold">سفارش‌های من</h1>
      {error && <ErrorMessage message={error} />}
      {!error && orders?.length === 0 && <EmptyMessage label="هنوز سفارشی ثبت نکرده‌اید." />}
      {orders?.map((order) => (
        <div key={order.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold" dir="ltr">
              {order.orderNumber}
            </span>
            <span className="text-sm text-muted">{order.status}</span>
          </div>
          <p className="mt-1 text-sm text-muted" title={order.createdAt}>
            {formatPersianDateTime(order.createdAt)}
          </p>
          <p className="mt-1 font-bold text-brand">{formatToman(order.totalToman)}</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {order.tickets.map((t) => (
              <li key={t.id} className="flex justify-between border-t border-border pt-1">
                <span className="font-mono" dir="ltr">
                  {t.publicCode}
                </span>
                <span className="text-muted">{t.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
