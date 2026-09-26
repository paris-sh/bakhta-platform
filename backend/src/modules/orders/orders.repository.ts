import type { Database } from "../../db/client.js";
import type { GameTypeEnum } from "../../db/types.js";
import { generatePublicNumber } from "../../shared/identifiers.js";
import { isUniqueViolation } from "../../shared/db-errors.js";
import { generateClaimToken } from "./claim-token.js";

export type TicketSelectionShape =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; numbers: number[]; symbol: number };

export interface NewTicketInput {
  isQuickPick: boolean;
  selection:
    | { gameType: "FOUR_LEAF"; numberValue: string }
    | { gameType: "SIX_CHANCE"; numbers: [number, number, number, number, number, number]; symbol: number };
}

export interface CreateOrderInput {
  drawId: string;
  gameType: GameTypeEnum;
  purchaserType: "USER" | "GUEST";
  purchaserUserId: string | null;
  guestEmail: string | null;
  ruleVersionId: string;
  unitPriceToman: bigint;
  idempotencyKey: string;
  tickets: NewTicketInput[];
}

export type CreateOrderOutcome =
  | { outcome: "created"; orderId: string }
  | { outcome: "draw_not_open" }
  | { outcome: "sales_not_open_yet" }
  | { outcome: "sales_closed" }
  | { outcome: "idempotent_conflict" };

export type ConfirmOrderOutcome =
  | { outcome: "confirmed"; orderId: string }
  | { outcome: "not_found" }
  | { outcome: "invalid_status"; currentStatus: string }
  | { outcome: "sales_closed" };

async function attachSelections<T extends { id: string; game_type: GameTypeEnum }>(
  db: Database,
  tickets: T[],
): Promise<(T & { selection: TicketSelectionShape })[]> {
  const fourLeafIds = tickets.filter((t) => t.game_type === "FOUR_LEAF").map((t) => t.id);
  const sixChanceIds = tickets.filter((t) => t.game_type === "SIX_CHANCE").map((t) => t.id);

  const fourLeafRows = fourLeafIds.length
    ? await db
        .selectFrom("four_leaf_ticket_selections")
        .select(["ticket_id", "number_value"])
        .where("ticket_id", "in", fourLeafIds)
        .execute()
    : [];
  const sixChanceRows = sixChanceIds.length
    ? await db
        .selectFrom("six_chance_ticket_selections")
        .select(["ticket_id", "n1", "n2", "n3", "n4", "n5", "n6", "symbol"])
        .where("ticket_id", "in", sixChanceIds)
        .execute()
    : [];

  const map = new Map<string, TicketSelectionShape>();
  for (const r of fourLeafRows) map.set(r.ticket_id, { kind: "FOUR_LEAF", numberValue: r.number_value });
  for (const r of sixChanceRows) {
    map.set(r.ticket_id, {
      kind: "SIX_CHANCE",
      numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6],
      symbol: r.symbol,
    });
  }

  return tickets.map((t) => {
    const selection = map.get(t.id);
    if (!selection) {
      // The deferred cardinality trigger (migration 0017) guarantees this never happens for
      // a committed row; a failure here means the caller queried mid-transaction before the
      // matching selection insert, which is a programming error in this module, not
      // reachable via the API.
      throw new Error(`Ticket ${t.id} has no matching selection row`);
    }
    return { ...t, selection };
  });
}

