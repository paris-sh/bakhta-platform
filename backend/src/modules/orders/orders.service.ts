import {
  ConflictError,
  DrawNotOnSaleError,
  ForbiddenError,
  NotFoundError,
  SalesClosedError,
  SalesNotOpenYetError,
  ValidationError,
} from "../../shared/errors.js";
import type { SalesWindowRejection } from "./orders.repository.js";

/** Maps a sales-window rejection to its specific API error. Messages are stable: the web
 * client keys its translations on them (and on the codes). */
function salesWindowError(rejection: SalesWindowRejection, stage: "create" | "confirm") {
  switch (rejection.outcome) {
    case "sales_not_open_yet":
      return new SalesNotOpenYetError("Sales have not opened yet for this draw.", {
        salesOpensAt: rejection.salesOpensAt.toISOString(),
      });
    case "sales_closed":
      return new SalesClosedError(
        stage === "confirm"
          ? "Sales have closed for this draw since the order was created."
          : "Sales have closed for this draw.",
        { salesClosesAt: rejection.salesClosesAt.toISOString() },
      );
    case "draw_not_open":
      return new DrawNotOnSaleError("This draw is not currently open for sales.", { drawStatus: rejection.status });
  }
}
import { resolveRulesValidator } from "../games/rules.schemas.js";
import type { FourLeafRulesV1, SixChanceRules } from "../games/rules.schemas.js";
import type { NewTicketInput, OrdersRepository, TicketSelectionShape } from "./orders.repository.js";
import {
  fourLeafSelectionKey,
  generateFourLeafQuickPick,
  generateSixChanceQuickPick,
  sixChanceLimits,
  sixChanceLinesOverlap,
  validateFourLeafSelection,
  validateSixChanceLine,
} from "./selections.js";

export type Purchaser = { type: "USER"; userId: string } | { type: "GUEST" };

export interface RawTicketRequest {
  isQuickPick: boolean;
  fourLeafNumber?: string | undefined;
  sixChanceNumbers?: number[] | undefined;
  sixChanceSymbol?: number | undefined;
  sixChanceSymbols?: number[] | undefined;
}

function toSelectionResponse(selection: TicketSelectionShape) {
  switch (selection.kind) {
    case "FOUR_LEAF":
      return { kind: "FOUR_LEAF" as const, numberValue: selection.numberValue };
    case "SIX_CHANCE":
      return { kind: "SIX_CHANCE" as const, numbers: selection.numbers, symbol: selection.symbol };
    case "SIX_CHANCE_SYSTEM":
      return { kind: "SIX_CHANCE_SYSTEM" as const, numbers: selection.numbers, symbols: selection.symbols };
  }
}

/** Number/symbol pools for any Six Chance selection (an exact pick is a 6×1 pool). */
function sixChancePools(selection: TicketSelectionShape) {
  if (selection.kind === "SIX_CHANCE") return { numbers: selection.numbers, symbols: [selection.symbol] };
  if (selection.kind === "SIX_CHANCE_SYSTEM") return { numbers: selection.numbers, symbols: selection.symbols };
  return null;
}

/** True when two lines of the same order would share at least one combination. */
function selectionsOverlap(a: TicketSelectionShape, b: TicketSelectionShape): boolean {
  if (a.kind === "FOUR_LEAF" || b.kind === "FOUR_LEAF") {
    return (
      a.kind === "FOUR_LEAF" &&
      b.kind === "FOUR_LEAF" &&
      fourLeafSelectionKey(a.numberValue) === fourLeafSelectionKey(b.numberValue)
    );
  }
  const pa = sixChancePools(a);
  const pb = sixChancePools(b);
  return pa !== null && pb !== null && sixChanceLinesOverlap(pa, pb);
}

function toTicketShape(
  ticket: {
    id: string;
    public_code: string;
    line_number: number;
    status: string;
    outcome_status: string;
    unit_price_toman: string;
    combination_count: number;
    line_total_toman: string | null;
    is_quick_pick: boolean;
    owner_user_id: string | null;
    selection: TicketSelectionShape;
  },
  duplicateInOrder: boolean,
) {
  return {
    id: ticket.id,
    publicCode: ticket.public_code,
    lineNumber: ticket.line_number,
    status: ticket.status,
    outcomeStatus: ticket.outcome_status,
    unitPriceToman: ticket.unit_price_toman,
    combinationCount: ticket.combination_count,
    lineTotalToman: ticket.line_total_toman ?? ticket.unit_price_toman,
    isQuickPick: ticket.is_quick_pick,
    ownerUserId: ticket.owner_user_id,
    selection: toSelectionResponse(ticket.selection),
    duplicateInOrder,
  };
}

/** Flags every line that shares at least one combination with another line of the same
 * order (identical picks, or overlapping system pools). Informational only — overlapping
 * lines are allowed by policy. Orders are capped at 50 lines, so pairwise is fine. */
