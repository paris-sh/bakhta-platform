import { spawn } from "node:child_process";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { CONCURRENCY_DIR, PGTAP_DIR } from "./lib/paths.js";
import { runPsqlFile } from "./lib/psql.js";

// Invokes the existing, already-authored two-connection race scripts unchanged. Requires
// `bash` and `psql` on PATH (Git Bash on Windows already provides both, per this project's
// established local setup). All four scripts depend on tests/pgtap/00_helpers.sql's
// test_helpers.* fixture functions, so this loads (or re-loads — CREATE OR REPLACE, always
// idempotent) them first, rather than relying on the caller having done so separately.

const SCRIPTS = [
  "claim_credential_race.sh",
  "order_idempotency_race.sh",
  "one_current_award_race.sh",
  "rule_version_activation_race.sh",
];

function runScript(scriptPath: string, databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath, databaseUrl], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const env = loadEnv();

  const helpers = path.join(PGTAP_DIR, "00_helpers.sql");
  console.log("-- loading tests/pgtap/00_helpers.sql (test_helpers.* fixtures)");
  await runPsqlFile({ file: helpers, databaseUrl: env.DATABASE_URL });

  for (const script of SCRIPTS) {
    const full = path.join(CONCURRENCY_DIR, script);
    console.log(`\n=== ${script} ===`);
    await runScript(full, env.DATABASE_URL);
  }
  console.log("\nAll concurrency races passed.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
