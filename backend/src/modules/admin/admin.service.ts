import { NotFoundError } from "../../shared/errors.js";
import { ADMIN_PERMISSIONS } from "../auth/permissions.js";
import type { OrdersRepository } from "../orders/orders.repository.js";
import type {
  AdminRepository,
  AuditListFilters,
  DrawListFilters,
  OrderListFilters,
} from "./admin.repository.js";
import { maskEmail, redactSensitive } from "./privacy.js";
import { drawSalesState } from "../draws/sales-window.js";

const TREND_DAYS = 14;
const RECENT_LIMIT = 8;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function gameRef(r: { game_code: string; game_type: string; name_en: string; name_fa: string }) {
  return { code: r.game_code, gameType: r.game_type, nameEn: r.name_en, nameFa: r.name_fa };
}

/** A customer as the admin panel may see them: registered users by user number, guests by
 * a masked email — never a full address. */
function customerRef(r: {
  purchaser_type: string;
  guest_email: string | null;
  user_number: string | null;
  user_email: string | null;
}) {
  return r.purchaser_type === "USER"
    ? { kind: "USER" as const, userNumber: r.user_number, maskedEmail: maskEmail(r.user_email) }
    : { kind: "GUEST" as const, userNumber: null, maskedEmail: maskEmail(r.guest_email) };
}

type OrderListRow = Awaited<ReturnType<AdminRepository["listOrders"]>>["items"][number];

function toOrderListItem(r: OrderListRow) {
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    purchaserType: r.purchaser_type,
    customer: customerRef(r),
    totalToman: String(r.total_toman),
    ticketCount: Number(r.ticket_count ?? 0),
    combinationCount: Number(r.combination_count ?? 0),
    createdAt: r.created_at.toISOString(),
    confirmedAt: iso(r.confirmed_at),
    drawId: r.draw_id,
    drawNumber: r.draw_number,
    game: gameRef(r),
  };
}

type AuditRow = Awaited<ReturnType<AdminRepository["listAudit"]>>["items"][number];

function toAuditItem(r: AuditRow) {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    actor: {
      type: r.actor_type,
      adminEmail: r.actor_admin_email,
      adminNumber: r.actor_admin_number,
      userNumber: r.actor_user_number,
    },
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    changedFields: r.changed_fields ?? [],
    oldValues: redactSensitive(r.old_values ?? null),
    newValues: redactSensitive(r.new_values ?? null),
    evidence: redactSensitive(r.evidence ?? null),
    reason: r.reason,
    severity: r.severity,
    requestId: r.request_id,
  };
}

/** YYYY-MM-DD for a Date in the product's official timezone (Asia/Tehran). */
function tehranDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

