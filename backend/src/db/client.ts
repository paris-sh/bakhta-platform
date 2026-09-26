import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./types.js";
import type { Env } from "../config/env.js";

// pg returns int8 (BIGINT) columns as strings by default — this is deliberate and must
// never be "fixed" by installing a custom int8 parser. toman_amount columns are BIGINT
// specifically so they never round-trip through a floating-point JS number; every caller
// that needs arithmetic on them must go through src/shared/money.ts, not `+`.

export function createDb(env: Env): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
  });

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type Database = Kysely<DB>;
