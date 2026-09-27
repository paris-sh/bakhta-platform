import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestGame } from "../helpers/fixtures.js";

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

async function loginAdminWith(app: FastifyInstance, db: Database, permissionCodes: string[]) {
  const admin = await createTestAdmin(db, { password: "correct-horse-battery", permissionCodes });
  const login = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email: admin.email, password: "correct-horse-battery" },
  });
  return { admin, token: login.json().token as string };
}

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

  describe("generating draws from the schedule", () => {
    it("materializes real draw rows for a daily schedule, and is idempotent on a second call", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });

      const first = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 6 },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toHaveLength(7); // day 0..6 inclusive, every day active

      // Calling again for the same window creates nothing new — idempotent.
      const second = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 6 },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toHaveLength(0);

      const rows = await db
        .selectFrom("draws")
        .selectAll()
        .where("game_id", "=", created.game.id)
        .execute();
      expect(rows).toHaveLength(7);
    });

    it("snapshots current_rule_version_id and current_rules_snapshot at creation time", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 0 },
      });
      const [draw] = response.json();
      expect(draw.currentRuleVersionId).toBe(created.ruleVersion.id);
      expect(draw.currentRulesSnapshot.ticket_price_toman).toBe(50000);
    });

    it("a later rule-version activation never rewrites an already-created draw's snapshot", async () => {
      const { admin, token } = await loginAdminWith(app, db, [
        "draws.create",
        "draws.view",
        "games.edit",
        "games.activate_rule_version",
      ]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });

      const generateResponse = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 0 },
      });
      const [existingDraw] = generateResponse.json();
      expect(existingDraw.currentRulesSnapshot.ticket_price_toman).toBe(50000);

      // Activate a new rule version with a different price for future draws.
      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            rules: { ...DAILY_FOUR_LEAF_RULES, ticket_price_toman: 99000 },
            changeReason: "Price increase for future draws",
          },
        })
      ).json();
      await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${draft.id}/activate`,
        headers: { authorization: `Bearer ${token}` },
      });

      // The EXISTING draw, re-fetched from the database, must still show the OLD price —
      // never silently rewritten by the later rule-version activation.
      const refetched = await app.inject({
        method: "GET",
        url: `/v1/admin/draws/${existingDraw.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(refetched.json().currentRuleVersionId).toBe(created.ruleVersion.id);
      expect(refetched.json().currentRulesSnapshot.ticket_price_toman).toBe(50000);
    });

    it("rejects generating draws for a game with no ACTIVE rule version", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create", "games.activate_rule_version"]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });
      // Retire the only ACTIVE version by activating nothing — instead, directly flip it
      // to RETIRED to simulate "no active version" without a real second version to promote.
      await db
        .updateTable("game_rule_versions")
        .set({ status: "RETIRED", retired_at: new Date() })
        .where("id", "=", created.ruleVersion.id)
        .execute();

      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 0 },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("public next-draw endpoint", () => {
    it("404s when no draw has been generated yet, then returns the materialized draw after generation", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.create"]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });

      const before = await app.inject({ method: "GET", url: `/v1/games/${created.game.slug}/draws/next` });
      expect(before.statusCode).toBe(404);

      await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { horizonDays: 3 },
      });

      const after = await app.inject({ method: "GET", url: `/v1/games/${created.game.slug}/draws/next` });
      expect(after.statusCode).toBe(200);
      expect(after.json().gameId).toBe(created.game.id);
      expect(after.json().status).toBe("SALES_OPEN");
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
    it("rejects generating draws without draws.create", async () => {
      const { admin, token } = await loginAdminWith(app, db, ["draws.view"]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/draws/generate`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("draw evidence", () => {
    it("records evidence, rejects a second evidence row for the same draw, and updates status/timing only", async () => {
      const { admin, token } = await loginAdminWith(app, db, [
        "draws.create",
        "draws.manage_evidence",
      ]);
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });
      const [draw] = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/draws/generate`,
          headers: { authorization: `Bearer ${token}` },
          payload: { horizonDays: 0 },
        })
      ).json();

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
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: DAILY_FOUR_LEAF_RULES,
      });
      const [draw] = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/draws/generate`,
          headers: { authorization: `Bearer ${token}` },
          payload: { horizonDays: 0 },
        })
      ).json();

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
