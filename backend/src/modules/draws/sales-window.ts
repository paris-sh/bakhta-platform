// The single definition of "can this draw be bought right now". A draw row with status
// SALES_OPEN is only *scheduled* for sale: it is saleable exactly while
//   sales_opens_at <= now < sales_closes_at
// (opening instant inclusive, closing instant exclusive). Nothing moves draws between
// statuses on a timer, so every reader — order creation, order confirmation, the public
// next-draw endpoint and the admin views — must apply this window, never the status alone.
import type { DrawStatusEnum } from "../../db/types.js";

/**
 * UPCOMING    — status permits sales but sales_opens_at is still in the future.
 * OPEN        — saleable now.
 * CLOSED      — status permits sales but the cutoff has passed (no scheduler has moved it to
 *               SALES_CLOSED yet), or the draw is SALES_CLOSED.
 * NOT_ON_SALE — any later/other lifecycle status (in progress, results, settled, cancelled…).
 */
export type DrawSalesState = "UPCOMING" | "OPEN" | "CLOSED" | "NOT_ON_SALE";

export const SALES_PERMITTED_STATUS: DrawStatusEnum = "SALES_OPEN";

export function drawSalesState(
  draw: { status: string; sales_opens_at: Date; sales_closes_at: Date },
  now: Date,
): DrawSalesState {
  if (draw.status === "SALES_CLOSED") return "CLOSED";
  if (draw.status !== SALES_PERMITTED_STATUS) return "NOT_ON_SALE";
  if (now.getTime() < draw.sales_opens_at.getTime()) return "UPCOMING";
  if (now.getTime() >= draw.sales_closes_at.getTime()) return "CLOSED";
  return "OPEN";
}

export function isDrawSaleable(
  draw: { status: string; sales_opens_at: Date; sales_closes_at: Date },
  now: Date,
): boolean {
  return drawSalesState(draw, now) === "OPEN";
}