function markDuplicates<T extends { selection: TicketSelectionShape }>(tickets: T[]) {
  return tickets.map((t, i) => ({
    ticket: t,
    duplicate: tickets.some((other, j) => j !== i && selectionsOverlap(t.selection, other.selection)),
  }));
}

function toOrderShape(
  order: {
    id: string;
    order_number: string;
    draw_id: string;
    purchaser_type: string;
    purchaser_user_id: string | null;
    guest_email: string | null;
    status: string;
    subtotal_toman: string;
    discount_toman: string;
    total_toman: string;
    confirmed_at: Date | null;
    created_at: Date;
  },
  tickets: ReturnType<typeof toTicketShape>[],
) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    drawId: order.draw_id,
    purchaserType: order.purchaser_type,
    purchaserUserId: order.purchaser_user_id,
    guestEmail: order.guest_email,
    status: order.status,
    subtotalToman: order.subtotal_toman,
    discountToman: order.discount_toman,
    totalToman: order.total_toman,
    confirmedAt: order.confirmed_at ? order.confirmed_at.toISOString() : null,
    createdAt: order.created_at.toISOString(),
    tickets,
  };
}

export function createOrdersService(repo: OrdersRepository) {
  async function getOrderShape(orderId: string) {
    const order = await repo.findOrderById(orderId);
    if (!order) throw new NotFoundError(`No order found with id "${orderId}".`);
    const tickets = await repo.findTicketsForOrder(orderId);
    const marked = markDuplicates(tickets);
    return toOrderShape(
      order,
      marked.map(({ ticket, duplicate }) => toTicketShape(ticket, duplicate)),
    );
  }

  return {
    async createOrder(
      input: { drawId: string; guestEmail?: string | undefined; tickets: RawTicketRequest[] },
      purchaser: Purchaser,
      idempotencyKey: string,
    ) {
      const existing = await repo.findOrderByIdempotencyKey(idempotencyKey);
      if (existing) {
        const callerUserId = purchaser.type === "USER" ? purchaser.userId : null;
        if (existing.purchaser_user_id !== callerUserId) {
          throw new ConflictError("This idempotency key was already used by a different purchaser.");
        }
        return getOrderShape(existing.id);
      }

      const draw = await repo.findDrawById(input.drawId);
      if (!draw) throw new NotFoundError(`No draw found with id "${input.drawId}".`);

      const snapshot = draw.current_rules_snapshot as Record<string, unknown>;
      const schemaVersion = snapshot.schema_version;
      const validator = resolveRulesValidator(
        draw.game_type,
        typeof schemaVersion === "number" ? schemaVersion : -1,
      );
      const parsedSnapshot = validator?.safeParse(snapshot);
      if (!validator || !parsedSnapshot?.success) {
        // The snapshot was already validated when the draw was created (Phase 4) — this
        // would mean the stored snapshot itself is corrupt, an internal invariant failure,
        // never a client-facing validation error.
        throw new Error(`Draw ${draw.id} has an invalid current_rules_snapshot`);
      }
      const rules = parsedSnapshot.data;

      if (purchaser.type === "GUEST" && !input.guestEmail) {
        throw new ValidationError("guestEmail is required for a guest order.");
      }

      const preparedTickets: NewTicketInput[] = input.tickets.map((t) =>
        draw.game_type === "FOUR_LEAF"
          ? prepareFourLeafTicket(t, rules as FourLeafRulesV1)
          : prepareSixChanceTicket(t, rules as SixChanceRules),
      );

      if (draw.game_type === "SIX_CHANCE") {
        const orderCap = sixChanceLimits(rules as SixChanceRules).maxCombinationsPerOrder;
        const totalCombinations = preparedTickets.reduce((sum, t) => sum + t.combinationCount, 0);
        if (orderCap !== null && totalCombinations > orderCap) {
          throw new ValidationError(
            `This order covers ${totalCombinations} combinations; the limit per order is ${orderCap}.`,
          );
        }
      }

      // The per-combination price always comes from the draw's snapshotted rule version;
      // line and order totals are computed from it server-side (never from the request).
      const unitPriceToman = BigInt(
        (rules as FourLeafRulesV1 | SixChanceRules).ticket_price_toman,
      );

      const result = await repo.createOrderWithTickets({
        drawId: input.drawId,
        gameType: draw.game_type,
        purchaserType: purchaser.type,
        purchaserUserId: purchaser.type === "USER" ? purchaser.userId : null,
        guestEmail: purchaser.type === "GUEST" ? (input.guestEmail ?? null) : null,
        ruleVersionId: draw.current_rule_version_id,
        unitPriceToman,
        idempotencyKey,
        tickets: preparedTickets,
      });

      switch (result.outcome) {
        case "draw_not_open":
        case "sales_not_open_yet":
        case "sales_closed":
          throw salesWindowError(result, "create");
        case "idempotent_conflict": {
          const winner = await repo.findOrderByIdempotencyKey(idempotencyKey);
          if (!winner) throw new Error("Idempotency conflict but no winning order found");
          return getOrderShape(winner.id);
        }
        case "created":
          return getOrderShape(result.orderId);
      }
    },

    async getOrder(orderId: string, requester: Purchaser) {
      const shape = await getOrderShape(orderId);
      if (requester.type === "USER" && shape.purchaserUserId !== requester.userId) {
        throw new ForbiddenError("This order does not belong to you.");
      }
      return shape;
    },

    async listOrdersForUser(userId: string) {
      const orders = await repo.findOrdersForUser(userId);
      const shapes = [];
      for (const order of orders) {
        shapes.push(await getOrderShape(order.id));
      }
      return shapes;
    },

    async listTicketsForUser(userId: string) {
      const tickets = await repo.findTicketsForUser(userId);
      return tickets.map((t) => toTicketShape(t, false));
    },

    async checkTicketByPublicCode(publicCode: string) {
      const ticket = await repo.findTicketCheckByPublicCode(publicCode);
      if (!ticket) throw new NotFoundError(`No ticket found with public code "${publicCode}".`);
      return {
        publicCode: ticket.public_code,
        gameCode: ticket.game_code,
        gameSlug: ticket.game_slug,
        drawNumber: ticket.draw_number,
        drawAt: ticket.draw_at.toISOString(),
        drawStatus: ticket.draw_status,
        selection: toSelectionResponse(ticket.selection),
        unitPriceToman: ticket.unit_price_toman,
        combinationCount: ticket.combination_count,
        lineTotalToman: ticket.line_total_toman ?? ticket.unit_price_toman,
        status: ticket.status,
        outcomeStatus: ticket.outcome_status,
      };
    },

    /** DEV-ONLY — see orders.routes.ts for the environment guard. Returns the raw Claim
     * Token for guest tickets exactly once; the caller (routes layer) must not log or
     * persist the response beyond sending it. */
    async confirmOrderDevOnly(orderId: string) {
      const result = await repo.confirmOrder(orderId);
      if (result.outcome === "not_found") {
        throw new NotFoundError(`No order found with id "${orderId}".`);
      }
      if (result.outcome === "invalid_status") {
        throw new ConflictError(
          `Order cannot be confirmed from its current status (${result.currentStatus}).`,
        );
      }
      if (
        result.outcome === "sales_closed" ||
        result.outcome === "sales_not_open_yet" ||
        result.outcome === "draw_not_open"
      ) {
        throw salesWindowError(result, "confirm");
      }

      const order = await repo.findOrderById(orderId);
      if (!order) throw new Error("Order vanished immediately after being confirmed");
      const tickets = await repo.findTicketsForOrder(orderId);
      const marked = markDuplicates(tickets);

      const ticketShapes = marked.map(({ ticket, duplicate }) => ({
        ...toTicketShape(ticket, duplicate),
        claimToken: result.rawClaimTokensByTicketId?.get(ticket.id) ?? null,
      }));

      const { tickets: _omit, ...orderShape } = toOrderShape(order, []);
      return { order: orderShape, tickets: ticketShapes };
    },
  };
}

