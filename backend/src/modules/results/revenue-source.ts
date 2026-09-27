// The draw's sales figure for prize accounting. The payment module is not implemented yet,
// so this is the stored total of CONFIRMED orders for the draw — honestly labelled
// "confirmed sales", NOT settled payment revenue. Free-row prize tickets carry no sales value
// (their orders total zero), so they add nothing here.
//
// Isolated on purpose: when the payment module lands, replace this one function with one
// that reads settled revenue, and give it its own `source` value so calculation summaries
// always say which figure they used.
import { sql, type Kysely } from "kysely";
import type { DB } from "../../db/types.js";
import type { SalesInput } from "./calculation.js";

export async function confirmedSalesForDraw(db: Kysely<DB>, drawId: string): Promise<SalesInput> {
  const row = await db
    .selectFrom("orders")
    .select(sql<string>`COALESCE(SUM(total_toman), 0)::text`.as("total"))
    .where("draw_id", "=", drawId)
    .where("status", "=", "CONFIRMED")
    .executeTakeFirstOrThrow();
  return { amountToman: BigInt(row.total), source: "CONFIRMED_ORDER_TOTALS" };
}
