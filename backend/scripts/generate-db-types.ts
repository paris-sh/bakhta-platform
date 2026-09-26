import { spawn } from "node:child_process";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { REPO_ROOT } from "./lib/paths.js";

// Resolve the locally installed CLI's JS entry point directly and run it with the current
// Node executable, rather than going through `npx`/a shell — passing an argument array
// through a shell only concatenates it, it does not escape it, which Node itself warns is
// unsafe (and DATABASE_URL is exactly the kind of value that could contain shell-meaningful
// characters). Running the .js entry with `process.execPath` needs no shell on any platform.
const CODEGEN_ENTRY = path.join(
  REPO_ROOT,
  "backend",
  "node_modules",
  "kysely-codegen",
  "dist",
  "cli",
  "bin.js",
);

// Regenerates src/db/types.ts by introspecting the ACTUAL live schema — never hand-edited.
// This is the enforcement mechanism behind "Kysely never owns or drifts from the migrations":
// the type file is a derived artifact of whatever the .up.sql migrations actually produced,
// regenerated after every schema change, checked into git so a stale generator run is
// visible as a diff in review rather than a silent runtime surprise.
//
// Run this against a database that does NOT have the pgtap extension installed. pgTAP
// creates its own schema objects (pg_all_foreign_keys, tap_funky, ...) that introspection
// cannot distinguish from real application tables, and they will end up as noise in this
// file — caught once already: `DROP EXTENSION IF EXISTS pgtap;` before regenerating if
// you've been running pgTAP tests against the same database used for this.

async function main(): Promise<void> {
  const env = loadEnv();
  const outFile = path.join(REPO_ROOT, "backend", "src", "db", "types.ts");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        CODEGEN_ENTRY,
        "--dialect",
        "postgres",
        "--url",
        env.DATABASE_URL,
        "--out-file",
        outFile,
        "--numeric-parser",
        "string",
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`kysely-codegen exited with code ${code}`));
    });
  });

  console.log(`Generated ${outFile}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
