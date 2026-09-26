import { z } from "zod";

// Parsed once at process start. Fails fast and loudly if misconfigured, rather than letting
// an undefined value silently reach a query or a listener call.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Admin sessions are deliberately shorter-lived than user sessions (spec: "Keep
  // administrator sessions shorter than customer sessions").
  SESSION_USER_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  SESSION_USER_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(336), // 14 days
  SESSION_ADMIN_IDLE_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_ADMIN_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(8),

  // Durable, cross-instance login rate limiting backed by auth_attempts (spec: "Use rate
  // limits by IP address, email, account, ...").
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // Payment is deferred (out of scope for this build stage), so there is no real
  // order-confirmation path yet. This flag exists ONLY to unblock a clickable demo and is
  // double-guarded: the confirmation route checks BOTH this flag AND NODE_ENV !== 'production'
  // before doing anything, so setting this true by mistake in a misconfigured production
  // environment still is not enough on its own to enable it.
  DEV_ORDER_CONFIRMATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // CORS is explicit-origin only — never a wildcard, and never reflects an arbitrary
  // Origin header. This is the one local frontend origin (the Next.js dev server) allowed
  // to call this API with `Authorization: Bearer ...`; anything else is rejected by
  // @fastify/cors before the route handler ever runs. A comma-separated list allows more
  // than one local origin (e.g. both localhost and 127.0.0.1) without ever widening to "*".
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3001")
    .transform((v) => v.split(",").map((s) => s.trim()).filter((s) => s.length > 0)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
