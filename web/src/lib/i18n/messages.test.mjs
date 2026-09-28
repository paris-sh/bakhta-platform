// Public dictionary checks (npm test): identical structure in both languages, and the exact
// approved wording for the order confirmation and winner experience.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MESSAGES } from "./messages.ts";

function shape(value, path = "") {
  if (typeof value === "function") return [`${path}:fn`];
  if (Array.isArray(value)) return [`${path}:array(${value.length})`];
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((k) => shape(value[k], path ? `${path}.${k}` : k));
  }
  return [`${path}:${typeof value}`];
}

test("English and Persian public dictionaries have identical structure", () => {
  assert.deepEqual(shape(MESSAGES.fa), shape(MESSAGES.en));
});

test("order confirmation wording names this order's tickets, not all of the user's", () => {
  const { en, fa } = MESSAGES;
  assert.equal(en.play.orderTickets, "Tickets in this order");
  assert.equal(fa.play.orderTickets, "بلیط‌های این سفارش");
  assert.equal(en.play.viewAllDrawTickets, "View all my tickets for this draw");
  assert.equal(fa.play.viewAllDrawTickets, "مشاهده همه بلیط‌های من برای این قرعه‌کشی");
  assert.equal(en.play.orderTicketsCount(1), "1 ticket");
  assert.equal(en.play.orderTicketsCount(3), "3 tickets");
  assert.equal(fa.play.orderTicketsCount(3), "۳ بلیط");
  assert.equal("yourTickets" in en.play, false);
});

test("winner banner, prize and jackpot announcement wording", () => {
  const { en, fa } = MESSAGES;
  assert.equal(en.winnerBanner.jackpotTitle, "Congratulations! You won the jackpot");
  assert.equal(fa.winnerBanner.jackpotTitle, "تبریک! شما برنده جک‌پات شدید");
  assert.equal(en.winnerBanner.viewDetails, "View prize details");
  assert.equal(fa.winnerBanner.viewDetails, "مشاهده جزئیات جایزه");
  assert.equal(en.prize.jackpotWinner, "Jackpot winner");
  assert.equal(fa.prize.jackpotWinner, "برنده جک‌پات");
  assert.equal(en.jackpotNews.headline, "This draw had a jackpot winner!");
  assert.equal(fa.jackpotNews.headline, "این دوره برنده جک‌پات داشت!");
  // Public copy talks about tickets, never people.
  for (const m of [en, fa]) {
    assert.doesNotMatch(JSON.stringify(m.jackpotNews), /email|owner|name|ایمیل|مالک/i);
  }
  for (const status of ["PENDING_REVIEW", "PAID", "SUPERSEDED"]) {
    assert.ok(en.prize.claimStatuses[status]);
    assert.ok(fa.prize.claimStatuses[status]);
  }
  assert.equal(fa.prize.freeRows(2), "۲ ردیف رایگان");
  assert.equal(en.prize.freeRows(1), "1 free row");
});

test("no claim-now action exists before the claim workflow", () => {
  for (const m of [MESSAGES.en, MESSAGES.fa]) {
    assert.doesNotMatch(JSON.stringify(m.prize) + JSON.stringify(m.winnerBanner), /claim now|اکنون دریافت/i);
  }
});
