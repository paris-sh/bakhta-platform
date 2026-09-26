import { existsSync } from "node:fs";

// Loads backend/.env for local test runs (CI is expected to inject real environment
// variables directly and will not have a .env file — that's fine, loadEnvFile is a no-op
// if the file doesn't exist).
if (existsSync(new URL("../.env", import.meta.url))) {
  process.loadEnvFile(new URL("../.env", import.meta.url));
}

// Keep test output focused on assertion results, not request/response logs. Unconditional:
// test runs should always be quiet regardless of whatever LOG_LEVEL a local .env sets for
// `npm run dev`.
process.env.LOG_LEVEL = "silent";
