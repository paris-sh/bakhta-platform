export type GameType = "SIX_CHANCE" | "FOUR_LEAF";

export interface FourLeafRules {
  schema_version: number;
  ticket_price_toman: number;
  fixed_prize_toman: number;
  selection: { digits: number; min: string; max: string };
  schedule: DrawSchedule;
  [key: string]: unknown;
}

export interface SixChanceRules {
  schema_version: number;
  ticket_price_toman: number;
  minimum_jackpot_toman: number;
  selection: {
    main_numbers: { count: number; min: number; max: number };
    chance_symbol: { min: number; max: number };
    // schema_version 2+: system-play limits (absent on v1 snapshots = exact picks only).
    required_numbers_per_combination?: number;
    maximum_selected_numbers_per_line?: number;
    maximum_selected_symbols_per_line?: number;
    maximum_combinations_per_line?: number;
    maximum_combinations_per_order?: number;
  };
  schedule: DrawSchedule;
  [key: string]: unknown;
}

/** A rule version's schedule as stored. Older versions use one draw time
 * (active_weekdays/draw_time); newer ones use any number of slots. Read it through
 * scheduleSlots() in lib/game.ts rather than trusting either shape. */
export interface LegacyDrawSchedule {
  timezone: string;
  active_weekdays: number[];
  draw_time: string;
  sales_open_hours_before_draw: number;
  sales_close_minutes_before_draw: number;
  exceptions: unknown[];
}

export interface DrawScheduleSlot {
  slot_id: string;
  enabled: boolean;
  label?: string | null;
  weekdays: number[];
  draw_time: string;
  timezone: string;
  sales_open_hours_before_draw: number;
  sales_close_minutes_before_draw: number;
}

export interface SlotDrawSchedule {
  slots: DrawScheduleSlot[];
  exceptions: unknown[];
}

export type DrawSchedule = LegacyDrawSchedule | SlotDrawSchedule;

export type GameRules = FourLeafRules | SixChanceRules;

export interface Game {
  id: string;
  code: string;
  gameType: GameType;
  slug: string;
  nameFa: string;
  nameEn: string;
  status: string;
  activeRules: GameRules | null;
  activeRuleVersionNumber: number | null;
}

export interface Draw {
  id: string;
  gameId: string;
  drawNumber: string;
  status: string;
  salesOpensAt: string;
  salesClosesAt: string;
  /** Server verdict at response time; only OPEN is purchasable (the server re-checks on order). */
  salesState: "UPCOMING" | "OPEN" | "CLOSED" | "NOT_ON_SALE";
  drawAt: string;
  officialTimezone: string;
  currentRuleVersionId: string;
  currentRulesSnapshot: GameRules;
  openingJackpotToman: string | null;
  finalJackpotToman: string | null;
  youtubeLiveUrl: string | null;
  publishedAt: string | null;
  settledAt: string | null;
}

export type TicketSelection =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; numbers: number[]; symbol: number }
  | { kind: "SIX_CHANCE_SYSTEM"; numbers: number[]; symbols: number[] };

export interface Ticket {
  id: string;
  publicCode: string;
  lineNumber: number;
  status: string;
  outcomeStatus: string;
  unitPriceToman: string;
  /** Combinations this line covers (1 for exact picks and Four Leaf). */
  combinationCount: number;
  /** unitPriceToman × combinationCount, computed by the server. */
  lineTotalToman: string;
  isQuickPick: boolean;
  ownerUserId: string | null;
  selection: TicketSelection;
  duplicateInOrder: boolean;
}

/** A ticket's CURRENT award exactly as the server stored it — never computed client-side. */
export interface TicketPrize {
  tierCode: string;
  /** Rule match pattern, e.g. "6_MAIN_PLUS_CHANCE" (null for Four Leaf's single tier). */
  tierMatch: string | null;
  isJackpot: boolean;
  awardType: "CASH" | "FREE_TICKET" | "MIXED" | string;
  totalCashToman: string;
  freeTicketQuantity: number;
  components: {
    tierCode: string;
    tierMatch: string | null;
    isJackpot: boolean;
    componentType: "CASH" | "FREE_TICKET" | string;
    amountToman: string | null;
    freeTicketQuantity: number | null;
    matchedCombinations: number;
  }[];
  claimDeadlineAt: string;
}

