import { z } from "zod";

export const registerBodySchema = z.object({
  email: z.string().email(),
  // Length only — full complexity/entropy policy is out of scope for this phase.
  password: z.string().min(10).max(200),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const registerResponseSchema = z.object({
  id: z.string().uuid(),
  userNumber: z.string(),
  email: z.string(),
});

export const sessionResponseSchema = z.object({
  token: z.string(),
  idleExpiresAt: z.string(),
  absoluteExpiresAt: z.string(),
});

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  userNumber: z.string(),
  email: z.string(),
  status: z.string(),
  emailVerified: z.boolean(),
});

export const adminMeResponseSchema = z.object({
  id: z.string().uuid(),
  adminNumber: z.string(),
  email: z.string(),
  status: z.string(),
  permissions: z.array(z.string()),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
