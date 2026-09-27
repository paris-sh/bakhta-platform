"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/locale-context";
import type { ConfirmedTicket } from "@/lib/types";
import { CheckIcon, CopyIcon, DownloadIcon, ShieldIcon } from "./icons";

// Claim Tokens live ONLY in the component state handed down from the confirmation API
// response — never written to localStorage/sessionStorage/cookies, never put in a URL, never
// logged (no console.log/console.error touches these values anywhere in this file or its
// callers). This panel is the one and only place they are ever displayed.

function TokenRow({ ticket }: { ticket: ConfirmedTicket }) {
  const { t } = useI18n();
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
    <div className="flex flex-col gap-2.5 rounded-lg border border-gold-100 bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">
          {t.claim.ticket}{" "}
          <span className="tabular font-mono font-bold text-foreground" dir="ltr">
            {ticket.publicCode}
          </span>
        </span>
        <button
          type="button"
          onClick={copy}
          className={`btn btn-sm ${copied ? "btn-primary" : "btn-secondary"}`}
          aria-live="polite"
        >
          {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? t.claim.copied : t.claim.copy}
        </button>
      </div>
      <code
        dir="ltr"
        className="block break-all rounded-md border border-dashed border-gold-300 bg-gold-50/60 px-3 py-2.5 text-left font-mono text-sm font-semibold text-gold-900 select-all"
      >
        {ticket.claimToken}
      </code>
    </div>
  );
}

export function ClaimTokenPanel({ tickets }: { tickets: ConfirmedTicket[] }) {
  const { t } = useI18n();
  const guestTickets = tickets.filter((ticket) => ticket.claimToken);
  if (guestTickets.length === 0) return null;

  function downloadAll() {
    const lines = guestTickets.map(
      (ticket) => `${t.claim.ticket}: ${ticket.publicCode}\n${t.claim.fileToken}: ${ticket.claimToken}\n`,
    );
    const content = [t.claim.fileIntro, t.claim.fileOnce, "", ...lines].join("\n");
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
    <section
      className="animate-fade-up relative overflow-hidden rounded-2xl border-2 border-gold bg-[linear-gradient(180deg,var(--gold-50)_0%,#fffdf7_100%)] p-5 shadow-gold sm:p-7"
      aria-labelledby="claim-title"
      style={{ "--delay": "150ms" } as React.CSSProperties}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-900 shadow-sm">
          <ShieldIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="claim-title" className="text-lg font-extrabold text-gold-900 sm:text-xl">
              {t.claim.title}
            </h3>
            <span className="badge badge-danger">{t.claim.once}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gold-900/80">{t.claim.body}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {guestTickets.map((ticket) => (
          <TokenRow key={ticket.id} ticket={ticket} />
        ))}
      </div>

      <button type="button" onClick={downloadAll} className="btn btn-gold mt-5 w-full sm:w-auto">
        <DownloadIcon className="h-5 w-5" />
        {t.claim.downloadAll}
      </button>
    </section>
  );
}
