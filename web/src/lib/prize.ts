// Presentation helpers for prizes and order confirmation. Pure (type-only imports) so they
// are unit-tested directly. Every amount comes from the server; nothing here computes a prize.
import type { Messages } from "./i18n/messages";
import type { ConfirmOrderResult, MyTicket, Order, TicketPrize } from "./types";

/** "6 numbers + symbol" / "All four digits in order" from a rule match pattern. */
export function tierLabel(match: string | null, t: Messages): string {
  const m = match ? /^([0-6])_MAIN(_PLUS_CHANCE)?$/.exec(match) : null;
  if (m) return t.results.tierLabel(Number(m[1]), m[2] !== undefined);
  return t.results.fourLeafTier;
}

/** A winning card's title: "Jackpot winner" for a jackpot, otherwise the winning tier. */
export function prizeHeadline(prize: TicketPrize, t: Messages): string {
  return prize.isJackpot ? t.prize.jackpotWinner : tierLabel(prize.tierMatch, t);
}

export function isDeadlinePassed(iso: string, now = Date.now()): boolean {
  return Date.parse(iso) <= now;
}

/** Compares whole-Toman amount strings exactly (no float rounding for large amounts). */
function compareAmounts(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

/**
 * Winning tickets worth a personal banner: a current award whose claim deadline has not
 * passed. Jackpots first, then the largest cash prize, then the most recent draw.
 */
export function bannerWinnings(tickets: MyTicket[], now = Date.now()): (MyTicket & { prize: TicketPrize })[] {
  return tickets
    .filter((ticket): ticket is MyTicket & { prize: TicketPrize } => ticket.prize !== null && !isDeadlinePassed(ticket.prize.claimDeadlineAt, now))
    .sort((a, b) => {
      if (a.prize.isJackpot !== b.prize.isJackpot) return a.prize.isJackpot ? -1 : 1;
      const diff = compareAmounts(b.prize.totalCashToman, a.prize.totalCashToman);
      if (diff !== 0) return diff;
      return Date.parse(b.draw.drawAt) - Date.parse(a.draw.drawAt);
    });
}

/**
 * The tickets shown on the order-confirmation page: exactly the tickets of the order just
 * placed (every line, in line order) — the confirmed copies when the confirmation belongs to
 * this order, never tickets from any earlier order.
 */
export function confirmationTickets(order: Order, confirmation: ConfirmOrderResult | null) {
  const tickets = confirmation && confirmation.order.id === order.id ? confirmation.tickets : order.tickets;
  return [...tickets].sort((a, b) => a.lineNumber - b.lineNumber);
}

/** My Tickets link scoped to one draw (a public draw id — never a token or secret). */
export function drawTicketsHref(drawId: string): string {
  return `/account/tickets?drawId=${encodeURIComponent(drawId)}`;
}
