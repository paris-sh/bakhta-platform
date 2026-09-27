import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestGame, toSlotSchedule } from "../helpers/fixtures.js";

const DAILY_FOUR_LEAF_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6], // every day — deterministic occurrence count
    draw_time: "21:00",
    sales_open_hours_before_draw: 24,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  selection: {
    digits: 4,
    min: "0000",
    max: "9999",
    order_matters: true,
    leading_zero_allowed: true,
    repeated_digits_allowed: true,
  },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
};

async function loginAdminWith(app: FastifyInstance, db: Database, permissionCodes: string[], opts: { superAdmin?: boolean } = {}) {
  const admin = await createTestAdmin(db, { password: "correct-horse-battery", permissionCodes });
  if (opts.superAdmin) {
    const role = await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst();
    const roleId = role?.id ?? (await db.insertInto("roles").values({ code: "SUPER_ADMIN", name: "Super admin" }).returning("id").executeTakeFirstOrThrow()).id;
    await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: roleId }).execute();
  }
  const login = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email: admin.email, password: "correct-horse-battery" },
  });
  return { admin, token: login.json().token as string };
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const WINDOW = { salesOpensAt: inHours(1), salesClosesAt: inHours(20), drawAt: inHours(21) };

describe("draws module", () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(() => {
    const env = loadEnv();
    db = createDb(env);
    app = buildApp(env, db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const createDraw = (token: string, gameId: string, body: object = WINDOW) =>
    app.inject({ method: "POST", url: `/v1/admin/games/${gameId}/draws`, headers: { authorization: `Bearer ${token}` }, payload: body });

  describe("the schedule never creates draws", () => {
    it("has no batch-generation endpoint: the old route cannot create draws", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create", "draws.view"], { superAdmin: true });
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 14 },
      });
      expect(response.statusCode).toBe(404);
      expect(await db.selectFrom("draws").select("id").where("game_id", "=", created.game.id).execute()).toEqual([]);
    });

    it("the manual create snapshots current_rule_version_id and current_rules_snapshot", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"], { superAdmin: true });
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });
      const response = await createDraw(token, created.game.id);
      expect(response.statusCode).toBe(201);
      const { draw } = response.json();
      expect(draw.currentRuleVersionId).toBe(created.ruleVersion.id);
      expect(draw.currentRulesSnapshot.ticket_price_toman).toBe(50000);
      expect(draw.scheduledOccurrence).toBeNull(); // a special draw claims no occurrence
    });

    it("a later rule-version activation never rewrites an already-created draw's snapshot", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create", "draws.view", "games.edit", "games.activate_rule_version"], { superAdmin: true });
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });
      const existingDraw = (await createDraw(token, created.game.id)).json().draw;
      expect(existingDraw.currentRulesSnapshot.ticket_price_toman).toBe(50000);

      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            rules: { ...DAILY_FOUR_LEAF_RULES, schema_version: 3, claim_period_days: 90, schedule: toSlotSchedule(DAILY_FOUR_LEAF_RULES.schedule), ticket_price_toman: 99000 },
            changeReason: "Price increase for future draws",
          },
        })
      ).json();
      const activated = await app.inject({ method: "POST", url: `/v1/admin/rule-versions/${draft.id}/activate`, headers: { authorization: `Bearer ${token}` } });
      expect(activated.statusCode).toBe(200);

      const refetched = await app.inject({ method: "GET", url: `/v1/admin/draws/${existingDraw.id}`, headers: { authorization: `Bearer ${token}` } });
      expect(refetched.json().currentRuleVersionId).toBe(created.ruleVersion.id);
      expect(refetched.json().currentRulesSnapshot.ticket_price_toman).toBe(50000);
    });

    it("refuses to create a draw for a game with no ACTIVE rule version", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"], { superAdmin: true });
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });
      await db.updateTable("game_rule_versions").set({ status: "RETIRED", retired_at: new Date() }).where("id", "=", created.ruleVersion.id).execute();
      expect((await createDraw(token, created.game.id)).statusCode).toBe(409);
    });
  });

  describe("public next-draw endpoint", () => {
    it("404s until a SUPER_ADMIN creates a draw, then returns it (never derived from the schedule)", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"], { superAdmin: true });
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });

      const before = await app.inject({ method: "GET", url: `/v1/games/${created.game.slug}/draws/next` });
      expect(before.statusCode).toBe(404);

      await createDraw(token, created.game.id, { salesOpensAt: inHours(-1), salesClosesAt: inHours(20), drawAt: inHours(21), reason: "Open immediately" });
      const after = await app.inject({ method: "GET", url: `/v1/games/${created.game.slug}/draws/next` });
      expect(after.statusCode).toBe(200);
      expect(after.json().gameId).toBe(created.game.id);
      expect(after.json().status).toBe("SALES_OPEN");
      expect(after.json()).not.toHaveProperty("scheduledOccurrence"); // admin-only detail
    });

    it("skips a draw whose sales cutoff has passed even though its status is still SALES_OPEN", async () => {
      const admin = await createTestAdmin(db, { password: "correct-horse-battery" });
      const { game } = await createTestDraw(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
        salesOpensAt: new Date(Date.now() - 3 * 60 * 60_000),
        salesClosesAt: new Date(Date.now() - 60_000),
        drawAt: new Date(Date.now() + 30 * 60_000),
      });

      const response = await app.inject({ method: "GET", url: `/v1/games/${game.slug}/draws/next` });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("permission enforcement", () => {
    it("rejects creating draws without draws.create and SUPER_ADMIN", async () => {
      const viewer = await loginAdminWith(app, db, ["draws.view"]);
      const creator = await loginAdminWith(app, db, ["draws.view", "draws.create"]);
      const created = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: viewer.admin.id, rules: DAILY_FOUR_LEAF_RULES });
      expect((await createDraw(viewer.token, created.game.id)).statusCode).toBe(403);
      expect((await createDraw(creator.token, created.game.id)).statusCode).toBe(403);
      expect(await db.selectFrom("draws").select("id").where("game_id", "=", created.game.id).execute()).toEqual([]);
    });
  });

  describe("draw evidence", () => {
    it("records evidence, rejects a second evidence row for the same draw, and updates status/timing only", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create", "draws.manage_evidence"]);
      const { draw } = await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });

      const evidence = await app.inject({
        method: "POST",
        url: `/v1/admin/draws/${draw.id}/evidence`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          youtubeLiveUrl: "https://youtube.com/watch?v=abc123",
          youtubeVideoId: "abc123",
        },
      });
      expect(evidence.statusCode).toBe(201);
      expect(evidence.json().status).toBe("SCHEDULED");

      const duplicate = await app.inject({
        method: "POST",
        url: `/v1/admin/draws/${draw.id}/evidence`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          youtubeLiveUrl: "https://youtube.com/watch?v=xyz999",
          youtubeVideoId: "xyz999",
        },
      });
      expect(duplicate.statusCode).toBe(409);

      const statusUpdate = await app.inject({
        method: "PATCH",
        url: `/v1/admin/draw-evidence/${evidence.json().id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "LIVE" },
      });
      expect(statusUpdate.statusCode).toBe(200);
      expect(statusUpdate.json().status).toBe("LIVE");
      expect(statusUpdate.json().startedAt).not.toBeNull();
      // youtube_video_id is immutable — the update schema doesn't even accept the field.
      expect(statusUpdate.json().youtubeVideoId).toBe("abc123");
    });

    it("rejects managing evidence without draws.manage_evidence", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"]);
      const { draw } = await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: DAILY_FOUR_LEAF_RULES });

      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/draws/${draw.id}/evidence`,
        headers: { authorization: `Bearer ${token}` },
        payload: { youtubeLiveUrl: "https://youtube.com/watch?v=abc123", youtubeVideoId: "abc123" },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
