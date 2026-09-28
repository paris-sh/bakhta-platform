import assert from "node:assert/strict";
import { test } from "node:test";
import { MESSAGES } from "./i18n/messages.ts";
import { bannerWinnings, confirmationTickets, drawTicketsHref, isDeadlinePassed, prizeHeadline, tierLabel } from "./prize.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FUTURE = "2026-12-27T12:00:00.000Z";
const PAST = "2026-09-01T12:00:00.000Z";

function prize(over = {}) {
  return {
    tierCode: "MAIN4_CHANCE",
    tierMatch: "4_MAIN_PLUS_CHANCE",
    isJackpot: false,
    awardType: "CASH",
    totalCashToman: "900000",
    freeTicketQuantity: 0,
    components: [],
    claimDeadlineAt: FUTURE,
    ...over,
  };
}

function myTicket(id, p, drawAt = "2026-09-20T17:30:00.000Z") {
  return { id, publicCode: `T-${id}`, lineNumber: 1, prize: p, claim: null, draw: { id: `d-${id}`, drawNumber: "7", drawAt, status: "PUBLISHED", game: { slug: "six-chance", gameType: "SIX_CHANCE", nameEn: "Six Chance", nameFa: "شش شانس" } } };
}

function ticket(id, lineNumber) {
  return { id, lineNumber, publicCode: `T-${id}` };
}

test("tier labels and winning-card headlines, in English and Persian", () => {
  const { en, fa } = MESSAGES;
  assert.equal(tierLabel("6_MAIN_PLUS_CHANCE", en), "6 numbers + symbol");
  assert.equal(tierLabel("5_MAIN", en), "5 numbers");
  assert.equal(tierLabel(null, en), "All four digits in order");
  assert.equal(tierLabel("4_MAIN_PLUS_CHANCE", fa), "۴ عدد + نماد");
  assert.equal(prizeHeadline(prize({ isJackpot: true, tierMatch: "6_MAIN_PLUS_CHANCE" }), en), "Jackpot winner");
  assert.equal(prizeHeadline(prize({ isJackpot: true }), fa), "برنده جک‌پات");
  assert.equal(prizeHeadline(prize(), en), "4 numbers + symbol");
});

test("the personal banner lists only live current awards — jackpot first, then largest prize", () => {
  const list = [
    myTicket("loser", null),
    myTicket("small", prize({ totalCashToman: "900000" })),
    myTicket("expired", prize({ totalCashToman: "99000000", claimDeadlineAt: PAST })),
    myTicket("big", prize({ totalCashToman: "15000000" })),
    myTicket("jackpot", prize({ isJackpot: true, totalCashToman: "50000000" })),
    myTicket("free", prize({ awardType: "FREE_TICKET", totalCashToman: "0", freeTicketQuantity: 2 })),
  ];
  assert.deepEqual(bannerWinnings(list, NOW).map((t) => t.id), ["jackpot", "big", "small", "free"]);
  // A user without any winning ticket gets no banner at all.
  assert.deepEqual(bannerWinnings([myTicket("a", null), myTicket("b", null)], NOW), []);
  // Amounts beyond Number precision still order exactly.
  const huge = [myTicket("x", prize({ totalCashToman: "90071992547409930" })), myTicket("y", prize({ totalCashToman: "90071992547409931" }))];
  assert.deepEqual(bannerWinnings(huge, NOW).map((t) => t.id), ["y", "x"]);
  assert.equal(isDeadlinePassed(PAST, NOW), true);
  assert.equal(isDeadlinePassed(FUTURE, NOW), false);
});

test("confirmation shows one ticket for a one-ticket order", () => {
  const order = { id: "o1", tickets: [ticket("a", 1)] };
  assert.deepEqual(confirmationTickets(order, null).map((t) => t.id), ["a"]);
});

test("confirmation shows every ticket of a multi-ticket order, in line order (never only the last)", () => {
  const order = { id: "o1", tickets: [ticket("a", 1), ticket("b", 2), ticket("c", 3)] };
  const confirmation = { order: { id: "o1" }, tickets: [ticket("c", 3), ticket("a", 1), ticket("b", 2)].map((t) => ({ ...t, claimToken: null })) };
  assert.deepEqual(confirmationTickets(order, confirmation).map((t) => t.id), ["a", "b", "c"]);
});

test("confirmation never mixes in tickets of another order for the same draw", () => {
  const second = { id: "o2", tickets: [ticket("d", 1)] };
  const staleFirst = { order: { id: "o1" }, tickets: [ticket("a", 1), ticket("b", 2)].map((t) => ({ ...t, claimToken: "tok" })) };
  assert.deepEqual(confirmationTickets(second, staleFirst).map((t) => t.id), ["d"]);
  const confirmedSecond = { order: { id: "o2" }, tickets: [{ ...ticket("d", 1), claimToken: "only-for-d" }] };
  assert.deepEqual(confirmationTickets(second, confirmedSecond).map((t) => t.claimToken), ["only-for-d"]);
});

test("the draw link carries only the draw id — never a token", () => {
  const href = drawTicketsHref("5f0c8c1e-2f1b-4a55-9b1a-1c2d3e4f5a6b");
  assert.equal(href, "/account/tickets?drawId=5f0c8c1e-2f1b-4a55-9b1a-1c2d3e4f5a6b");
  assert.doesNotMatch(href, /token|claim/i);
});
