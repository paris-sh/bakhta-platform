import { z } from "zod";

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const drawIdParamsSchema = z.object({ drawId: z.string().uuid() });

export const adminResultListQuerySchema = z.object({
  ...page,
  view: z.enum(["awaiting", "published"]).default("awaiting"),
  gameId: z.string().uuid().optional(),
});

const reason = z.string().trim().min(5, "must be at least 5 characters").max(2000);

export const saveDraftBodySchema = z
  .object({
    fourLeaf: z.object({ numberValue: z.string().regex(/^\d{4}$/, "must be exactly four digits") }).optional(),
    sixChance: z
      .object({
        drawOrder: z.array(z.number().int()).length(6, "must contain exactly six numbers"),
        symbol: z.number().int(),
      })
      .optional(),
    correctionReason: reason.optional(),
    /** SUPER_ADMIN only: required when entering a result before the draw has been held. */
    earlyReason: reason.optional(),
  })
  .refine((b) => (b.fourLeaf === undefined) !== (b.sixChance === undefined), {
    message: "Provide exactly one of fourLeaf or sixChance.",
  });

export const publishBodySchema = z.object({
  resultId: z.string().uuid(),
  calculationHash: z.string().regex(/^[0-9a-f]{64}$/, "must be the preview's calculation hash"),
  reason,
  /** Required when publishing before the scheduled draw time. */
  earlyReason: reason.optional(),
});

export const discardDraftBodySchema = z.object({ reason });

export const recordJackpotBodySchema = z.object({
  amountToman: z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive whole Toman amount"),
  reason: z.string().trim().min(5, "must be at least 5 characters").max(2000),
});

// ---------------------------------------------------------------- public

export const publicResultListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  game: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export const publicResultParamsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  drawNumber: z.string().regex(/^\d{1,18}$/),
});

// Public response shapes are explicit on purpose: serialization strips every field not
// listed here, so no internal identifier, version, reason or correction marker can leak.
const publicWinning = z.union([
  z.object({ kind: z.literal("FOUR_LEAF"), numberValue: z.string() }),
  z.object({
    kind: z.literal("SIX_CHANCE"),
    drawOrder: z.array(z.number().int()),
    sortedNumbers: z.array(z.number().int()),
    symbol: z.number().int(),
  }),
]);

const publicGame = z.object({ slug: z.string(), gameType: z.string(), nameEn: z.string(), nameFa: z.string() });

export const publicResultListResponseSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  items: z.array(
    z.object({
      game: publicGame,
      drawNumber: z.string(),
      drawAt: z.string(),
      publishedAt: z.string(),
      winning: publicWinning,
      winningRows: z.number().int(),
    }),
  ),
});

export const publicResultDetailResponseSchema = z.object({
  game: publicGame,
  drawNumber: z.string(),
  drawAt: z.string(),
  salesClosedAt: z.string(),
  publishedAt: z.string(),
  officialTimezone: z.string(),
  winning: publicWinning,
  confirmedTickets: z.number().int(),
  tiers: z.array(
    z.object({
      code: z.string(),
      match: z.string(),
      prizeType: z.string(),
      winningRows: z.number().int(),
      prizePerRowToman: z.string().nullable(),
      freeTicketsPerRow: z.number().int().nullable(),
      totalPrizeToman: z.string(),
    }),
  ),
  totalPrizeToman: z.string(),
  jackpot: z.object({ amountToman: z.string().nullable(), won: z.boolean(), nextJackpotToman: z.string().nullable() }).nullable(),
  evidence: z.object({ youtubeUrl: z.string() }).nullable(),
});
