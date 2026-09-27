import type { GameRules, TicketSelection } from "../types";

// Shapes returned by the admin API (backend/src/modules/admin/admin.schemas.ts and the
// existing admin games/draws/auth routes).

export type AdminPermission =
  | "dashboard.view"
  | "games.view"
  | "games.edit"
  | "games.activate_rule_version"
  | "draws.view"
  | "draws.create"
  | "draws.manage_evidence"
  | "orders.view"
  | "audit.view"
  | "results.view"
  | "results.enter"
  | "results.publish";

export interface AdminMe {
  id: string;
  adminNumber: string;
  email: string;
  status: string;
  roles: string[];
  permissions: string[];
}

export interface GameRef {
  code: string;
  gameType: string;
  nameEn: string;
  nameFa: string;
}

export interface Paged<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface CustomerRef {
  kind: "USER" | "GUEST";
  userNumber: string | null;
  maskedEmail: string | null;
}

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  purchaserType: string;
  customer: CustomerRef;
  totalToman: string;
  ticketCount: number;
  combinationCount: number;
  createdAt: string;
  confirmedAt: string | null;
  drawId: string;
  drawNumber: string;
  game: GameRef;
}

export interface AdminOrderTicket {
  id: string;
  publicCode: string;
  lineNumber: number;
  status: string;
  outcomeStatus: string;
  isQuickPick: boolean;
  ownedByAccount: boolean;
  unitPriceToman: string;
  combinationCount: number;
  lineTotalToman: string;
  selection: TicketSelection;
}

export interface AdminOrderDetail extends Omit<AdminOrderListItem, "ticketCount" | "combinationCount"> {
  subtotalToman: string;
  discountToman: string;
  drawAt: string;
  ticketCount: number;
  combinationCount: number;
  tickets: AdminOrderTicket[];
}

export interface AdminAuditItem {
  id: string;
  createdAt: string;
  actor: { type: string; adminEmail: string | null; adminNumber: string | null; userNumber: string | null };
  action: string;
  entityType: string;
  entityId: string;
  changedFields: string[];
  oldValues: unknown;
  newValues: unknown;
  evidence: unknown;
  reason: string | null;
  severity: string;
  requestId: string | null;
}

/** Backend sales-window verdict: only OPEN may be purchased right now. */
export type DrawSalesState = "UPCOMING" | "OPEN" | "CLOSED" | "NOT_ON_SALE";

export interface AdminDrawListItem {
  id: string;
  gameId: string;
  game: GameRef;
  drawNumber: string;
  status: string;
  salesOpensAt: string;
  salesClosesAt: string;
  drawAt: string;
  officialTimezone: string;
  ruleVersionId: string;
  ruleVersionNumber: number;
  rulesSchemaVersion: number;
  ticketPriceToman: string | null;
  salesState: DrawSalesState;
  isNextForGame: boolean;
}

export interface AdminDraw {
  id: string;
  gameId: string;
  drawNumber: string;
  status: string;
  salesOpensAt: string;
  salesClosesAt: string;
  salesState: DrawSalesState;
  drawAt: string;
  officialTimezone: string;
  currentRuleVersionId: string;
  currentRulesSnapshot: Record<string, unknown>;
  openingJackpotToman: string | null;
  finalJackpotToman: string | null;
  youtubeLiveUrl: string | null;
  publishedAt: string | null;
  settledAt: string | null;
  /** The scheduled occurrence this draw claimed at creation (kept when its times are edited). */
  scheduledOccurrence: ScheduledOccurrenceClaim | null;
}

export interface ScheduledOccurrenceClaim {
  slotId: string;
  localDate: string;
  scheduledDrawAt: string;
  timezone: string;
  claim: "SCHEDULED" | "REPLACEMENT";
}

export interface AdminDashboard {
  generatedAt: string;
  activeGames: number;
  openDraws: number;
  games: {
    id: string;
    code: string;
    gameType: string;
    slug: string;
    nameEn: string;
    nameFa: string;
    status: string;
    activeRuleVersionNumber: number | null;
    activeTicketPriceToman: string | null;
    nextDraw: {
      id: string;
      drawNumber: string;
      ruleVersionNumber: number;
      salesOpensAt: string;
      salesClosesAt: string;
      drawAt: string;
      salesState: DrawSalesState;
    } | null;
  }[];
  sales: {
    confirmedOrders: number;
    confirmedValueToman: string;
    pendingPaymentOrders: number;
    guest: { orders: number; valueToman: string };
    registered: { orders: number; valueToman: string };
    confirmedTickets: number;
    sixChanceCombinations: number;
    sixChanceTickets: number;
    fourLeafTickets: number;
    trend: { day: string; orders: number; valueToman: string; tickets: number }[];
  } | null;
  recentOrders: AdminOrderListItem[] | null;
  recentAudit: AdminAuditItem[] | null;
}

