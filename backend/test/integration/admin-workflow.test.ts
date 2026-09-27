import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, toSlotSchedule } from "../helpers/fixtures.js";

// Simplified operational workflow: direct settings edits, discarding unused drafts, manual
// draws, and SUPER_ADMIN result entry/publication before the draw time.

const PASSWORD = "correct-horse-battery";
const FOUR_LEAF_V2 = {
  schema_version: 2,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
    draw_time: "21:00",
    sales_open_hours_before_draw: 24,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  selection: { digits: 4, min: "0000", max: "9999", order_matters: true, leading_zero_allowed: true, repeated_digits_allowed: true },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
  claim_period_days: 90,
};
/** The creatable Four Leaf schema: FOUR_LEAF_V2 with its schedule as one slot. */
const FOUR_LEAF_NEW = { ...FOUR_LEAF_V2, schema_version: 3, schedule: toSlotSchedule(FOUR_LEAF_V2.schedule) };
const hours = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();

describe("simplified admin workflow", () => {
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

  async function superAdminRoleId() {
    const found = await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst();
    if (found) return found.id;
    return (await db.insertInto("roles").values({ code: "SUPER_ADMIN", name: "Super admin" }).returning("id").executeTakeFirstOrThrow()).id;
  }

  async function adminToken(permissionCodes: string[], opts: { superAdmin?: boolean } = {}) {
    const admin = await createTestAdmin(db, { password: PASSWORD, permissionCodes });
    if (opts.superAdmin) await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: await superAdminRoleId() }).execute();
    const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: PASSWORD } });
    return { admin, token: login.json().token as string };
  }

  const call = (method: "GET" | "PUT" | "POST" | "PATCH", url: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** A Four Leaf game with an ACTIVE v1, one open draw and one confirmed ticket. */
  async function gameWithSale() {
    const creator = await createTestAdmin(db, { password: "x" });
    const { game, draw, ruleVersion } = await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: creator.id, rules: { ...FOUR_LEAF_V2, schema_version: 1, claim_period_days: undefined } });
    const order = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { "idempotency-key": randomUUID() },
      payload: { drawId: draw.id, guestEmail: "buyer@example.com", tickets: [{ fourLeafNumber: "0427" }] },
    });
    expect((await app.inject({ method: "POST", url: `/v1/dev/orders/${order.json().id}/confirm` })).statusCode).toBe(200);
    return { game, draw, ruleVersion };
  }

  const drawFingerprint = async (drawId: string) => ({
    draw: await db.selectFrom("draws").selectAll().where("id", "=", drawId).executeTakeFirstOrThrow(),
    tickets: await db.selectFrom("tickets").selectAll().where("draw_id", "=", drawId).orderBy("id").execute(),
  });

  describe("game settings", () => {
    it("Save changes creates and activates a new version atomically; existing draws and tickets keep theirs", async () => {
      const { game, draw, ruleVersion } = await gameWithSale();
      const before = await drawFingerprint(draw.id);
      const { admin, token } = await adminToken([], { superAdmin: true });
      const nonSuper = await adminToken(["games.view", "games.edit", "games.activate_rule_version"]);
      const body = { rules: { ...FOUR_LEAF_NEW, ticket_price_toman: 60000 }, reason: "Price change approved by the board" };
      expect((await call("PUT", `/v1/admin/games/${game.id}/settings`, nonSuper.token, body)).statusCode).toBe(403);
      expect((await call("PUT", `/v1/admin/games/${game.id}/settings`, token, { ...body, reason: "no" })).statusCode).toBe(400);

      const saved = await call("PUT", `/v1/admin/games/${game.id}/settings`, token, body);
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ status: "ACTIVE", versionNumber: 2, changeReason: body.reason });
      const versions = await db.selectFrom("game_rule_versions").select(["id", "version_number", "status", "activated_by"]).where("game_id", "=", game.id).orderBy("version_number").execute();
      expect(versions.map((v) => [v.version_number, v.status])).toEqual([
        [1, "RETIRED"],
        [2, "ACTIVE"],
      ]);
      expect(versions[1]!.activated_by).toBe(admin.id);
      expect(await drawFingerprint(draw.id)).toEqual(before);
      expect(before.draw.current_rule_version_id).toBe(ruleVersion.id);
      const audit = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", versions[1]!.id).where("action", "=", "game_rule_versions.save_settings").executeTakeFirstOrThrow();
      expect(audit.reason).toBe(body.reason);

      // Only rules the creatable schema accepts can be saved.
      const legacy = await call("PUT", `/v1/admin/games/${game.id}/settings`, token, { rules: { ...FOUR_LEAF_V2, schema_version: 1 }, reason: "Old schema" });
      expect(legacy.statusCode).toBe(400);
    });

    it("discards an unused DRAFT (audited) but never an ACTIVE, RETIRED or referenced version", async () => {
      const { game, ruleVersion } = await gameWithSale();
      const { token } = await adminToken([], { superAdmin: true });
      const draft = (await call("POST", `/v1/admin/games/${game.id}/rule-versions`, token, { rules: FOUR_LEAF_NEW, changeReason: "Draft cloned from v1" })).json();
      const reason = { reason: "Created by mistake" };
      const nonSuper = await adminToken(["games.view", "games.edit"]);
      expect((await call("POST", `/v1/admin/rule-versions/${draft.id}/discard`, nonSuper.token, reason)).statusCode).toBe(403);

      const discarded = await call("POST", `/v1/admin/rule-versions/${draft.id}/discard`, token, reason);
      expect(discarded.json()).toEqual({ id: draft.id, versionNumber: 2, discarded: true });
      expect(await db.selectFrom("game_rule_versions").select("id").where("id", "=", draft.id).execute()).toHaveLength(0);
      const audit = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", draft.id).where("action", "=", "game_rule_versions.discard_draft").executeTakeFirstOrThrow();
      expect(audit).toMatchObject({ reason: "Created by mistake", actor_type: "ADMIN" });
      expect(audit.old_values).toMatchObject({ version_number: 2, status: "DRAFT", change_reason: "Draft cloned from v1" });
      expect((audit.old_values as { rules: { ticket_price_toman: number } }).rules.ticket_price_toman).toBe(50000);
      // The creation audit entry is still there.
      expect(await db.selectFrom("audit_logs").select("id").where("entity_id", "=", draft.id).where("action", "=", "game_rule_versions.create").execute()).toHaveLength(1);

      const active = await call("POST", `/v1/admin/rule-versions/${ruleVersion.id}/discard`, token, reason);
      expect(active.json().error.code).toBe("RULE_VERSION_NOT_DRAFT");

      // A draft that a draw references (only possible through a direct data fix) is kept.
      const referenced = (await call("POST", `/v1/admin/games/${game.id}/rule-versions`, token, { rules: FOUR_LEAF_NEW, changeReason: "Referenced draft" })).json();
      const creator = await createTestAdmin(db, { password: "x" });
      const other = await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: creator.id, rules: FOUR_LEAF_V2 });
      await db.updateTable("draws").set({ game_id: game.id, draw_number: "99", current_rule_version_id: referenced.id }).where("id", "=", other.draw.id).execute();
      const refused = await call("POST", `/v1/admin/rule-versions/${referenced.id}/discard`, token, reason);
      expect(refused.json().error).toMatchObject({ code: "RULE_VERSION_REFERENCED", details: { draws: 1 } });
      expect(await db.selectFrom("game_rule_versions").select("id").where("id", "=", referenced.id).execute()).toHaveLength(1);
    });
  });

  describe("manual draws", () => {
    it("creates a draw with the active version snapshot; unusual times need a reason but are never blocked", async () => {
      const { game, draw: existing } = await gameWithSale();
      const { token } = await adminToken([], { superAdmin: true });
      const url = `/v1/admin/games/${game.id}/draws`;
      const nonSuper = await adminToken(["draws.view", "draws.create"]);
      const normal = { salesOpensAt: hours(10), salesClosesAt: hours(20), drawAt: hours(21) };
      expect((await call("POST", url, nonSuper.token, normal)).statusCode).toBe(403);

      const plan = await call("POST", url, token, { ...normal, dryRun: true });
      expect(plan.json()).toMatchObject({ dryRun: true, warnings: [], openingJackpotToman: null, draw: null });
      const created = await call("POST", url, token, normal);
      expect(created.statusCode).toBe(201);
      const createdDraw = await db.selectFrom("draws").selectAll().where("id", "=", created.json().draw.id).executeTakeFirstOrThrow();
      const active = await db.selectFrom("game_rule_versions").selectAll().where("game_id", "=", game.id).where("status", "=", "ACTIVE").executeTakeFirstOrThrow();
      expect(createdDraw).toMatchObject({ current_rule_version_id: active.id, status: "SALES_OPEN", draw_number: "2" });

      // Overlapping the existing draw's sales window and starting in the past: warn, need a reason.
      const odd = { salesOpensAt: hours(-5), salesClosesAt: hours(0.5), drawAt: hours(0.6) };
      const warned = await call("POST", url, token, odd);
      expect(warned.statusCode).toBe(409);
      expect(warned.json().error.code).toBe("REASON_REQUIRED");
      expect(warned.json().error.details.warnings.map((w: { code: string }) => w.code)).toEqual(expect.arrayContaining(["SALES_OPENING_IN_PAST", "OVERLAPS_DRAW"]));
      const allowed = await call("POST", url, token, { ...odd, reason: "Board decision: special evening draw" });
      expect(allowed.statusCode).toBe(201);
      const audit = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", allowed.json().draw.id).where("action", "=", "draws.create_manual").executeTakeFirstOrThrow();
      expect(audit.reason).toBe("Board decision: special evening draw");

      // Physically impossible ordering is still invalid; a Four Leaf draw has no jackpot.
      expect((await call("POST", url, token, { salesOpensAt: hours(5), salesClosesAt: hours(4), drawAt: hours(6), reason: "Invalid order" })).statusCode).toBe(400);
      expect((await call("POST", url, token, { ...normal, openingJackpotToman: "100000000" })).statusCode).toBe(400);
      expect((await db.selectFrom("draws").select("id").where("id", "=", existing.id).executeTakeFirst())?.id).toBe(existing.id);
    });

    it("snapshots the Six Chance jackpot (entered or carried) and edits times with a reason, audited", async () => {
      const creator = await createTestAdmin(db, { password: "x" });
      const { game } = await createTestDraw(db, {
        gameType: "SIX_CHANCE",
        createdBy: creator.id,
        rules: { schema_version: 1, ticket_price_toman: 300000, minimum_jackpot_toman: 100000000, schedule: FOUR_LEAF_V2.schedule, tiers: [] },
      });
      const { token } = await adminToken([], { superAdmin: true });
      const url = `/v1/admin/games/${game.id}/draws`;
      const entered = await call("POST", url, token, { salesOpensAt: hours(30), salesClosesAt: hours(40), drawAt: hours(41), openingJackpotToman: "175000000" });
      expect(entered.json()).toMatchObject({ openingJackpotToman: "175000000", jackpotSource: "ENTERED" });
      const drawId = entered.json().draw.id;

      const edit = `/v1/admin/draws/${drawId}`;
      expect((await call("PATCH", edit, token, { drawAt: hours(42) })).json().error.code).toBe("REASON_REQUIRED");
      const moved = await call("PATCH", edit, token, { drawAt: hours(42), reason: "Broadcast moved by one hour" });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().draw.drawAt).toBe(hours(42).slice(0, 16) + moved.json().draw.drawAt.slice(16));
      const audit = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", drawId).where("action", "=", "draws.update_times").executeTakeFirstOrThrow();
      expect(audit.reason).toBe("Broadcast moved by one hour");
    });
  });

  describe("results before the draw time", () => {
    it("a SUPER_ADMIN may enter, preview and publish early with a reason (audited); others may not", async () => {
      const { draw } = await gameWithSale(); // sales still open, draw in 2h
      const before = await drawFingerprint(draw.id);
      const { token } = await adminToken([], { superAdmin: true });
      const enterer = await adminToken(["results.view", "results.enter"]);
      const draftUrl = `/v1/admin/results/draws/${draw.id}/draft`;
      expect((await call("PUT", draftUrl, enterer.token, { fourLeaf: { numberValue: "0427" }, earlyReason: "Testing early" })).json().error.code).toBe("DRAW_NOT_HELD_YET");

      const detail = (await call("GET", `/v1/admin/results/draws/${draw.id}`, token)).json();
      expect(detail).toMatchObject({ early: true, eligibleForEntry: true });
      expect((await call("PUT", draftUrl, token, { fourLeaf: { numberValue: "0427" } })).json().error.code).toBe("EARLY_REASON_REQUIRED");
      expect((await call("PUT", draftUrl, token, { fourLeaf: { numberValue: "0427" }, earlyReason: "Rehearsal before the live draw" })).statusCode).toBe(200);
      const preview = await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token);
      expect(preview.statusCode).toBe(200);
      expect(preview.json().summary.winningTickets).toBe(1);

      const publishBody = { resultId: preview.json().resultId, calculationHash: preview.json().calculationHash, reason: "Official result" };
      expect((await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, publishBody)).json().error.code).toBe("EARLY_REASON_REQUIRED");
      const nonSuper = await adminToken(["results.view", "results.enter", "results.publish"]);
      expect((await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, nonSuper.token, { ...publishBody, earlyReason: "Try" })).statusCode).toBe(403);
      const published = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, { ...publishBody, earlyReason: "Board approved early publication" });
      expect(published.statusCode).toBe(200);

      const audits = await db.selectFrom("audit_logs").select(["action", "reason"]).where("entity_id", "=", preview.json().resultId).where("action", "in", ["results.early_entry", "results.early_publication"]).orderBy("created_at").execute();
      expect(audits).toEqual([
        { action: "results.early_entry", reason: "Rehearsal before the live draw" },
        { action: "results.early_publication", reason: "Board approved early publication" },
      ]);
      // Tickets keep their purchase data; only the published outcome changed.
      const after = await drawFingerprint(draw.id);
      expect(after.tickets.map(({ outcome_status: _o, updated_at: _u, ...t }) => t)).toEqual(before.tickets.map(({ outcome_status: _o, updated_at: _u, ...t }) => t));
    });

    it("discards an unpublished draft (kept as VOID) and restores the draw's sales status", async () => {
      const { draw } = await gameWithSale();
      const { token } = await adminToken([], { superAdmin: true });
      const draftUrl = `/v1/admin/results/draws/${draw.id}/draft`;
      await call("PUT", draftUrl, token, { fourLeaf: { numberValue: "1111" }, earlyReason: "Rehearsal" });
      expect((await db.selectFrom("draws").select("status").where("id", "=", draw.id).executeTakeFirstOrThrow()).status).toBe("RESULT_ENTERED");

      const discard = await call("POST", `/v1/admin/results/draws/${draw.id}/draft/discard`, token, { reason: "Rehearsal finished" });
      expect(discard.json()).toEqual({ discardedVersion: 1, restoredDrawStatus: "SALES_OPEN" });
      const rows = await db.selectFrom("results").select(["version_number", "status"]).where("draw_id", "=", draw.id).execute();
      expect(rows).toEqual([{ version_number: 1, status: "VOID" }]);
      expect((await db.selectFrom("draws").select("status").where("id", "=", draw.id).executeTakeFirstOrThrow()).status).toBe("SALES_OPEN");
      expect((await call("POST", `/v1/admin/results/draws/${draw.id}/draft/discard`, token, { reason: "Nothing left" })).json().error.code).toBe("NO_DRAFT");

      // A new entry and publication still work afterwards; a published result cannot be discarded.
      expect((await call("PUT", draftUrl, token, { fourLeaf: { numberValue: "0427" }, earlyReason: "Real entry" })).json()).toMatchObject({ versionNumber: 2, isCorrection: false });
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      const pub = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: "Official", earlyReason: "Board approved" });
      expect(pub.statusCode).toBe(200);
      expect((await call("POST", `/v1/admin/results/draws/${draw.id}/draft/discard`, token, { reason: "Try to discard" })).json().error.code).toBe("NO_DRAFT");
      expect((await db.selectFrom("results").select("status").where("id", "=", preview.resultId).executeTakeFirstOrThrow()).status).toBe("PUBLISHED");
      // A re-entry after a discard is a normal first entry, not a correction.
      const reEntry = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", preview.resultId).execute();
      expect(reEntry.map((r) => r.action)).toContain("results.draft_create");
      expect(reEntry.map((r) => r.action)).not.toContain("results.correction_draft_create");
      const publicView = await call("GET", `/v1/results/${(await db.selectFrom("games").select("slug").where("id", "=", draw.game_id).executeTakeFirstOrThrow()).slug}/1`, null);
      expect(publicView.json().winning).toEqual({ kind: "FOUR_LEAF", numberValue: "0427" });
      expect(publicView.body).not.toMatch(/1111|discard|VOID|version/i);

      // Draw information stays editable after publication (reason required). Awards, claims and
      // the published result are not recalculated; the change is flagged for reconciliation.
      const editUrl = `/v1/admin/draws/${draw.id}`;
      const newDrawAt = new Date(draw.draw_at.getTime() + 10 * 60_000).toISOString();
      const plan = await call("PATCH", editUrl, token, { drawAt: newDrawAt, dryRun: true });
      expect(plan.statusCode).toBe(200);
      expect(plan.json().warnings.map((w: { code: string }) => w.code)).toContain("RESULT_PUBLISHED");
      expect((await call("PATCH", editUrl, token, { drawAt: newDrawAt })).json().error.code).toBe("REASON_REQUIRED");
      const awardsBefore = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).orderBy("id").execute();
      const edited = await call("PATCH", editUrl, token, { drawAt: newDrawAt, reason: "Broadcast log shows the real draw time" });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().draw.drawAt).toBe(newDrawAt);
      expect(await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).orderBy("id").execute()).toEqual(awardsBefore);
      const flag = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", draw.id).where("action", "=", "draws.reconciliation_required").executeTakeFirstOrThrow();
      expect(flag).toMatchObject({ severity: "WARNING", reason: "Broadcast log shows the real draw time" });
      // Structurally impossible windows are still refused.
      expect((await call("PATCH", editUrl, token, { salesClosesAt: newDrawAt, reason: "Close at the draw time" })).statusCode).toBe(400);
    });
  });
});
