import { z } from "zod";

export const orderIdParamsSchema = z.object({ id: z.string().uuid() });
export const publicCodeParamsSchema = z.object({ publicCode: z.string().min(1) });

export const ticketRequestSchema = z
  .object({
    isQuickPick: z.boolean().default(false),
    fourLeafNumber: z.string().regex(/^\d{4}$/).optional(),
    // Six Chance: 6 numbers for an exact pick, or a larger pool for a system line. The
    // per-draw maximum is enforced by the service from the draw's rule snapshot; this only
    // bounds the payload to what the game could ever allow (33 numbers, 5 symbols).
    sixChanceNumbers: z.array(z.number().int()).min(6).max(33).optional(),
    // One symbol (the original exact-pick field) OR a pool of symbols — not both.
    sixChanceSymbol: z.number().int().optional(),
    sixChanceSymbols: z.array(z.number().int()).min(1).max(5).optional(),
    // Deliberately no count/price fields: combination counts and every monetary amount are
    // recomputed server-side from the draw's snapshotted rule version. Unknown keys are
    // stripped by zod, so a client-supplied total can never reach the service.
  })
  .refine(
    (v) =>
      v.isQuickPick ||
      v.fourLeafNumber !== undefined ||
      (v.sixChanceNumbers !== undefined &&
        (v.sixChanceSymbol !== undefined || v.sixChanceSymbols !== undefined)),
    { message: "Provide a selection matching the draw's game, or set isQuickPick." },
  );

export const createOrderBodySchema = z.object({
  drawId: z.string().uuid(),
  // Required only for guest purchases (no session) — enforced in the service layer where
  // the actual purchaser type is known, not here (this schema can't see the auth header).
  guestEmail: z.string().email().optional(),
  tickets: z.array(ticketRequestSchema).min(1).max(50),
});

const selectionResponseSchema = z.union([
  z.object({ kind: z.literal("FOUR_LEAF"), numberValue: z.string() }),
  z.object({
    kind: z.literal("SIX_CHANCE"),
    numbers: z.array(z.number().int()),
    symbol: z.number().int(),
  }),
  // A system line: the stored pools only — the covered combinations are derived, never listed.
  z.object({
    kind: z.literal("SIX_CHANCE_SYSTEM"),
    numbers: z.array(z.number().int()),
    symbols: z.array(z.number().int()),
  }),
]);

export const ticketResponseSchema = z.object({
  id: z.string().uuid(),
  publicCode: z.string(),
  lineNumber: z.number().int(),
  status: z.string(),
  outcomeStatus: z.string(),
  unitPriceToman: z.string(),
  combinationCount: z.number().int(),
  lineTotalToman: z.string(),
  isQuickPick: z.boolean(),
  ownerUserId: z.string().uuid().nullable(),
  selection: selectionResponseSchema,
  duplicateInOrder: z.boolean(),
});

export const orderResponseSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  drawId: z.string().uuid(),
  purchaserType: z.string(),
  purchaserUserId: z.string().uuid().nullable(),
  guestEmail: z.string().nullable(),
  status: z.string(),
  subtotalToman: z.string(),
  discountToman: z.string(),
  totalToman: z.string(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  tickets: z.array(ticketResponseSchema),
});

export const orderListResponseSchema = z.array(orderResponseSchema);

export const myTicketsQuerySchema = z.object({
  // Narrows My Tickets to one draw (e.g. "all my tickets for this draw" after checkout).
  drawId: z.string().uuid().optional(),
});

// A ticket's CURRENT award exactly as stored by the published calculation run — the client
// never computes a prize. No award, result or run identifiers are exposed.
export const prizeResponseSchema = z.object({
  tierCode: z.string(),
  tierMatch: z.string().nullable(),
  isJackpot: z.boolean(),
  awardType: z.string(),
  totalCashToman: z.string(),
  freeTicketQuantity: z.number().int(),
  components: z.array(
    z.object({
      tierCode: z.string(),
      tierMatch: z.string().nullable(),
      isJackpot: z.boolean(),
      componentType: z.string(),
      amountToman: z.string().nullable(),
      freeTicketQuantity: z.number().int().nullable(),
      matchedCombinations: z.number().int(),
    }),
  ),
  claimDeadlineAt: z.string(),
});

/** Owner-only: the ticket's claim/payment record, when one exists. */
const claimStateSchema = z.object({
  status: z.string(),
  requiresManualReconciliation: z.boolean(),
  paidAt: z.string().nullable(),
});

export const myTicketResponseSchema = ticketResponseSchema.extend({
  draw: z.object({
    id: z.string().uuid(),
    drawNumber: z.string(),
    drawAt: z.string(),
    status: z.string(),
    game: z.object({ slug: z.string(), gameType: z.string(), nameEn: z.string(), nameFa: z.string() }),
  }),
  prize: prizeResponseSchema.nullable(),
  claim: claimStateSchema.nullable(),
});

export const myTicketListResponseSchema = z.array(myTicketResponseSchema);

export const confirmedTicketResponseSchema = ticketResponseSchema.extend({
  // Present (the raw token, returned exactly once) only for guest tickets, immediately
  // after confirmation. Always null for registered-user tickets, which never get a Claim
  // Credential at all.
  claimToken: z.string().nullable(),
});

export const confirmOrderResponseSchema = z.object({
  order: orderResponseSchema.omit({ tickets: true }),
  tickets: z.array(confirmedTicketResponseSchema),
});

export const publicTicketCheckResponseSchema = z.object({
  publicCode: z.string(),
  gameCode: z.string(),
  gameSlug: z.string(),
  drawNumber: z.string(),
  drawAt: z.string(),
  drawStatus: z.string(),
  selection: selectionResponseSchema,
  unitPriceToman: z.string(),
  combinationCount: z.number().int(),
  lineTotalToman: z.string(),
  status: z.string(),
  outcomeStatus: z.string(),
  // Public prize facts only (tier, amounts, components, deadline) — never the owner, the
  // order, the claim record or the Claim Token.
  prize: prizeResponseSchema.nullable(),
});
