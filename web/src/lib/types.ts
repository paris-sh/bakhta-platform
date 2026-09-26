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
  };
  schedule: DrawSchedule;
  [key: string]: unknown;
}

export interface DrawSchedule {
  timezone: string;
  active_weekdays: number[];
  draw_time: string;
  sales_open_hours_before_draw: number;
  sales_close_minutes_before_draw: number;
  exceptions: unknown[];
}

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
  | { kind: "SIX_CHANCE"; numbers: number[]; symbol: number };

export interface Ticket {
  id: string;
  publicCode: string;
  lineNumber: number;
  status: string;
  outcomeStatus: string;
  unitPriceToman: string;
  isQuickPick: boolean;
  ownerUserId: string | null;
  selection: TicketSelection;
  duplicateInOrder: boolean;
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
  status: string;
  outcomeStatus: string;
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
  numbers: (number | null)[];
  symbol: number | null;
}

export type TicketDraft = TicketDraftFourLeaf | TicketDraftSixChance;