/** Owner-only claim/payment state (absent until a claim exists). */
export interface TicketClaimState {
  status: string;
  requiresManualReconciliation: boolean;
  paidAt: string | null;
}

/** A ticket as returned by My Tickets / My Winnings (the signed-in owner only). */
export interface MyTicket extends Ticket {
  draw: {
    id: string;
    drawNumber: string;
    drawAt: string;
    status: string;
    game: { slug: string; gameType: GameType; nameEn: string; nameFa: string };
  };
  prize: TicketPrize | null;
  claim: TicketClaimState | null;
}

export interface JackpotAnnouncement {
  game: { slug: string; gameType: GameType; nameEn: string; nameFa: string };
  drawNumber: string;
  drawAt: string;
  winningTickets: number;
  jackpotToman: string;
  /** How many winning tickets received each amount (a whole-Toman split may differ by 1). */
  sharesPerTicket: { amountToman: string; tickets: number }[];
}

export interface ConfirmedTicket extends Ticket {
  claimToken: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  drawId: string;
  purchaserType: "USER" | "GUEST";
  purchaserUserId: string | null;
  guestEmail: string | null;
  status: string;
  subtotalToman: string;
  discountToman: string;
  totalToman: string;
  confirmedAt: string | null;
  createdAt: string;
  tickets: Ticket[];
}

export type OrderWithoutTickets = Omit<Order, "tickets">;

export interface ConfirmOrderResult {
  order: OrderWithoutTickets;
  tickets: ConfirmedTicket[];
}

export interface PublicTicketCheck {
  publicCode: string;
  gameCode: string;
  gameSlug: string;
  drawNumber: string;
  drawAt: string;
  drawStatus: string;
  selection: TicketSelection;
  unitPriceToman: string;
  combinationCount: number;
  lineTotalToman: string;
  status: string;
  outcomeStatus: string;
  /** Public prize facts only — never owner, order, claim or Claim Token data. */
  prize: TicketPrize | null;
}

export interface MeResponse {
  id: string;
  userNumber: string;
  email: string;
  status: string;
  emailVerified: boolean;
}

export interface SessionResponse {
  token: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface TicketDraftFourLeaf {
  kind: "FOUR_LEAF";
  key: string;
  isQuickPick: boolean;
  fourLeafNumber: string;
}

export interface TicketDraftSixChance {
  kind: "SIX_CHANCE";
  key: string;
  isQuickPick: boolean;
  /** Selected number pool, kept sorted and distinct (6 = exact pick, more = system line). */
  numbers: number[];
  /** Selected chance-symbol ids (1–5), kept sorted and distinct. */
  symbols: number[];
}

export type TicketDraft = TicketDraftFourLeaf | TicketDraftSixChance;

// ---------------------------------------------------------------- public results
// Only the current published result; no internal identifiers, versions or history.

export type PublicWinning =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; drawOrder: number[]; sortedNumbers: number[]; symbol: number };

export interface PublicResultGame {
  slug: string;
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  nameEn: string;
  nameFa: string;
}

export interface PublicResultListItem {
  game: PublicResultGame;
  drawNumber: string;
  drawAt: string;
  publishedAt: string;
  winning: PublicWinning;
  winningRows: number;
}

export interface PublicResultDetail {
  game: PublicResultGame;
  drawNumber: string;
  drawAt: string;
  salesClosedAt: string;
  publishedAt: string;
  officialTimezone: string;
  winning: PublicWinning;
  confirmedTickets: number;
  tiers: {
    code: string;
    match: string;
    prizeType: string;
    winningRows: number;
    prizePerRowToman: string | null;
    freeTicketsPerRow: number | null;
    totalPrizeToman: string;
  }[];
  totalPrizeToman: string;
  jackpot: { amountToman: string | null; won: boolean; nextJackpotToman: string | null } | null;
  evidence: { youtubeUrl: string } | null;
}
