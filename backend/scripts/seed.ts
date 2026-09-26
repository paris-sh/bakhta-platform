import { readdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { SEEDS_DIR } from "./lib/paths.js";
import { runPsqlFile } from "./lib/psql.js";

const BOOTSTRAP_ADMIN_SEED = "0001_roles_and_bootstrap_admin.sql";

async function main(): Promise<void> {
  const env = loadEnv();
  const files = readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const full = path.join(SEEDS_DIR, file);
    console.log(`-- ${file}`);

    if (file === BOOTSTRAP_ADMIN_SEED) {
      const email = process.env.BAKHTA_BOOTSTRAP_ADMIN_EMAIL;
      const number = process.env.BAKHTA_BOOTSTRAP_ADMIN_NUMBER;
      if (!email || !number) {
        throw new Error(
          `${file} requires BAKHTA_BOOTSTRAP_ADMIN_EMAIL and BAKHTA_BOOTSTRAP_ADMIN_NUMBER ` +
            "environment variables — see backend/.env.example. No default is provided " +
            "deliberately: no email or credential is ever hardcoded in this project.",
        );
      }
      await runPsqlFile({
        file: full,
        databaseUrl: env.DATABASE_URL,
        variables: {
          bootstrap_admin_email: email,
          bootstrap_admin_number: number,
        },
      });
    } else {
      await runPsqlFile({ file: full, databaseUrl: env.DATABASE_URL });
    }
  }
  console.log("All seeds applied.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
