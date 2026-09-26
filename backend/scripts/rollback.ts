import { readdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { MIGRATIONS_DIR } from "./lib/paths.js";
import { runPsqlFile } from "./lib/psql.js";

// Rolls back ALL migrations, in reverse numeric order. See the root README's "Rollback
// caveats" — this is meant for pre-deployment iteration on a disposable database, not for
// reverting a live schema that already holds real data.

async function main(): Promise<void> {
  const env = loadEnv();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".down.sql"))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No .down.sql files found in ${MIGRATIONS_DIR}`);
  }

  console.log(`Rolling back ${files.length} migrations (reverse order).`);
  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    console.log(`-- ${file}`);
    await runPsqlFile({ file: full, databaseUrl: env.DATABASE_URL });
  }
  console.log("All migrations rolled back.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
