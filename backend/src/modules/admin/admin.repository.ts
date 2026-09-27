import { sql } from "kysely";
import type { Database } from "../../db/client.js";
import type { DrawStatusEnum, GameTypeEnum, OrderStatusEnum, PurchaserTypeEnum } from "../../db/types.js";

// Read-only queries for the admin panel. Every list is filtered and paginated in SQL — the
// browser never receives more than one page.

export interface Page {
  page: number;
  pageSize: number;
}

export interface DrawListFilters extends Page {
  gameId?: string | undefined;
  state?: DrawStateFilter | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/** UPCOMING/OPEN/CLOSED apply the sales window; anything else is a lifecycle status. */
export type DrawStateFilter =
  | "UPCOMING"
  | "OPEN"
  | "OPEN_OR_UPCOMING"
  | "SALES_CLOSED"
  | Exclude<DrawStatusEnum, "SALES_OPEN" | "SALES_CLOSED">;

export interface OrderListFilters extends Page {
  gameId?: string | undefined;
  drawId?: string | undefined;
  purchaserType?: PurchaserTypeEnum | undefined;
  status?: OrderStatusEnum | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  orderNumber?: string | undefined;
}

export interface AuditListFilters extends Page {
  actor?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

const offset = (p: Page) => (p.page - 1) * p.pageSize;

export function createAdminRepository(db: Database) {
  return {
    // ------------------------------------------------------------------ dashboard

    async gamesWithActiveRules() {
      return db
        .selectFrom("games as g")
        .leftJoin("game_rule_versions as v", (join) =>
          join.onRef("v.game_id", "=", "g.id").on("v.status", "=", "ACTIVE"),
        )
        .select([
          "g.id",
          "g.code",
          "g.game_type",
          "g.slug",
          "g.name_en",
          "g.name_fa",
          "g.status",
          "v.id as active_rule_version_id",
          "v.version_number as active_rule_version_number",
          sql<string | null>`(v.rules ->> 'ticket_price_toman')`.as("active_ticket_price_toman"),
        ])
        .orderBy("g.code")
        .execute();
    },

    /** The draw each game's public page shows (earliest SALES_OPEN draw whose cutoff hasn't
     * passed) — the same rule as draws.repository#findNextOpenDraw. It may still be UPCOMING
     * (sales not started); callers classify it with drawSalesState. */
    async nextOpenDrawPerGame(now: Date) {
      return db
        .selectFrom("draws as d")
        .innerJoin("game_rule_versions as v", "v.id", "d.current_rule_version_id")
        .select([
          "d.id",
          "d.game_id",
          "d.draw_number",
          "d.status",
          "d.sales_opens_at",
          "d.sales_closes_at",
          "d.draw_at",
          "v.version_number as rule_version_number",
        ])
        .distinctOn("d.game_id")
        .where("d.status", "=", "SALES_OPEN")
        .where("d.sales_closes_at", ">", now)
        .orderBy("d.game_id")
        .orderBy("d.draw_at")
        .execute();
    },

    /** Draws saleable at `now` (the sales-window rule, not the SALES_OPEN status alone). */
    async countOpenDraws(now: Date) {
      const row = await db
        .selectFrom("draws")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("status", "=", "SALES_OPEN")
        .where("sales_opens_at", "<=", now)
        .where("sales_closes_at", ">", now)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async orderTotals() {
      const rows = await db
        .selectFrom("orders")
        .select([
          "purchaser_type",
          "status",
          (eb) => eb.fn.countAll<string>().as("orders"),
          (eb) => eb.fn.sum<string>("total_toman").as("value"),
        ])
        .groupBy(["purchaser_type", "status"])
        .execute();
      return rows.map((r) => ({
        purchaserType: r.purchaser_type,
        status: r.status,
        orders: Number(r.orders),
        value: String(r.value ?? "0"),
      }));
    },

    async confirmedTicketTotals() {
      const rows = await db
        .selectFrom("tickets")
        .select([
          "game_type",
          (eb) => eb.fn.countAll<string>().as("tickets"),
          (eb) => eb.fn.sum<string>("combination_count").as("combinations"),
        ])
        .where("status", "=", "CONFIRMED")
        .groupBy("game_type")
        .execute();
      return rows.map((r) => ({
        gameType: r.game_type as GameTypeEnum,
        tickets: Number(r.tickets),
        combinations: Number(r.combinations ?? 0),
      }));
    },

    /** Confirmed orders/tickets per Tehran calendar day since `since`. */
    async confirmedTrend(since: Date) {
      const orders = await db
        .selectFrom("orders")
        .select([
          sql<string>`to_char(confirmed_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD')`.as("day"),
          (eb) => eb.fn.countAll<string>().as("orders"),
          (eb) => eb.fn.sum<string>("total_toman").as("value"),
        ])
        .where("status", "=", "CONFIRMED")
        .where("confirmed_at", ">=", since)
        .groupBy("day")
        .execute();
      const tickets = await db
        .selectFrom("tickets as t")
        .innerJoin("orders as o", "o.id", "t.order_id")
        .select([
          sql<string>`to_char(o.confirmed_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD')`.as("day"),
          (eb) => eb.fn.countAll<string>().as("tickets"),
        ])
        .where("o.status", "=", "CONFIRMED")
        .where("o.confirmed_at", ">=", since)
        .groupBy("day")
        .execute();
      return { orders, tickets };
    },

    // ------------------------------------------------------------------ draws

    async listDraws(f: DrawListFilters, now: Date) {
      let q = db
        .selectFrom("draws as d")
        .innerJoin("games as g", "g.id", "d.game_id")
        .innerJoin("game_rule_versions as v", "v.id", "d.current_rule_version_id");
      if (f.gameId) q = q.where("d.game_id", "=", f.gameId);
      if (f.state === "UPCOMING") {
        q = q.where("d.status", "=", "SALES_OPEN").where("d.sales_opens_at", ">", now);
      } else if (f.state === "OPEN") {
        q = q
          .where("d.status", "=", "SALES_OPEN")
          .where("d.sales_opens_at", "<=", now)
          .where("d.sales_closes_at", ">", now);
      } else if (f.state === "OPEN_OR_UPCOMING") {
        q = q.where("d.status", "=", "SALES_OPEN").where("d.sales_closes_at", ">", now);
      } else if (f.state === "SALES_CLOSED") {
        q = q.where((eb) =>
          eb.or([
            eb("d.status", "=", "SALES_CLOSED"),
            eb.and([eb("d.status", "=", "SALES_OPEN"), eb("d.sales_closes_at", "<=", now)]),
          ]),
        );
      } else if (f.state) {
        q = q.where("d.status", "=", f.state);
      }
      if (f.from) q = q.where("d.draw_at", ">=", f.from);
      if (f.to) q = q.where("d.draw_at", "<", f.to);

      const total = await q.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
      const items = await q
        .select([
          "d.id",
          "d.game_id",
          "d.draw_number",
          "d.status",
          "d.sales_opens_at",
          "d.sales_closes_at",
          "d.draw_at",
          "d.official_timezone",
          "d.current_rule_version_id",
          "v.version_number as rule_version_number",
          sql<number>`(d.current_rules_snapshot ->> 'schema_version')::int`.as("rules_schema_version"),
          sql<string | null>`(d.current_rules_snapshot ->> 'ticket_price_toman')`.as("ticket_price_toman"),
          "g.code as game_code",
          "g.game_type",
          "g.name_en",
          "g.name_fa",
        ])
        .orderBy("d.draw_at", "asc")
        .orderBy("d.draw_number", "asc")
        .limit(f.pageSize)
        .offset(offset(f))
        .execute();
      return { items, total: Number(total.n) };
    },

    // ------------------------------------------------------------------ orders

    async listOrders(f: OrderListFilters) {
      let q = db
        .selectFrom("orders as o")
        .innerJoin("draws as d", "d.id", "o.draw_id")
        .innerJoin("games as g", "g.id", "d.game_id")
        .leftJoin("users as u", "u.id", "o.purchaser_user_id");
      if (f.gameId) q = q.where("d.game_id", "=", f.gameId);
      if (f.drawId) q = q.where("o.draw_id", "=", f.drawId);
      if (f.purchaserType) q = q.where("o.purchaser_type", "=", f.purchaserType);
      if (f.status) q = q.where("o.status", "=", f.status);
      if (f.from) q = q.where("o.created_at", ">=", f.from);
      if (f.to) q = q.where("o.created_at", "<", f.to);
      if (f.orderNumber) q = q.where("o.order_number", "ilike", `%${f.orderNumber.replace(/[%_\\]/g, "\\$&")}%`);

      const total = await q.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
      const items = await q
        .select([
          "o.id",
          "o.order_number",
          "o.status",
          "o.purchaser_type",
          "o.guest_email",
          "o.total_toman",
          "o.created_at",
          "o.confirmed_at",
          "d.id as draw_id",
          "d.draw_number",
          "g.code as game_code",
          "g.game_type",
          "g.name_en",
          "g.name_fa",
          "u.user_number",
          "u.email as user_email",
          (eb) =>
            eb
              .selectFrom("tickets as t")
              .select((e2) => e2.fn.countAll<string>().as("c"))
              .whereRef("t.order_id", "=", "o.id")
              .as("ticket_count"),
          (eb) =>
            eb
              .selectFrom("tickets as t")
              .select((e2) => e2.fn.sum<string>("t.combination_count").as("s"))
              .whereRef("t.order_id", "=", "o.id")
              .as("combination_count"),
        ])
        .orderBy("o.created_at", "desc")
        .limit(f.pageSize)
        .offset(offset(f))
        .execute();
      return { items, total: Number(total.n) };
    },

    async findOrderSummary(orderId: string) {
      return db
        .selectFrom("orders as o")
        .innerJoin("draws as d", "d.id", "o.draw_id")
        .innerJoin("games as g", "g.id", "d.game_id")
        .leftJoin("users as u", "u.id", "o.purchaser_user_id")
        .select([
          "o.id",
          "o.order_number",
          "o.status",
          "o.purchaser_type",
          "o.guest_email",
          "o.subtotal_toman",
          "o.discount_toman",
          "o.total_toman",
          "o.created_at",
          "o.confirmed_at",
          "d.id as draw_id",
          "d.draw_number",
          "d.draw_at",
          "g.code as game_code",
          "g.game_type",
          "g.name_en",
          "g.name_fa",
          "u.user_number",
          "u.email as user_email",
        ])
        .where("o.id", "=", orderId)
        .executeTakeFirst();
    },

    async recentOrders(limit: number) {
      return this.listOrders({ page: 1, pageSize: limit });
    },

    // ------------------------------------------------------------------ audit

    async listAudit(f: AuditListFilters) {
      let q = db
        .selectFrom("audit_logs as a")
        .leftJoin("admin_accounts as ad", "ad.id", "a.actor_admin_id")
        .leftJoin("users as u", "u.id", "a.actor_user_id");
      if (f.actor) {
        const like = `%${f.actor.replace(/[%_\\]/g, "\\$&")}%`;
        q = q.where((eb) => eb.or([eb("ad.email", "ilike", like), eb("ad.admin_number", "ilike", like), eb("u.user_number", "ilike", like)]));
      }
      if (f.action) q = q.where("a.action", "ilike", `%${f.action.replace(/[%_\\]/g, "\\$&")}%`);
      if (f.entityType) q = q.where("a.entity_type", "=", f.entityType);
      if (f.entityId) q = q.where("a.entity_id", "=", f.entityId);
      if (f.from) q = q.where("a.created_at", ">=", f.from);
      if (f.to) q = q.where("a.created_at", "<", f.to);

      const total = await q.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
      const items = await q
        .select([
          "a.id",
          "a.created_at",
          "a.actor_type",
          "a.actor_admin_id",
          "ad.email as actor_admin_email",
          "ad.admin_number as actor_admin_number",
          "u.user_number as actor_user_number",
          "a.action",
          "a.entity_type",
          "a.entity_id",
          "a.changed_fields",
          "a.old_values",
          "a.new_values",
          "a.evidence",
          "a.reason",
          "a.severity",
          "a.request_id",
        ])
        .orderBy("a.created_at", "desc")
        .limit(f.pageSize)
        .offset(offset(f))
        .execute();
      return { items, total: Number(total.n) };
    },

    async auditEntityTypes() {
      const rows = await db.selectFrom("audit_logs").select("entity_type").distinct().orderBy("entity_type").execute();
      return rows.map((r) => r.entity_type);
    },
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;
