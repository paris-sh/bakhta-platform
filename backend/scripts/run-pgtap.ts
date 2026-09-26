import { readdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { PGTAP_DIR } from "./lib/paths.js";
import { runPsqlFile, runPsqlFileCapture } from "./lib/psql.js";

// Requires the real pgtap extension already installed natively in the target database —
// see the root README's "Installing pgTAP natively (no Docker)" section. This script does
// not install it; it only runs the existing, already-authored test files.
//
// Run this against a freshly migrated, NOT YET SEEDED database. 08_super_admin_safeguard.sql
// counts active SUPER_ADMINs system-wide by design; seeding the bootstrap admin first makes
// its "only two exist" setup assumption false and fails 3 assertions — confirmed by actually
// running both orderings, not assumed. See the root README for the same note.

async function main(): Promise<void> {
  const env = loadEnv();

  const helpers = path.join(PGTAP_DIR, "00_helpers.sql");
  console.log("-- 00_helpers.sql");
  await runPsqlFile({ file: helpers, databaseUrl: env.DATABASE_URL });

  const testFiles = readdirSync(PGTAP_DIR)
    .filter((f) => /^[0-9]{2}_.*\.sql$/.test(f))
    .sort();

  let failedAssertions = 0;
  let filesWithHardErrors = 0;
  for (const file of testFiles) {
    const full = path.join(PGTAP_DIR, file);
    console.log(`\n=== ${file} ===`);
    const { code, output } = await runPsqlFileCapture({ file: full, databaseUrl: env.DATABASE_URL });
    const notOkCount = (output.match(/^\s*not ok/gm) ?? []).length;
    if (notOkCount > 0) {
      console.error(`FAILED: ${file} (${notOkCount} assertion(s) failed)`);
      failedAssertions += notOkCount;
    }
    // A nonzero exit with zero "not ok" lines means a hard SQL error aborted the file (e.g.
    // in fixture setup) BEFORE pgTAP's own assertions ever ran — that is not the same thing
    // as "0 assertions failed" and must never be reported as a pass. This exact gap once let
    // a broken fixture default silently report "all pgTAP assertions passed" while several
    // files' assertions had not actually executed at all.
    if (code !== 0 && notOkCount === 0) {
      console.error(`HARD ERROR: ${file} exited with code ${code} before completing (see output above).`);
      filesWithHardErrors += 1;
    }
  }

  if (failedAssertions > 0 || filesWithHardErrors > 0) {
    throw new Error(
      `${failedAssertions} pgTAP assertion(s) failed and ${filesWithHardErrors} file(s) aborted with a hard error, across ${testFiles.length} files.`,
    );
  }
  console.log(`\nAll pgTAP assertions passed across ${testFiles.length} files.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
