import { z } from "zod";

// Query/response schemas for the admin panel's read endpoints. Date filters are calendar
// days (YYYY-MM-DD) in the product's official timezone, Asia/Tehran; `to` is inclusive.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const salesState = z.enum(["UPCOMING", "OPEN", "CLOSED", "NOT_ON_SALE"]);

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const drawListQuerySchema = z.object({
  ...pageQuery,
  gameId: z.string().uuid().optional(),
  // Availability as the sales-window rule sees it (UPCOMING / OPEN / OPEN_OR_UPCOMING /
  // SALES_CLOSED, where SALES_CLOSED covers both SALES_CLOSED rows and SALES_OPEN rows past
  // their cutoff), or one of the later lifecycle statuses verbatim (e.g. CLOSED). A raw SALES_OPEN filter is deliberately not offered:
  // it would mix saleable and not-yet-open draws.
  state: z
    .enum([
      "UPCOMING",
      "OPEN",
      "OPEN_OR_UPCOMING",
      "SALES_CLOSED",
      "DRAW_IN_PROGRESS",
      "RESULT_ENTERED",
      "PENDING_REVIEW",
      "PUBLISHED",
      "SETTLED",
      "CLOSED",
      "DELAYED",
      "CANCELLED",
      "VOID",
    ])
    .optional(),
  from: day.optional(),
  to: day.optional(),
});

export const orderListQuerySchema = z.object({
  ...pageQuery,
  gameId: z.string().uuid().optional(),
  drawId: z.string().uuid().optional(),
  purchaserType: z.enum(["USER", "GUEST"]).optional(),
  status: z.enum(["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "CANCELLED", "REFUNDED"]).optional(),
  from: day.optional(),
  to: day.optional(),
  orderNumber: z.string().trim().min(1).max(64).optional(),
});

export const auditListQuerySchema = z.object({
  ...pageQuery,
  actor: z.string().trim().min(1).max(200).optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  from: day.optional(),
  to: day.optional(),
});

export const orderIdParamsSchema = z.object({ id: z.string().uuid() });

const gameRef = z.object({ code: z.string(), gameType: z.string(), nameEn: z.string(), nameFa: z.string() });

const customerRef = z.object({
  kind: z.enum(["USER", "GUEST"]),
  userNumber: z.string().nullable(),
  maskedEmail: z.string().nullable(),
});

const orderListItem = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string(),
  purchaserType: z.string(),
  customer: customerRef,
  totalToman: z.string(),
  ticketCount: z.number().int(),
  combinationCount: z.number().int(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  drawId: z.string().uuid(),
  drawNumber: z.string(),
  game: gameRef,
});

const auditItem = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  actor: z.object({
    type: z.string(),
    adminEmail: z.string().nullable(),
    adminNumber: z.string().nullable(),
    userNumber: z.string().nullable(),
  }),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  changedFields: z.array(z.string()),
  oldValues: z.unknown(),
  newValues: z.unknown(),
  evidence: z.unknown(),
  reason: z.string().nullable(),
  severity: z.string(),
  requestId: z.string().nullable(),
});

const pageEnvelope = { page: z.number().int(), pageSize: z.number().int(), total: z.number().int() };

export const dashboardResponseSchema = z.object({
  generatedAt: z.string(),
  activeGames: z.number().int(),
  openDraws: z.number().int(),
  games: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      gameType: z.string(),
      slug: z.string(),
      nameEn: z.string(),
      nameFa: z.string(),
      status: z.string(),
      activeRuleVersionNumber: z.number().int().nullable(),
      activeTicketPriceToman: z.string().nullable(),
      nextDraw: z
        .object({
          id: z.string().uuid(),
          drawNumber: z.string(),
          ruleVersionNumber: z.number().int(),
          salesOpensAt: z.string(),
          salesClosesAt: z.string(),
          drawAt: z.string(),
          salesState: salesState,
        })
        .nullable(),
    }),
  ),
  sales: z
    .object({
      confirmedOrders: z.number().int(),
      confirmedValueToman: z.string(),
      pendingPaymentOrders: z.number().int(),
      guest: z.object({ orders: z.number().int(), valueToman: z.string() }),
      registered: z.object({ orders: z.number().int(), valueToman: z.string() }),
      confirmedTickets: z.number().int(),
      sixChanceCombinations: z.number().int(),
      sixChanceTickets: z.number().int(),
      fourLeafTickets: z.number().int(),
      trend: z.array(
        z.object({ day: z.string(), orders: z.number().int(), valueToman: z.string(), tickets: z.number().int() }),
      ),
    })
    .nullable(),
  recentOrders: z.array(orderListItem).nullable(),
  recentAudit: z.array(auditItem).nullable(),
});

export const drawListResponseSchema = z.object({
  ...pageEnvelope,
  items: z.array(
    z.object({
      id: z.string().uuid(),
      gameId: z.string().uuid(),
      game: gameRef,
      drawNumber: z.string(),
      status: z.string(),
      salesOpensAt: z.string(),
      salesClosesAt: z.string(),
      drawAt: z.string(),
      officialTimezone: z.string(),
      ruleVersionId: z.string().uuid(),
      ruleVersionNumber: z.number().int(),
      rulesSchemaVersion: z.number().int(),
      ticketPriceToman: z.string().nullable(),
      salesState: salesState,
      isNextForGame: z.boolean(),
    }),
  ),
});

export const orderListResponseSchema = z.object({ ...pageEnvelope, items: z.array(orderListItem) });

const selection = z.union([
  z.object({ kind: z.literal("FOUR_LEAF"), numberValue: z.string() }),
  z.object({ kind: z.literal("SIX_CHANCE"), numbers: z.array(z.number().int()), symbol: z.number().int() }),
  z.object({
    kind: z.literal("SIX_CHANCE_SYSTEM"),
    numbers: z.array(z.number().int()),
    symbols: z.array(z.number().int()),
  }),
]);

export const orderDetailResponseSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string(),
  purchaserType: z.string(),
  customer: customerRef,
  subtotalToman: z.string(),
  discountToman: z.string(),
  totalToman: z.string(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  drawId: z.string().uuid(),
  drawNumber: z.string(),
  drawAt: z.string(),
  game: gameRef,
  ticketCount: z.number().int(),
  combinationCount: z.number().int(),
  tickets: z.array(
    z.object({
      id: z.string().uuid(),
      publicCode: z.string(),
      lineNumber: z.number().int(),
      status: z.string(),
      outcomeStatus: z.string(),
      isQuickPick: z.boolean(),
      ownedByAccount: z.boolean(),
      unitPriceToman: z.string(),
      combinationCount: z.number().int(),
      lineTotalToman: z.string(),
      selection,
    }),
  ),
});

export const auditListResponseSchema = z.object({
  ...pageEnvelope,
  entityTypes: z.array(z.string()),
  items: z.array(auditItem),
});

/** Start of a Tehran calendar day (Iran has no DST since 2022: fixed +03:30). */
export function tehranDayStart(value: string): Date {
  return new Date(`${value}T00:00:00+03:30`);
}

/** Exclusive end for an inclusive `to` day. */
export function tehranDayEndExclusive(value: string): Date {
  return new Date(tehranDayStart(value).getTime() + 86_400_000);
}
