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
  | "audit.view";

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
