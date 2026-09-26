import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolved from this file's own location, not process.cwd(), so these scripts behave the
// same regardless of which directory `npm run` was invoked from.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(THIS_DIR, "..", "..");
export const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

export const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");
export const SEEDS_DIR = path.join(REPO_ROOT, "seeds");
export const PGTAP_DIR = path.join(REPO_ROOT, "tests", "pgtap");
export const CONCURRENCY_DIR = path.join(REPO_ROOT, "tests", "concurrency");