export interface AdminGame {
  id: string;
  code: string;
  gameType: "SIX_CHANCE" | "FOUR_LEAF";
  slug: string;
  nameFa: string;
  nameEn: string;
  status: string;
  activeRules: GameRules | null;
  activeRuleVersionNumber: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleVersion {
  id: string;
  gameId: string;
  versionNumber: number;
  status: "ACTIVE" | "DRAFT" | "RETIRED" | string;
  rules: Record<string, unknown>;
  changeReason: string;
  createdBy: string;
  activatedBy: string | null;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

// ---------------------------------------------------------------- results

export type WinningValue =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; drawOrder: number[]; symbol: number };

export interface ResultIssue {
  code: string;
  params?: Record<string, string | number | null>;
}

export interface ResultTier {
  code: string;
  match: string;
  prizeType: "CASH" | "FREE_TICKET" | "JACKPOT_POOL";
  winningCombinations: number;
  winningTickets: number;
  configuredAmountPerCombinationToman: string | null;
  amountPerCombinationToman: string | null;
  freeTicketsPerCombination: number | null;
  totalCashToman: string;
  totalFreeTickets: number;
  determined: boolean;
}

export interface ResultFinancials {
  formula: "JACKPOT_WON" | "NO_JACKPOT_WINNER" | "FIXED_PRIZE";
  revenueSource: string;
  confirmedSalesToman: string;
  lowerTierCashOriginalToman: string;
  lowerTierCashToman: string;
  lowerTierCap: null | {
    capToman: string;
    originalTotalToman: string;
    scalingFactor: { numerator: string; denominator: string; decimal: string };
    roundedTotalToman: string;
    remainderToman: string;
    remainderDestination: string | null;
    tiers: { code: string; originalPerCombinationToman: string; scaledPerCombinationToman: string; combinations: number }[];
  };
  jackpotPaidToman: string;
  totalCashPrizesToman: string;
  drawNetToman: string | null;
  remainingSalesToman: string | null;
  rolloverPercentBps: number | null;
  rolloverAdditionToman: string;
  bakhtaRetainedToman: string;
  bakhtaFundingRequiredToman: string;
  nextJackpotToman: string | null;
  freeRowsAwarded: number;
}

export interface ResultComponent {
  tierCode: string;
  componentType: "CASH" | "FREE_TICKET";
  amountToman: string | null;
  freeTicketQuantity: number | null;
  matchedCombinations: number;
}

export interface ResultSummary {
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  ruleVersionId: string;
  schemaVersion: number | null;
  winningValue: WinningValue;
  confirmedTickets: number;
  confirmedCombinations: number;
  confirmedSalesToman: string;
  winningTickets: number;
  tiers: ResultTier[];
  totalCashLiabilityToman: string;
  totalFreeTickets: number;
  fourLeaf: null | {
    fixedPrizeToman: string;
    totalPayoutCapToman: string;
    capApplied: boolean;
    perWinnerToman: string;
    roundingUnitToman: string;
    remainderToman: string;
    remainderDestination: string;
  };
  jackpot: null | {
    minimumJackpotToman: string | null;
    openingJackpotToman: string | null;
    winningCombinations: number;
    sharePerCombinationToman: string | null;
    extraOneTomanUnits: number;
    jackpotPaidToman: string;
    carriesOver: boolean;
    nextJackpotToman: string | null;
  };
  financials: ResultFinancials;
  claimPeriodDays: number;
  claimPeriodSource: "RULES" | "DEFAULT_FOR_HISTORICAL_RULES";
  claimDeadlineAt: string;
  warnings?: ResultIssue[];
}

export interface ResultDraw {
  id: string;
  game: GameRef & { id: string; slug: string };
  drawNumber: string;
  status: string;
  salesOpensAt: string;
  salesClosesAt: string;
  drawAt: string;
  officialTimezone: string;
  ruleVersionId: string;
  rulesSnapshot: Record<string, unknown>;
  openingJackpotToman: string | null;
  publishedAt: string | null;
}

export interface ResultListItem {
  draw: ResultDraw;
  draftVersion: number | null;
  confirmedTickets: number;
  published: null | {
    versionNumber: number;
    publishedAt: string;
    value: WinningValue;
    winningTickets: number;
    totalCashLiabilityToman: string;
    totalFreeTickets: number;
  };
}

export interface ResultVersion {
  id: string;
  versionNumber: number;
  status: "ENTERED" | "PENDING_REVIEW" | "PUBLISHED" | "SUPERSEDED" | "VOID";
  isPublicCurrent: boolean;
  value: WinningValue;
  correctionReason: string | null;
  publicationReason: string | null;
  enteredBy: string | null;
  enteredAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}

export interface ResultWinner {
  publicCode: string;
  tierCode: string;
  awardType: "CASH" | "FREE_TICKET" | "MIXED";
  amountToman: string | null;
  freeTicketQuantity: number | null;
  combinationCount?: number;
  components: ResultComponent[];
}

export interface ResultDownstream {
  drawNumber: string | null;
  currentToman: string | null;
  nextJackpotToman: string;
  action: "APPLY" | "UNCHANGED" | "REQUIRES_MANUAL_RECONCILIATION" | "NO_NEXT_DRAW";
}

export interface ResultDetail {
  draw: ResultDraw;
  eligibleForEntry: boolean;
  /** The draw time (or sales close) has not arrived yet. */
  early: boolean;
  hasPublishedResult: boolean;
  versions: ResultVersion[];
  draft: ResultVersion | null;
  jackpot: null | {
    currentToman: string | null;
    history: { id: string; previousToman: string | null; newToman: string | null; reason: string; actor: string; at: string; correctionDraftVersion: number | null }[];
  };
  evidence: null | { id: string; youtubeLiveUrl: string; youtubeVideoId: string; archiveUrl: string | null; status: string };
  published: null | {
    versionNumber: number;
    runNumber: number;
    approvedAt: string | null;
    calculationHash: string;
    summary: ResultSummary;
    winners: ResultWinner[];
  };
  runs: { id: string; status: string; runNumber: number; resultVersion: number; approvedAt: string | null; winningTickets: number; totalCashLiabilityToman: string }[];
}

export interface ResultPreview {
  resultId: string;
  versionNumber: number;
  isCorrection: boolean;
  downstream: ResultDownstream | null;
  summary: ResultSummary;
  warnings: ResultIssue[];
  blockers: ResultIssue[];
  calculationHash: string;
  canPublish: boolean;
  winners: ResultWinner[];
  winnersTotal: number;
}

export interface DraftInput {
  fourLeaf?: { numberValue: string };
  sixChance?: { drawOrder: number[]; symbol: number };
  correctionReason?: string;
  /** SUPER_ADMIN, before the draw time. */
  earlyReason?: string;
}

export interface DrawWarning {
  code: "SALES_OPENING_IN_PAST" | "SALES_CLOSING_IN_PAST" | "DRAW_TIME_IN_PAST" | "OVERLAPS_DRAW" | "SAME_DRAW_TIME" | "TICKETS_ALREADY_SOLD";
  params?: Record<string, string | number>;
}

export interface ManualDrawInput {
  salesOpensAt: string;
  salesClosesAt: string;
  drawAt: string;
  openingJackpotToman?: string;
  /** The settings version the form showed; the backend refuses if it is no longer active. */
  ruleVersionId?: string;
  /** Claim a scheduled occurrence (from a reminder, or a special draw replacing it). */
  occurrence?: { slotId: string; localDate: string; claim: "SCHEDULED" | "REPLACEMENT" };
  reason?: string;
  dryRun?: boolean;
}

/** One expected scheduled occurrence: identity (game, slotId, localDate). */
export interface ScheduledOccurrence {
  key: string;
  slotId: string;
  slotLabel: string | null;
  localDate: string;
  timezone: string;
  drawAt: string;
  salesOpensAt: string;
  salesClosesAt: string;
  /** UPCOMING: sales not yet due; OVERDUE: sales should be open, draw ahead; MISSED: draw time passed. */
  state: "UPCOMING" | "OVERDUE" | "MISSED";
}

/** Read-only reminders derived from the active schedule; viewing them never creates a draw. */
export interface GameReminders {
  gameId: string;
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  ruleVersion: { id: string; versionNumber: number };
  drawNumber: string;
  suggestedJackpotToman: string | null;
  jackpotSource: "LATEST_PUBLISHED_CALCULATION" | "MINIMUM" | null;
  slots: { slotId: string; label: string | null; enabled: boolean; drawTime: string; timezone: string; weekdays: number[] }[];
  occurrences: ScheduledOccurrence[];
  /** The occurrence the Create Draw form is prefilled with. */
  next: ScheduledOccurrence | null;
}
export interface ManualDrawResult {
  dryRun: boolean;
  warnings: DrawWarning[];
  ruleVersion: { id: string; versionNumber: number };
  openingJackpotToman: string | null;
  jackpotSource: "ENTERED" | "LATEST_PUBLISHED_CALCULATION" | "MINIMUM" | null;
  occurrence: (ScheduledOccurrence & { claim: "SCHEDULED" | "REPLACEMENT" }) | null;
  drawNumber: string;
  draw: AdminDraw | null;
}
