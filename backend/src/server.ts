import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const app = buildApp(env, db);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
