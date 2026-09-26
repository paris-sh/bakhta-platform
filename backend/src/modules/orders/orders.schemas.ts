import { z } from "zod";

export const orderIdParamsSchema = z.object({ id: z.string().uuid() });
export const publicCodeParamsSchema = z.object({ publicCode: z.string().min(1) });

export const ticketRequestSchema = z
  .object({
    isQuickPick: z.boolean().default(false),
    fourLeafNumber: z.string().regex(/^\d{4}$/).optional(),
    sixChanceNumbers: z.array(z.number().int()).length(6).optional(),
    sixChanceSymbol: z.number().int().optional(),
  })
  .refine(
    (v) =>
      v.isQuickPick ||
      v.fourLeafNumber !== undefined ||
      (v.sixChanceNumbers !== undefined && v.sixChanceSymbol !== undefined),
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
]);

export const ticketResponseSchema = z.object({
  id: z.string().uuid(),
  publicCode: z.string(),
  lineNumber: z.number().int(),
  status: z.string(),
  outcomeStatus: z.string(),
  unitPriceToman: z.string(),
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
export const ticketListResponseSchema = z.array(ticketResponseSchema);

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
  status: z.string(),
  outcomeStatus: z.string(),
});