export function createOrdersRepository(db: Database) {
  return {
    async findDrawById(drawId: string) {
      return db.selectFrom("draws").selectAll().where("id", "=", drawId).executeTakeFirst();
    },

    async findOrderByIdempotencyKey(idempotencyKey: string) {
      return db
        .selectFrom("orders")
        .selectAll()
        .where("idempotency_key", "=", idempotencyKey)
        .executeTakeFirst();
    },

    async findOrderById(orderId: string) {
      return db.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst();
    },

    async findTicketsForOrder(orderId: string) {
      const tickets = await db
        .selectFrom("tickets")
        .selectAll()
        .where("order_id", "=", orderId)
        .orderBy("line_number")
        .execute();
      return attachSelections(db, tickets);
    },

    async findOrdersForUser(userId: string) {
      return db
        .selectFrom("orders")
        .selectAll()
        .where("purchaser_user_id", "=", userId)
        .orderBy("created_at", "desc")
        .execute();
    },

    async findTicketsForUser(userId: string) {
      const tickets = await db
        .selectFrom("tickets")
        .selectAll()
        .where("owner_user_id", "=", userId)
        .orderBy("created_at", "desc")
        .execute();
      return attachSelections(db, tickets);
    },

    async findTicketCheckByPublicCode(publicCode: string) {
      const ticket = await db
        .selectFrom("tickets")
        .innerJoin("draws", "draws.id", "tickets.draw_id")
        .innerJoin("games", "games.id", "draws.game_id")
        .select([
          "tickets.id as id",
          "tickets.public_code as public_code",
          "tickets.game_type as game_type",
          "tickets.status as status",
          "tickets.outcome_status as outcome_status",
          "tickets.unit_price_toman as unit_price_toman",
          "draws.draw_number as draw_number",
          "draws.draw_at as draw_at",
          "draws.status as draw_status",
          "games.code as game_code",
          "games.slug as game_slug",
        ])
        .where("tickets.public_code", "=", publicCode)
        .executeTakeFirst();
      if (!ticket) return undefined;
      const [withSelection] = await attachSelections(db, [ticket]);
      return withSelection;
    },

    /**
     * One transaction: lock the draw, re-verify its status/sales-window (the authoritative
     * check — the pre-transaction read in the service layer is only used for pricing and
     * selection validation, both of which are immutable per-draw once created), insert the
     * order and every ticket + its matching selection row, in order. Catches a idempotency
     * key race (two concurrent identical retries) and reports it distinctly rather than
     * letting a raw constraint violation escape.
     */
    async createOrderWithTickets(input: CreateOrderInput): Promise<CreateOrderOutcome> {
      try {
        return await db.transaction().execute(async (trx) => {
          const draw = await trx
            .selectFrom("draws")
            .selectAll()
            .where("id", "=", input.drawId)
            .forUpdate()
            .executeTakeFirstOrThrow();

          if (draw.status !== "SALES_OPEN") return { outcome: "draw_not_open" as const };
          const now = new Date();
          if (now < draw.sales_opens_at) return { outcome: "sales_not_open_yet" as const };
          if (now > draw.sales_closes_at) return { outcome: "sales_closed" as const };

          const subtotal = input.unitPriceToman * BigInt(input.tickets.length);
          const order = await trx
            .insertInto("orders")
            .values({
              order_number: generatePublicNumber("ORD"),
              draw_id: input.drawId,
              purchaser_type: input.purchaserType,
              purchaser_user_id: input.purchaserUserId,
              guest_email: input.guestEmail,
              status: "PENDING_PAYMENT",
              subtotal_toman: subtotal.toString(),
              discount_toman: "0",
              total_toman: subtotal.toString(),
              idempotency_key: input.idempotencyKey,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          let lineNumber = 1;
          for (const ticketInput of input.tickets) {
            const ticket = await trx
              .insertInto("tickets")
              .values({
                public_code: generatePublicNumber("T"),
                order_id: order.id,
                draw_id: input.drawId,
                game_type: input.gameType,
                line_number: lineNumber,
                owner_user_id: input.purchaserUserId,
                status: "PENDING",
                outcome_status: "PENDING",
                unit_price_toman: input.unitPriceToman.toString(),
                rule_version_id: input.ruleVersionId,
                is_quick_pick: ticketInput.isQuickPick,
              })
              .returningAll()
              .executeTakeFirstOrThrow();

            if (ticketInput.selection.gameType === "FOUR_LEAF") {
              await trx
                .insertInto("four_leaf_ticket_selections")
                .values({ ticket_id: ticket.id, number_value: ticketInput.selection.numberValue })
                .execute();
            } else {
              const [n1, n2, n3, n4, n5, n6] = ticketInput.selection.numbers;
              await trx
                .insertInto("six_chance_ticket_selections")
                .values({
                  ticket_id: ticket.id,
                  n1,
                  n2,
                  n3,
                  n4,
                  n5,
                  n6,
                  symbol: ticketInput.selection.symbol,
                })
                .execute();
            }
            lineNumber += 1;
          }

          return { outcome: "created" as const, orderId: order.id };
        });
      } catch (err) {
        if (isUniqueViolation(err, "uq_orders_idempotency_key")) {
          return { outcome: "idempotent_conflict" as const };
        }
        throw err;
      }
    },

    /**
     * DEV-ONLY confirmation transaction (payment is deferred; see orders.routes.ts for the
     * environment guard). Locks the order then the draw, re-checks the cutoff under that
     * lock, flips order+tickets to CONFIRMED, and creates a Claim Credential ONLY for
     * tickets with a NULL owner_user_id (guest tickets) — registered-user tickets never get
     * one. The raw Claim Token exists only in this function's local variables and the
     * returned map; only its digest is ever written to a table.
     */
    async confirmOrder(
      orderId: string,
    ): Promise<
      ConfirmOrderOutcome & { rawClaimTokensByTicketId?: Map<string, string> }
    > {
      return db.transaction().execute(async (trx) => {
        const order = await trx
          .selectFrom("orders")
          .selectAll()
          .where("id", "=", orderId)
          .forUpdate()
          .executeTakeFirst();
        if (!order) return { outcome: "not_found" as const };
        if (order.status !== "PENDING_PAYMENT") {
          return { outcome: "invalid_status" as const, currentStatus: order.status };
        }

        const draw = await trx
          .selectFrom("draws")
          .selectAll()
          .where("id", "=", order.draw_id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const now = new Date();
        if (now > draw.sales_closes_at) return { outcome: "sales_closed" as const };

        await trx
          .updateTable("orders")
          .set({ status: "CONFIRMED", confirmed_at: now })
          .where("id", "=", orderId)
          .execute();

        const tickets = await trx
          .selectFrom("tickets")
          .select(["id", "owner_user_id"])
          .where("order_id", "=", orderId)
          .execute();

        const rawClaimTokensByTicketId = new Map<string, string>();
        for (const ticket of tickets) {
          await trx
            .updateTable("tickets")
            .set({ status: "CONFIRMED" })
            .where("id", "=", ticket.id)
            .execute();

          if (ticket.owner_user_id === null) {
            const { raw, digest } = generateClaimToken();
            await trx
              .insertInto("claim_credentials")
              .values({ ticket_id: ticket.id, token_digest: digest, status: "ACTIVE", created_reason: "INITIAL" })
              .execute();
            rawClaimTokensByTicketId.set(ticket.id, raw);
            // `raw` goes out of scope after this iteration; the only remaining copy lives
            // in rawClaimTokensByTicketId, which the service layer reads once to build the
            // HTTP response and then discards. Nothing here logs, audits, or persists it.
          }
        }

        return { outcome: "confirmed" as const, orderId, rawClaimTokensByTicketId };
      });
    },
  };
}

export type OrdersRepository = ReturnType<typeof createOrdersRepository>;
