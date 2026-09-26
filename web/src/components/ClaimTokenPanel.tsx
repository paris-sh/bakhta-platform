"use client";

import { useState } from "react";
import type { ConfirmedTicket } from "@/lib/types";

// Claim Tokens live ONLY in the component state handed down from the confirmation API
// response — never written to localStorage/sessionStorage, never put in a URL, never
// logged (no console.log/console.error touches these values anywhere in this file or its
// callers). This panel is the one and only place they are ever displayed.

function TokenRow({ ticket }: { ticket: ConfirmedTicket }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!ticket.claimToken) return;
    try {
      await navigator.clipboard.writeText(ticket.claimToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the token is still visible and selectable on screen.
    }
  }

  if (!ticket.claimToken) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-warning-bg p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">کد بلیط: {ticket.publicCode}</span>
      </div>
      <code
        dir="ltr"
        className="break-all rounded bg-surface px-3 py-2 text-left font-mono text-sm"
      >
        {ticket.claimToken}
      </code>
      <button
        type="button"
        onClick={copy}
        className="focus-ring self-start rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-background"
      >
        {copied ? "کپی شد!" : "کپی کردن"}
      </button>
    </div>
  );
}

export function ClaimTokenPanel({ tickets }: { tickets: ConfirmedTicket[] }) {
  const guestTickets = tickets.filter((t) => t.claimToken);
  if (guestTickets.length === 0) return null;

  function downloadAll() {
    const lines = guestTickets.map(
      (t) => `کد بلیط: ${t.publicCode}\nکد ادعا (Claim Token): ${t.claimToken}\n`,
    );
    const content = [
      "این فایل شامل کدهای ادعای بلیط‌های شماست. آن را در جای امنی نگه دارید.",
      "این کدها فقط یک‌بار نمایش داده می‌شوند و قابل بازیابی نیستند.",
      "",
      ...lines,
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bakhta-claim-tokens.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-gold bg-warning-bg p-5">
      <div>
        <h3 className="text-lg font-extrabold text-warning">⚠ کد ادعای بلیط را ذخیره کنید</h3>
        <p className="mt-1 text-sm text-warning">
          چون بدون ورود به حساب کاربری خرید کرده‌اید، این کدها فقط <strong>همین یک‌بار</strong> نمایش
          داده می‌شوند و در سرور به‌صورت خام ذخیره نمی‌شوند. اگر آن‌ها را از دست بدهید، امکان بازیابی
          وجود ندارد. لطفاً همین حالا کپی یا دانلود کنید.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {guestTickets.map((t) => (
          <TokenRow key={t.id} ticket={t} />
        ))}
      </div>

      <button
        type="button"
        onClick={downloadAll}
        className="focus-ring self-start rounded-lg bg-gold-dark px-4 py-2 font-bold text-brand-contrast hover:opacity-90"
      >
        دانلود همه کدها
      </button>
    </div>
  );
}