function prepareFourLeafTicket(t: RawTicketRequest, rules: FourLeafRulesV1): NewTicketInput {
  if (t.sixChanceNumbers !== undefined || t.sixChanceSymbol !== undefined || t.sixChanceSymbols !== undefined) {
    throw new ValidationError("This draw is FOUR_LEAF; do not supply sixChanceNumbers/sixChanceSymbol.");
  }
  const numberValue = t.isQuickPick
    ? generateFourLeafQuickPick()
    : validateFourLeafSelection(rules, t.fourLeafNumber);
  return { isQuickPick: t.isQuickPick, combinationCount: 1, selection: { gameType: "FOUR_LEAF", numberValue } };
}

function prepareSixChanceTicket(t: RawTicketRequest, rules: SixChanceRules): NewTicketInput {
  if (t.fourLeafNumber !== undefined) {
    throw new ValidationError("This draw is SIX_CHANCE; do not supply fourLeafNumber.");
  }
  if (t.isQuickPick) {
    // Quick Pick remains an exact pick (6 numbers + 1 server-chosen symbol).
    const pick = generateSixChanceQuickPick(rules);
    return {
      isQuickPick: true,
      combinationCount: 1,
      selection: { gameType: "SIX_CHANCE", numbers: pick.numbers, symbol: pick.symbol },
    };
  }
  const line = validateSixChanceLine(rules, t.sixChanceNumbers, t.sixChanceSymbol, t.sixChanceSymbols);
  return line.kind === "EXACT"
    ? {
        isQuickPick: false,
        combinationCount: 1,
        selection: { gameType: "SIX_CHANCE", numbers: line.numbers, symbol: line.symbol },
      }
    : {
        isQuickPick: false,
        combinationCount: line.combinationCount,
        selection: { gameType: "SIX_CHANCE_SYSTEM", numbers: line.numbers, symbols: line.symbols },
      };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
