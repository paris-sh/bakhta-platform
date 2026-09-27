import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestGame, toSlotSchedule } from "../helpers/fixtures.js";

const VALID_FOUR_LEAF_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
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

// New rule versions must use the creatable schema_version (explicit claim period).
const CREATABLE_FOUR_LEAF_RULES = { ...VALID_FOUR_LEAF_RULES, schema_version: 3, claim_period_days: 90, schedule: toSlotSchedule(VALID_FOUR_LEAF_RULES.schedule) };

describe("games module", () => {
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

  describe("public endpoints", () => {
    it("lists the real seeded games with their active rules", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/games" });
      expect(response.statusCode).toBe(200);
      const games = response.json();
      const codes = games.map((g: { code: string }) => g.code);
      expect(codes).toContain("SIX_CHANCE");
      expect(codes).toContain("FOUR_LEAF");
      const fourLeaf = games.find((g: { code: string }) => g.code === "FOUR_LEAF");
      expect(fourLeaf.activeRules).not.toBeNull();
      expect(fourLeaf.activeRuleVersionNumber).toBeGreaterThanOrEqual(1);
    });

    it("fetches a single game by slug", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/games/four-leaf" });
      expect(response.statusCode).toBe(200);
      expect(response.json().code).toBe("FOUR_LEAF");
    });

    it("404s for an unknown slug", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/games/does-not-exist" });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("admin endpoints — permission enforcement", () => {
    it("rejects an admin without games.view", async () => {
      const admin = await createTestAdmin(db, { password: "correct-horse-battery" });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const gameRow = await db
        .selectFrom("games")
        .select("id")
        .where("code", "=", "FOUR_LEAF")
        .executeTakeFirstOrThrow();

      const response = await app.inject({
        method: "GET",
        url: `/v1/admin/games/${gameRow.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it("allows an admin with games.view", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.view"],
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const gameRow = await db
        .selectFrom("games")
        .select("id")
        .where("code", "=", "FOUR_LEAF")
        .executeTakeFirstOrThrow();

      const response = await app.inject({
        method: "GET",
        url: `/v1/admin/games/${gameRow.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().code).toBe("FOUR_LEAF");
    });
  });

  describe("game update", () => {
    it("updates name and status with games.edit, and rejects without it", async () => {
      const editorAdmin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: editorAdmin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });

      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: editorAdmin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const patch = await app.inject({
        method: "PATCH",
        url: `/v1/admin/games/${created.game.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { nameEn: "Renamed Test Game", status: "PAUSED" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().nameEn).toBe("Renamed Test Game");
      expect(patch.json().status).toBe("PAUSED");

      const viewerAdmin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.view"],
      });
      const viewerLogin = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: viewerAdmin.email, password: "correct-horse-battery" },
      });
      const deniedPatch = await app.inject({
        method: "PATCH",
        url: `/v1/admin/games/${created.game.id}`,
        headers: { authorization: `Bearer ${viewerLogin.json().token}` },
        payload: { nameEn: "Should not work" },
      });
      expect(deniedPatch.statusCode).toBe(403);
    });
  });

  describe("rule version lifecycle", () => {
    it("rejects a malformed rule payload (missing Four Leaf rounding keys)", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const { rounding_unit_toman: _r, remainder_destination: _d, ...invalidRules } = CREATABLE_FOUR_LEAF_RULES;

      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/rule-versions`,
        headers: { authorization: `Bearer ${token}` },
        payload: { rules: invalidRules, changeReason: "Testing invalid payload" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("creates a DRAFT rule version, activates it, and retires the previous ACTIVE one", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit", "games.activate_rule_version"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const newRules = { ...CREATABLE_FOUR_LEAF_RULES, ticket_price_toman: 75000 };
      const createResponse = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${created.game.id}/rule-versions`,
        headers: { authorization: `Bearer ${token}` },
        payload: { rules: newRules, changeReason: "Raise ticket price" },
      });
      expect(createResponse.statusCode).toBe(201);
      const draft = createResponse.json();
      expect(draft.status).toBe("DRAFT");
      expect(draft.versionNumber).toBe(2);

      const activateResponse = await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${draft.id}/activate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(activateResponse.statusCode).toBe(200);
      expect(activateResponse.json().status).toBe("ACTIVE");

      const oldVersion = await db
        .selectFrom("game_rule_versions")
        .selectAll()
        .where("id", "=", created.ruleVersion.id)
        .executeTakeFirstOrThrow();
      expect(oldVersion.status).toBe("RETIRED");
      expect(oldVersion.retired_at).not.toBeNull();

      const publicView = await app.inject({ method: "GET", url: `/v1/games/${created.game.slug}` });
      expect(publicView.json().activeRules.ticket_price_toman).toBe(75000);
    });

    it("rejects activating a rule version that is not DRAFT (e.g. already ACTIVE)", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.activate_rule_version"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${created.ruleVersion.id}/activate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("editing DRAFT rule versions", () => {
    it("updates a DRAFT's rules and changeReason, re-validating against its game_type + schema_version", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: { rules: CREATABLE_FOUR_LEAF_RULES, changeReason: "Draft v2" },
        })
      ).json();

      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${draft.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          rules: { ...CREATABLE_FOUR_LEAF_RULES, ticket_price_toman: 80000 },
          changeReason: "Revised price before activating",
        },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().rules.ticket_price_toman).toBe(80000);
      expect(patched.json().changeReason).toBe("Revised price before activating");
      expect(patched.json().status).toBe("DRAFT");
    });

    it("rejects updating a DRAFT with rules that fail validation for its schema_version", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();
      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: { rules: CREATABLE_FOUR_LEAF_RULES, changeReason: "Draft v2" },
        })
      ).json();

      const { schema_version: _sv, ...withoutVersion } = CREATABLE_FOUR_LEAF_RULES;
      const response = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${draft.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { rules: withoutVersion },
      });
      expect(response.statusCode).toBe(400);
    });

    it("refuses to update an ACTIVE or RETIRED rule version — immutability enforced, not just documented", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit", "games.activate_rule_version"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      // The ACTIVE v1 (created directly by the fixture) cannot be edited.
      const patchActive = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${created.ruleVersion.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { changeReason: "Trying to sneak an edit into ACTIVE" },
      });
      expect(patchActive.statusCode).toBe(409);

      // Create + activate v2, which retires v1 — RETIRED must be just as immutable.
      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: { rules: CREATABLE_FOUR_LEAF_RULES, changeReason: "Draft v2" },
        })
      ).json();
      await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${draft.id}/activate`,
        headers: { authorization: `Bearer ${token}` },
      });

      const patchRetired = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${created.ruleVersion.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { changeReason: "Trying to sneak an edit into RETIRED" },
      });
      expect(patchRetired.statusCode).toBe(409);
    });
  });

  describe("audit logging", () => {
    it("records an audit_logs entry for game update, rule-version create, and activate", async () => {
      const admin = await createTestAdmin(db, {
        password: "correct-horse-battery",
        permissionCodes: ["games.edit", "games.activate_rule_version"],
      });
      const created = await createTestGame(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: VALID_FOUR_LEAF_RULES,
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const { token } = login.json();

      await app.inject({
        method: "PATCH",
        url: `/v1/admin/games/${created.game.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { nameEn: "Audited Name" },
      });
      const draft = (
        await app.inject({
          method: "POST",
          url: `/v1/admin/games/${created.game.id}/rule-versions`,
          headers: { authorization: `Bearer ${token}` },
          payload: { rules: CREATABLE_FOUR_LEAF_RULES, changeReason: "Audited create" },
        })
      ).json();
      await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${draft.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { changeReason: "Audited update" },
      });
      await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${draft.id}/activate`,
        headers: { authorization: `Bearer ${token}` },
      });

      const entries = await db
        .selectFrom("audit_logs")
        .select(["action", "entity_type", "entity_id", "actor_admin_id"])
        .where("actor_admin_id", "=", admin.id)
        .orderBy("created_at")
        .execute();

      const actions = entries.map((e) => e.action);
      expect(actions).toContain("games.update");
      expect(actions).toContain("game_rule_versions.create");
      expect(actions).toContain("game_rule_versions.update");
      expect(actions).toContain("game_rule_versions.activate");
      expect(entries.every((e) => e.actor_admin_id === admin.id)).toBe(true);
    });
  });
});