export function createAdminService(repo: AdminRepository, ordersRepo: OrdersRepository) {
  return {
    async getDashboard(permissions: string[], now = new Date()) {
      const canOrders = permissions.includes(ADMIN_PERMISSIONS.ORDERS_VIEW);
      const canAudit = permissions.includes(ADMIN_PERMISSIONS.AUDIT_VIEW);

      const [games, nextDraws, openDraws] = await Promise.all([
        repo.gamesWithActiveRules(),
        repo.nextOpenDrawPerGame(now),
        repo.countOpenDraws(now),
      ]);
      const nextByGame = new Map(nextDraws.map((d) => [d.game_id, d]));

      const gameSummaries = games.map((g) => {
        const next = nextByGame.get(g.id);
        return {
          id: g.id,
          code: g.code,
          gameType: g.game_type,
          slug: g.slug,
          nameEn: g.name_en,
          nameFa: g.name_fa,
          status: g.status,
          activeRuleVersionNumber: g.active_rule_version_number ?? null,
          activeTicketPriceToman: g.active_ticket_price_toman ?? null,
          nextDraw: next
            ? {
                id: next.id,
                drawNumber: next.draw_number,
                ruleVersionNumber: next.rule_version_number,
                salesOpensAt: next.sales_opens_at.toISOString(),
                salesClosesAt: next.sales_closes_at.toISOString(),
                drawAt: next.draw_at.toISOString(),
                salesState: drawSalesState(next, now),
              }
            : null,
        };
      });

      let sales = null;
      let recentOrders = null;
      if (canOrders) {
        const [orderTotals, ticketTotals, recent] = await Promise.all([
          repo.orderTotals(),
          repo.confirmedTicketTotals(),
          repo.recentOrders(RECENT_LIMIT),
        ]);
        const since = new Date(now.getTime() - (TREND_DAYS - 1) * 86_400_000);
        since.setUTCHours(0, 0, 0, 0);
        const trendRaw = await repo.confirmedTrend(new Date(since.getTime() - 86_400_000));

        const confirmed = orderTotals.filter((o) => o.status === "CONFIRMED");
        const sum = (rows: { value: string }[]) => rows.reduce((acc, r) => acc + BigInt(r.value), 0n).toString();
        const count = (rows: { orders: number }[]) => rows.reduce((acc, r) => acc + r.orders, 0);
        const byType = (t: string) => confirmed.filter((o) => o.purchaserType === t);

        const days: string[] = [];
        for (let i = TREND_DAYS - 1; i >= 0; i--) days.push(tehranDay(new Date(now.getTime() - i * 86_400_000)));
        const ordersByDay = new Map(trendRaw.orders.map((r) => [r.day, r]));
        const ticketsByDay = new Map(trendRaw.tickets.map((r) => [r.day, Number(r.tickets)]));

        sales = {
          confirmedOrders: count(confirmed),
          confirmedValueToman: sum(confirmed),
          pendingPaymentOrders: count(orderTotals.filter((o) => o.status === "PENDING_PAYMENT")),
          guest: { orders: count(byType("GUEST")), valueToman: sum(byType("GUEST")) },
          registered: { orders: count(byType("USER")), valueToman: sum(byType("USER")) },
          confirmedTickets: ticketTotals.reduce((acc, t) => acc + t.tickets, 0),
          sixChanceCombinations: ticketTotals.find((t) => t.gameType === "SIX_CHANCE")?.combinations ?? 0,
          sixChanceTickets: ticketTotals.find((t) => t.gameType === "SIX_CHANCE")?.tickets ?? 0,
          fourLeafTickets: ticketTotals.find((t) => t.gameType === "FOUR_LEAF")?.tickets ?? 0,
          trend: days.map((day) => ({
            day,
            orders: Number(ordersByDay.get(day)?.orders ?? 0),
            valueToman: String(ordersByDay.get(day)?.value ?? "0"),
            tickets: ticketsByDay.get(day) ?? 0,
          })),
        };
        recentOrders = recent.items.map(toOrderListItem);
      }

      let recentAudit = null;
      if (canAudit) {
        const audit = await repo.listAudit({ page: 1, pageSize: RECENT_LIMIT });
        recentAudit = audit.items.map(toAuditItem);
      }

      return {
        generatedAt: now.toISOString(),
        activeGames: games.filter((g) => g.status === "ACTIVE").length,
        openDraws,
        games: gameSummaries,
        sales,
        recentOrders,
        recentAudit,
      };
    },

    async listDraws(filters: DrawListFilters, now = new Date()) {
      const [{ items, total }, nextDraws] = await Promise.all([
        repo.listDraws(filters, now),
        repo.nextOpenDrawPerGame(now),
      ]);
      const nextIds = new Set(nextDraws.map((d) => d.id));
      return {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        items: items.map((d) => ({
          id: d.id,
          gameId: d.game_id,
          game: gameRef(d),
          drawNumber: d.draw_number,
          status: d.status,
          salesOpensAt: d.sales_opens_at.toISOString(),
          salesClosesAt: d.sales_closes_at.toISOString(),
          drawAt: d.draw_at.toISOString(),
          officialTimezone: d.official_timezone,
          ruleVersionId: d.current_rule_version_id,
          ruleVersionNumber: d.rule_version_number,
          rulesSchemaVersion: d.rules_schema_version,
          ticketPriceToman: d.ticket_price_toman,
          salesState: drawSalesState(d, now),
          isNextForGame: nextIds.has(d.id),
        })),
      };
    },

    async listOrders(filters: OrderListFilters) {
      const { items, total } = await repo.listOrders(filters);
      return { page: filters.page, pageSize: filters.pageSize, total, items: items.map(toOrderListItem) };
    },

    async getOrder(orderId: string) {
      const o = await repo.findOrderSummary(orderId);
      if (!o) throw new NotFoundError(`No order found with id "${orderId}".`);
      const tickets = await ordersRepo.findTicketsForOrder(orderId);
      return {
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        purchaserType: o.purchaser_type,
        customer: customerRef(o),
        subtotalToman: String(o.subtotal_toman),
        discountToman: String(o.discount_toman),
        totalToman: String(o.total_toman),
        createdAt: o.created_at.toISOString(),
        confirmedAt: iso(o.confirmed_at),
        drawId: o.draw_id,
        drawNumber: o.draw_number,
        drawAt: o.draw_at.toISOString(),
        game: gameRef(o),
        ticketCount: tickets.length,
        combinationCount: tickets.reduce((acc, t) => acc + t.combination_count, 0),
        // Only safe ticket fields: never a Claim Token, digest or credential.
        tickets: tickets.map((t) => ({
          id: t.id,
          publicCode: t.public_code,
          lineNumber: t.line_number,
          status: t.status,
          outcomeStatus: t.outcome_status,
          isQuickPick: t.is_quick_pick,
          ownedByAccount: t.owner_user_id !== null,
          unitPriceToman: String(t.unit_price_toman),
          combinationCount: t.combination_count,
          lineTotalToman: String(t.line_total_toman ?? t.unit_price_toman),
          selection: t.selection,
        })),
      };
    },

    async listAudit(filters: AuditListFilters) {
      const [{ items, total }, entityTypes] = await Promise.all([repo.listAudit(filters), repo.auditEntityTypes()]);
      return { page: filters.page, pageSize: filters.pageSize, total, entityTypes, items: items.map(toAuditItem) };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
