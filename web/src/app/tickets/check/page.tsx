"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { formatPersianDateTime, formatToman } from "@/lib/format";
import type { PublicTicketCheck } from "@/lib/types";

export default function TicketCheckPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<PublicTicketCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSearched(true);
    try {
      const found = await api.checkTicket(code.trim());
      setResult(found);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setResult(null);
      } else {
        setError(err instanceof ApiError ? err.message : "خطا در بررسی بلیط.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-2xl font-extrabold">بررسی بلیط</h1>
      <p className="mb-6 text-sm text-muted">
        کد عمومی بلیط خود را وارد کنید. این صفحه هیچ اطلاعات مالکیت یا کد ادعا (Claim Token) نمایش
        نمی‌دهد.
      </p>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          required
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="T-XXXXXXXXXXXX"
          className="focus-ring flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono"
          aria-label="کد عمومی بلیط"
        />
        <button
          type="submit"
          disabled={loading}
          className="focus-ring rounded-lg bg-brand px-4 py-2 font-bold text-brand-contrast hover:bg-brand-dark disabled:opacity-50"
        >
          جستجو
        </button>
      </form>

      <div className="mt-6">
        {loading && <LoadingMessage label="در حال جستجو..." />}
        {error && <ErrorMessage message={error} />}
        {!loading && !error && searched && !result && (
          <ErrorMessage message="بلیطی با این کد یافت نشد." />
        )}
        {result && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="font-mono font-bold" dir="ltr">
              {result.publicCode}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">بازی</dt>
              <dd>{result.gameCode}</dd>
              <dt className="text-muted">شماره قرعه‌کشی</dt>
              <dd dir="ltr">{result.drawNumber}</dd>
              <dt className="text-muted">زمان قرعه‌کشی</dt>
              <dd title={result.drawAt}>{formatPersianDateTime(result.drawAt)}</dd>
              <dt className="text-muted">وضعیت قرعه‌کشی</dt>
              <dd>{result.drawStatus}</dd>
              <dt className="text-muted">انتخاب</dt>
              <dd>
                {result.selection.kind === "FOUR_LEAF"
                  ? result.selection.numberValue
                  : `${result.selection.numbers.join(" - ")} | نماد: ${result.selection.symbol}`}
              </dd>
              <dt className="text-muted">قیمت</dt>
              <dd>{formatToman(result.unitPriceToman)}</dd>
              <dt className="text-muted">وضعیت بلیط</dt>
              <dd>{result.status}</dd>
              <dt className="text-muted">نتیجه</dt>
              <dd>{result.outcomeStatus}</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
