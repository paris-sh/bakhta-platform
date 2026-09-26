import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { createAuthRepository } from "./modules/auth/auth.repository.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { createAuthService, type AuthService } from "./modules/auth/auth.service.js";
import { createAuditService } from "./modules/audit/audit.service.js";
import { createGamesRepository } from "./modules/games/games.repository.js";
import { registerGamesRoutes } from "./modules/games/games.routes.js";
import { createGamesService } from "./modules/games/games.service.js";
import { createDrawsRepository } from "./modules/draws/draws.repository.js";
import { registerDrawsRoutes } from "./modules/draws/draws.routes.js";
import { createDrawsService } from "./modules/draws/draws.service.js";
import { createOrdersRepository } from "./modules/orders/orders.repository.js";
import { registerOrdersRoutes } from "./modules/orders/orders.routes.js";
import { createOrdersService } from "./modules/orders/orders.service.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    authService: AuthService;
  }
}

export function buildApp(env: Env, db: Database): FastifyInstance {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // Matches audit_logs.request_id (UUID) and admin_overrides.request_id so a request can
    // be correlated end-to-end once those modules exist.
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  app.decorate("db", db);

  const authRepository = createAuthRepository(db);
  const authService = createAuthService(authRepository, env);
  app.decorate("authService", authService);
  registerAuthRoutes(app, authService);

  const auditService = createAuditService(db);

  const gamesRepository = createGamesRepository(db);
  const gamesService = createGamesService(gamesRepository, auditService);
  registerGamesRoutes(app, gamesService, authService);

  const drawsRepository = createDrawsRepository(db);
  const drawsService = createDrawsService(drawsRepository, gamesRepository, auditService);
  registerDrawsRoutes(app, drawsService, gamesService, authService);

  const ordersRepository = createOrdersRepository(db);
  const ordersService = createOrdersService(ordersRepository);
  registerOrdersRoutes(app, ordersService, authService, env);

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal("ok"),
            database: z.literal("ok"),
          }),
        },
      },
    },
    async () => {
      // A real query, not just "the process is alive" — this is what Phase 1 needs to prove:
      // the app can reach the actual migrated database through Kysely.
      await db.selectNoFrom((eb) => eb.val(1).as("ping")).execute();
      return { status: "ok" as const, database: "ok" as const };
    },
  );

  return app;
}
