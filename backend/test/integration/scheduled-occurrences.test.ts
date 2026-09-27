import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPsqlFileCapture } from "../../scripts/lib/psql.js";
import { SEEDS_DIR } from "../../scripts/lib/paths.js";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createAuditService } from "../../src/modules/audit/audit.service.js";
import { createDrawsRepository } from "../../src/modules/draws/draws.repository.js";
import { createDrawsService } from "../../src/modules/draws/draws.service.js";
import { localDateInZone } from "../../src/modules/draws/schedule.js";
import { createGamesRepository } from "../../src/modules/games/games.repository.js";
import { createTestAdmin, createTestGame } from "../helpers/fixtures.js";

// Reminder-only scheduling: the schedule never creates a draw. Occurrences are identified by
// (game, slot, local date); a SUPER_ADMIN's manual Create Draw may claim exactly one.

const PASSWORD = "correct-horse-battery";
const TZ = "Asia/Tehran";
const slot = (slot_id: string, draw_time: string, label: string) => ({
  slot_id,
  enabled: true,
  label,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  draw_time,
  timezone: TZ,
  sales_open_hours_before_draw: 3,
  sales_close_minutes_before_draw: 30,
});
const FOUR_LEAF_SLOTS = {
  schema_version: 3,
  schedule: { slots: [slot("afternoon", "14:00", "Afternoon"), slot("evening", "18:00", "Evening"), slot("night", "21:00", "Night")], exceptions: [] },
  selection: { digits: 4, min: "0000", max: "9999", order_matters: true, leading_zero_allowed: true, repeated_digits_allowed: true },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
  claim_period_days: 90,
};
/** A Tehran local date `days` from today. */
const tehranDate = (days: number) => localDateInZone(new Date(Date.now() + days * 86_400_000), TZ);
/** The UTC instant of HH:MM Tehran (+03:30) on `date`. */
const tehran = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:30`).toISOString();
const shift = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

describe("scheduled occurrences (reminders only)", () => {
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

  async function token(opts: { superAdmin?: boolean; permissions?: string[] } = { superAdmin: true }) {
    const admin = await createTestAdmin(db, { password: PASSWORD, permissionCodes: opts.permissions ?? [] });
    if (opts.superAdmin) {
      const role = await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst();
      const roleId = role?.id ?? (await db.insertInto("roles").values({ code: "SUPER_ADMIN", name: "Super admin" }).returning("id").executeTakeFirstOrThrow()).id;
      await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: roleId }).execute();
    }
    const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: PASSWORD } });
    return login.json().token as string;
  }
  const call = (method: "GET" | "POST" | "PATCH", url: string, tok: string | null, payload?: unknown) =>
    app.inject({ method, url, ...(tok ? { headers: { authorization: `Bearer ${tok}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** A Four Leaf game with three daily slots whose settings took effect `activatedDaysAgo` ago. */
  async function threeSlotGame(activatedDaysAgo = 0) {
    const creator = await createTestAdmin(db, { password: "x" });
    const { game, ruleVersion } = await createTestGame(db, { gameType: "FOUR_LEAF", createdBy: creator.id, rules: FOUR_LEAF_SLOTS });
    if (activatedDaysAgo) {
      await db.updateTable("game_rule_versions").set({ activated_at: new Date(Date.now() - activatedDaysAgo * 86_400_000) }).where("id", "=", ruleVersion.id).execute();
    }
    return { game, ruleVersion };
  }
  const drawsOf = (gameId: string) => db.selectFrom("draws").selectAll().where("game_id", "=", gameId).orderBy("draw_number").execute();
  const auditFor = async (gameId: string) => {
    const ids = [gameId, ...(await drawsOf(gameId)).map((d) => d.id)];
    const dismissals = await db.selectFrom("scheduled_occurrence_dismissals").select("id").where("game_id", "=", gameId).execute();
    return db.selectFrom("audit_logs").select("id").where("entity_id", "in", [...ids, ...dismissals.map((d) => d.id)]).execute();
  };
  /** Body claiming the rule-derived occurrence of `slotId` on `date`. */
  const scheduledBody = (ruleVersionId: string, slotId: string, date: string, hhmm: string) => ({
    salesOpensAt: shift(tehran(date, hhmm), -180),
    salesClosesAt: shift(tehran(date, hhmm), -30),
    drawAt: tehran(date, hhmm),
    ruleVersionId,
    occurrence: { slotId, localDate: date, claim: "SCHEDULED" },
  });

  it("viewing the dashboard reminders, a game's reminders and the form's dry run inserts nothing", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    const url = `/v1/admin/games/${game.id}/schedule/reminders`;
    expect((await call("GET", url, null)).statusCode).toBe(401);

    const reminders = (await call("GET", url, tok)).json();
    expect(reminders).toMatchObject({ gameId: game.id, ruleVersion: { id: ruleVersion.id, versionNumber: 1 }, drawNumber: "1", suggestedJackpotToman: null });
    expect(reminders.slots.map((s: { slotId: string }) => s.slotId)).toEqual(["afternoon", "evening", "night"]);
    expect(reminders.occurrences.length).toBeGreaterThanOrEqual(3);
    expect(new Set(reminders.occurrences.map((o: { slotId: string }) => o.slotId))).toEqual(new Set(["afternoon", "evening", "night"]));
    const list = (await call("GET", "/v1/admin/schedule/reminders", tok)).json();
    expect(list.items.find((i: { gameId: string }) => i.gameId === game.id)?.occurrences).toEqual(reminders.occurrences);

    const date = tehranDate(10);
    const dry = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "evening", date, "18:00"), dryRun: true });
    expect(dry.json()).toMatchObject({ dryRun: true, draw: null, warnings: [], occurrence: { slotId: "evening", localDate: date, claim: "SCHEDULED" } });

    expect(await drawsOf(game.id)).toEqual([]);
    expect(await auditFor(game.id)).toEqual([]);
  });

  it("the final submit creates exactly one draw that claims one slot's occurrence; the other slots stay reminded", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    const date = tehranDate(10);
    const created = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "afternoon", date, "14:00"));
    expect(created.statusCode).toBe(201);
    expect(created.json().draw.scheduledOccurrence).toEqual({ slotId: "afternoon", localDate: date, scheduledDrawAt: tehran(date, "14:00"), timezone: TZ, claim: "SCHEDULED" });

    const rows = await drawsOf(game.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scheduled_slot_id: "afternoon", schedule_timezone: TZ, schedule_claim: "SCHEDULED", current_rule_version_id: ruleVersion.id });
    expect(rows[0]!.scheduled_draw_at?.toISOString()).toBe(tehran(date, "14:00"));

    // 18:00 and 21:00 on that date remain claimable; 14:00 cannot be claimed twice.
    const evening = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "evening", date, "18:00"));
    expect(evening.statusCode).toBe(201);
    const twice = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "afternoon", date, "14:00"), reason: "Duplicate attempt" });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe("OCCURRENCE_TAKEN");
    expect(await drawsOf(game.id)).toHaveLength(2);
  });

  it("PostgreSQL itself prevents two live draws claiming the same game/slot/date and keeps the identity immutable", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    const date = tehranDate(11);
    const first = (await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "night", date, "21:00"))).json().draw;
    const row = (await drawsOf(game.id))[0]!;
    // A direct insert bypassing the application is refused by the unique index.
    await expect(
      db
        .insertInto("draws")
        .values({
          game_id: game.id,
          game_type: "FOUR_LEAF",
          draw_number: "99",
          sales_opens_at: row.sales_opens_at,
          sales_closes_at: row.sales_closes_at,
          draw_at: row.draw_at,
          official_timezone: TZ,
          current_rule_version_id: ruleVersion.id,
          current_rules_snapshot: JSON.stringify(FOUR_LEAF_SLOTS),
          scheduled_slot_id: "night",
          scheduled_local_date: date,
          scheduled_draw_at: row.draw_at,
          schedule_timezone: TZ,
          schedule_claim: "SCHEDULED",
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23505" });
    // The claim cannot be rewritten afterwards either.
    await expect(db.updateTable("draws").set({ scheduled_slot_id: "evening" }).where("id", "=", first.id).execute()).rejects.toThrow(/occurrence identity cannot be changed/);
  });

  it("editing the actual draw time keeps the original occurrence and consumes no other slot", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    const date = tehranDate(12);
    const draw = (await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "evening", date, "18:00"))).json().draw;
    // Move the 18:00 draw to 21:00 — the time of another slot.
    const moved = await call("PATCH", `/v1/admin/draws/${draw.id}`, tok, { salesClosesAt: shift(tehran(date, "21:00"), -30), drawAt: tehran(date, "21:00"), reason: "Studio booked for the evening" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().draw.scheduledOccurrence).toMatchObject({ slotId: "evening", localDate: date, scheduledDrawAt: tehran(date, "18:00") });
    // The 21:00 occurrence is still free and claimable.
    const night = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "night", date, "21:00"), reason: "Both draws are wanted" });
    expect(night.statusCode).toBe(201);
    expect(night.json().draw.scheduledOccurrence).toMatchObject({ slotId: "night" });
  });

  it("a special draw claims nothing by default (00:05 does not suppress 21:00); an explicit replacement does", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    const date = tehranDate(13);
    const special = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, {
      salesOpensAt: shift(tehran(date, "00:05"), -120),
      salesClosesAt: shift(tehran(date, "00:05"), -10),
      drawAt: tehran(date, "00:05"),
      ruleVersionId: ruleVersion.id,
      reason: "Special midnight draw",
    });
    expect(special.statusCode).toBe(201);
    expect(special.json().draw.scheduledOccurrence).toBeNull();

    // 21:00 on that date is still unclaimed: a scheduled draw can claim it.
    const replacement = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, {
      salesOpensAt: shift(tehran(date, "19:30"), -120),
      salesClosesAt: shift(tehran(date, "19:30"), -10),
      drawAt: tehran(date, "19:30"),
      ruleVersionId: ruleVersion.id,
      occurrence: { slotId: "night", localDate: date, claim: "REPLACEMENT" },
      reason: "Special draw replaces the 21:00 draw",
    });
    expect(replacement.statusCode).toBe(201);
    expect(replacement.json().warnings.map((w: { code: string }) => w.code)).toContain("DIFFERS_FROM_SCHEDULE");
    expect(replacement.json().draw.scheduledOccurrence).toMatchObject({ slotId: "night", localDate: date, claim: "REPLACEMENT", scheduledDrawAt: tehran(date, "21:00") });
    const again = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "night", date, "21:00"), reason: "Should fail" });
    expect(again.json().error.code).toBe("OCCURRENCE_TAKEN");
    // An occurrence that is not in the schedule cannot be claimed.
    const wrong = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "midnight", date, "21:00"), reason: "Unknown slot" });
    expect(wrong.json().error.code).toBe("OCCURRENCE_NOT_IN_SCHEDULE");
  });

  it("reports a missed occurrence; a SUPER_ADMIN may dismiss it with a reason (audited), after which it cannot be claimed", async () => {
    const { game, ruleVersion } = await threeSlotGame(3);
    const tok = await token();
    const viewer = await token({ permissions: ["draws.view", "draws.create"] });
    const yesterday = tehranDate(-1);
    const reminders = (await call("GET", `/v1/admin/games/${game.id}/schedule/reminders`, viewer)).json();
    const missed = reminders.occurrences.find((o: { slotId: string; localDate: string }) => o.slotId === "afternoon" && o.localDate === yesterday);
    expect(missed).toMatchObject({ state: "MISSED", drawAt: tehran(yesterday, "14:00") });
    // The rule-derived dates stay visible; days before the settings took effect never appear.
    expect(reminders.occurrences.every((o: { localDate: string }) => o.localDate >= tehranDate(-3))).toBe(true);

    const url = `/v1/admin/games/${game.id}/schedule/dismiss`;
    expect((await call("POST", url, viewer, { slotId: "afternoon", localDate: yesterday, reason: "Studio outage" })).statusCode).toBe(403);
    expect((await call("POST", url, tok, { slotId: "afternoon", localDate: yesterday, reason: "no" })).statusCode).toBe(400);
    const dismissed = await call("POST", url, tok, { slotId: "afternoon", localDate: yesterday, reason: "Studio outage, board decided to skip" });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().occurrences.some((o: { slotId: string; localDate: string }) => o.slotId === "afternoon" && o.localDate === yesterday)).toBe(false);
    const audit = await db.selectFrom("audit_logs").selectAll().where("action", "=", "draws.occurrence_dismiss").where("entity_type", "=", "scheduled_occurrence_dismissals").orderBy("created_at", "desc").executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ reason: "Studio outage, board decided to skip", severity: "WARNING" });

    const claim = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "afternoon", yesterday, "14:00"), reason: "Create it anyway" });
    expect(claim.json().error.code).toBe("OCCURRENCE_TAKEN");
    expect((await call("POST", url, tok, { slotId: "afternoon", localDate: yesterday, reason: "Dismiss twice" })).json().error.code).toBe("OCCURRENCE_TAKEN");

    // Creating a missed occurrence instead is allowed (past times need a reason).
    const late = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "evening", yesterday, "18:00"));
    expect(late.json().error.code).toBe("REASON_REQUIRED");
    const lateOk = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, { ...scheduledBody(ruleVersion.id, "evening", yesterday, "18:00"), reason: "Held privately, recorded late" });
    expect(lateOk.statusCode).toBe(201);
  });

  it("marks an overdue occurrence with its rule-derived times and needs no reason to create it unchanged", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const service = createDrawsService(createDrawsRepository(db), createGamesRepository(db), createAuditService(db));
    const date = tehranDate(0);
    await db.updateTable("game_rule_versions").set({ activated_at: new Date(`${date}T00:00:00+03:30`) }).where("id", "=", ruleVersion.id).execute();
    // 16:00 Tehran: 18:00's sales opened at 15:00 → overdue; 14:00 missed; 21:00 upcoming.
    const now = new Date(tehran(date, "16:00"));
    const r = await service.gameReminders(game.id, now);
    const byslot = Object.fromEntries(r.occurrences.filter((o) => o.localDate === date).map((o) => [o.slotId, o]));
    expect(byslot.afternoon?.state).toBe("MISSED");
    expect(byslot.evening).toMatchObject({ state: "OVERDUE", salesOpensAt: tehran(date, "15:00"), salesClosesAt: tehran(date, "17:30"), drawAt: tehran(date, "18:00") });
    expect(byslot.night?.state).toBe("UPCOMING");
    expect(r.next).toMatchObject({ slotId: "evening", state: "OVERDUE" });

    const dry = await service.createManualDraw(game.id, { ...scheduledBody(ruleVersion.id, "evening", date, "18:00"), occurrence: { slotId: "evening", localDate: date, claim: "SCHEDULED" }, dryRun: true }, "unused", { requestId: null, ipAddress: null, userAgent: null }, now);
    expect(dry.warnings).toEqual([]); // opening in the past is the schedule, not an anomaly
  });

  it("refuses a stale submission after the settings changed", async () => {
    const { game, ruleVersion } = await threeSlotGame();
    const tok = await token();
    await db.updateTable("game_rule_versions").set({ status: "RETIRED", retired_at: new Date() }).where("id", "=", ruleVersion.id).execute();
    const { id: _id, ...rest } = ruleVersion;
    await db.insertInto("game_rule_versions").values({ ...rest, version_number: 2, status: "ACTIVE", rules: JSON.stringify(FOUR_LEAF_SLOTS), activated_at: new Date(), retired_at: null }).execute();
    const res = await call("POST", `/v1/admin/games/${game.id}/draws`, tok, scheduledBody(ruleVersion.id, "night", tehranDate(10), "21:00"));
    expect(res.json().error.code).toBe("SETTINGS_CHANGED");
    expect(await drawsOf(game.id)).toEqual([]);
  });

  it("seeds and application startup create zero draws", async () => {
    const count = async () => Number((await db.selectFrom("draws").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).n);
    const seeded = await db.selectFrom("draws as d").innerJoin("games as g", "g.id", "d.game_id").select("d.id").where("g.code", "in", ["FOUR_LEAF", "SIX_CHANCE"]).execute();
    const before = await count();
    for (const file of ["0002_games_and_rule_versions.sql", "0003_admin_permissions.sql", "0004_schedule_slots.sql"]) {
      const res = await runPsqlFileCapture({ file: path.join(SEEDS_DIR, file), databaseUrl: loadEnv().DATABASE_URL });
      expect(res.code).toBe(0);
    }
    const env = loadEnv();
    const started = buildApp(env, db);
    await started.ready();
    await new Promise((r) => setTimeout(r, 300));
    await started.close();
    // Other test files create their own draws concurrently, so compare the seeded games only.
    const seededAfter = await db.selectFrom("draws as d").innerJoin("games as g", "g.id", "d.game_id").select("d.id").where("g.code", "in", ["FOUR_LEAF", "SIX_CHANCE"]).execute();
    expect(seededAfter).toEqual(seeded);
    expect(await count()).toBeGreaterThanOrEqual(before);
  });
});
