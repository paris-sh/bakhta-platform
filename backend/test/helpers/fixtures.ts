import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../src/db/client.js";
import { hashPassword } from "../../src/modules/auth/password.js";

// Mirrors the philosophy of tests/pgtap/00_helpers.sql: every test builds its own fixtures
// from scratch rather than depending on real seed data, so tests never interfere with each
// other or with a real seeded database.

export async function createTestUser(
  db: Database,
  opts: { email?: string; password: string; status?: "ACTIVE" | "SUSPENDED" | "CLOSED" },
) {
  const email = opts.email ?? `user-${randomUUID()}@test.invalid`;
  const user = await db
    .insertInto("users")
    .values({
      user_number: `U-TEST-${randomUUID().slice(0, 8)}`,
      email,
      status: opts.status ?? "ACTIVE",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const passwordHash = await hashPassword(opts.password);
  await db
    .insertInto("user_credentials")
    .values({ user_id: user.id, password_hash: passwordHash })
    .execute();

  return user;
}

export async function createTestAdmin(
  db: Database,
  opts: {
    email?: string;
    password: string;
    status?: "ACTIVE" | "SUSPENDED" | "CLOSED";
    permissionCodes?: string[];
  },
) {
  const email = opts.email ?? `admin-${randomUUID()}@test.invalid`;
  const admin = await db
    .insertInto("admin_accounts")
    .values({
      admin_number: `A-TEST-${randomUUID().slice(0, 8)}`,
      email,
      status: opts.status ?? "ACTIVE",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const passwordHash = await hashPassword(opts.password);
  await db
    .insertInto("admin_credentials")
    .values({ admin_id: admin.id, password_hash: passwordHash })
    .execute();

  if (opts.permissionCodes && opts.permissionCodes.length > 0) {
    const role = await db
      .insertInto("roles")
      .values({ code: `TEST_ROLE_${randomUUID().slice(0, 8)}`, name: "Test role" })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const code of opts.permissionCodes) {
      const permission = await db
        .insertInto("permissions")
        .values({ code, module: "test", action: "test" })
        .onConflict((oc) => oc.column("code").doNothing())
        .returningAll()
        .executeTakeFirst();
      const permissionId =
        permission?.id ??
        (await db
          .selectFrom("permissions")
          .select("id")
          .where("code", "=", code)
          .executeTakeFirstOrThrow()).id;

      await db
        .insertInto("role_permissions")
        .values({ role_id: role.id, permission_id: permissionId })
        .execute();
    }

    await db
      .insertInto("admin_role_assignments")
      .values({ admin_id: admin.id, role_id: role.id })
      .execute();
  }

  return admin;
}

/** A throwaway game + initial ACTIVE rule version, isolated from the real seeded
 * SIX_CHANCE/FOUR_LEAF games — used by tests that create/activate rule versions, so they
 * never permanently mutate which version is "current" for the real games. */
export async function createTestGame(
  db: Database,
  opts: { gameType: "SIX_CHANCE" | "FOUR_LEAF"; createdBy: string; rules: Record<string, unknown> },
) {
  const suffix = randomUUID().slice(0, 8);
  const game = await db
    .insertInto("games")
    .values({
      code: `TEST_GAME_${suffix}`,
      game_type: opts.gameType,
      slug: `test-game-${suffix}`,
      name_fa: "بازی آزمایشی",
      name_en: "Test Game",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const ruleVersion = await db
    .insertInto("game_rule_versions")
    .values({
      game_id: game.id,
      game_type: opts.gameType,
      version_number: 1,
      status: "ACTIVE",
      rules: JSON.stringify(opts.rules),
      rules_hash: createHash("sha256").update(JSON.stringify(opts.rules)).digest(),
      change_reason: "Test fixture seed version",
      created_by: opts.createdBy,
      activated_by: opts.createdBy,
      activated_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { game, ruleVersion };
}

/** A throwaway game + ACTIVE rule version + one draw, for order/ticket tests. Defaults to
 * a draw whose sales window is currently open (opens 1h ago, closes 1h from now) unless
 * overridden — e.g. to test the cutoff paths directly. */
export async function createTestDraw(
  db: Database,
  opts: {
    gameType: "SIX_CHANCE" | "FOUR_LEAF";
    createdBy: string;
    rules: Record<string, unknown>;
    status?: "SALES_OPEN" | "SALES_CLOSED" | "DRAW_IN_PROGRESS" | "VOID";
    salesOpensAt?: Date;
    salesClosesAt?: Date;
    drawAt?: Date;
  },
) {
  const { game, ruleVersion } = await createTestGame(db, {
    gameType: opts.gameType,
    createdBy: opts.createdBy,
    rules: opts.rules,
  });

  const salesOpensAt = opts.salesOpensAt ?? new Date(Date.now() - 60 * 60_000);
  const salesClosesAt = opts.salesClosesAt ?? new Date(Date.now() + 60 * 60_000);
  const drawAt = opts.drawAt ?? new Date(Date.now() + 2 * 60 * 60_000);

  const draw = await db
    .insertInto("draws")
    .values({
      game_id: game.id,
      game_type: opts.gameType,
      draw_number: "1",
      status: opts.status ?? "SALES_OPEN",
      sales_opens_at: salesOpensAt,
      sales_closes_at: salesClosesAt,
      draw_at: drawAt,
      official_timezone: "Asia/Tehran",
      current_rule_version_id: ruleVersion.id,
      current_rules_snapshot: JSON.stringify(opts.rules),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { game, ruleVersion, draw };
}
