import { readdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { MIGRATIONS_DIR } from "./lib/paths.js";
import { runPsqlFile } from "./lib/psql.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .up.sql files found in ${MIGRATIONS_DIR}`);
  }

  console.log(`Applying ${files.length} migrations against ${maskUrl(env.DATABASE_URL)}`);
  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    console.log(`-- ${file}`);
    await runPsqlFile({ file: full, databaseUrl: env.DATABASE_URL });
  }
  console.log("All migrations applied.");
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    u.password = u.password ? "***" : "";
    return u.toString();
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
