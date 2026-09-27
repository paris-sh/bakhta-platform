import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateHook,
  createOptionalAuthenticateHook,
} from "../../plugins/authenticate.js";
import { requirePrincipalType } from "../../plugins/authorize.js";
import { ForbiddenError, ValidationError } from "../../shared/errors.js";
import type { AuthService } from "../auth/auth.service.js";
import {
  confirmOrderResponseSchema,
  createOrderBodySchema,
  orderIdParamsSchema,
  orderListResponseSchema,
  orderResponseSchema,
  publicCodeParamsSchema,
  publicTicketCheckResponseSchema,
  ticketListResponseSchema,
} from "./orders.schemas.js";
import type { OrdersService, Purchaser } from "./orders.service.js";

const idempotencyHeaderSchema = z.object({
  "idempotency-key": z.string().uuid("Idempotency-Key header must be a UUID."),
});

export function requireDevOrderConfirmation(env: Env) {
  return async function (_request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    // Double-guarded on purpose: an operator flipping the flag true by mistake in a
    // misconfigured production environment is still not enough on its own.
    if (env.NODE_ENV === "production" || !env.DEV_ORDER_CONFIRMATION_ENABLED) {
      throw new ForbiddenError(
        "Development-only order confirmation is disabled. Payment is deferred in this " +
          "build stage; this endpoint exists solely to unblock a clickable demo and must " +
          "never be enabled in production.",
      );
    }
  };
}

export function registerOrdersRoutes(
  app: FastifyInstance,
  ordersService: OrdersService,
  authService: AuthService,
  env: Env,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);
  const optionalAuthenticate = createOptionalAuthenticateHook(authService);

  typed.post(
    "/v1/orders",
    {
      preHandler: [optionalAuthenticate],
      schema: {
        headers: idempotencyHeaderSchema,
        body: createOrderBodySchema,
        response: { 201: orderResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (principal?.type === "ADMIN") {
        throw new ForbiddenError("Admin sessions cannot place orders.");
      }
      const purchaser: Purchaser =
        principal?.type === "USER" ? { type: "USER", userId: principal.userId } : { type: "GUEST" };

      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string") {
        throw new ValidationError("Idempotency-Key header is required.");
      }

      const order = await ordersService.createOrder(request.body, purchaser, idempotencyKey);
      // 201 regardless of whether this call created the order or replayed an idempotent
      // retry of an existing one — either way the caller gets the (now-existing) resource.
      reply.status(201);
      return order;
    },
  );

  typed.get(
    "/v1/orders/:id",
    {
      onRequest: [authenticate, requirePrincipalType("USER")],
      schema: { params: orderIdParamsSchema, response: { 200: orderResponseSchema } },
    },
    async (request) => {
      const principal = request.principal as { type: "USER"; userId: string };
      return ordersService.getOrder(request.params.id, { type: "USER", userId: principal.userId });
    },
  );

  typed.get(
    "/v1/me/orders",
    {
      onRequest: [authenticate, requirePrincipalType("USER")],
      schema: { response: { 200: orderListResponseSchema } },
    },
    async (request) => {
      const principal = request.principal as { type: "USER"; userId: string };
      return ordersService.listOrdersForUser(principal.userId);
    },
  );

  typed.get(
    "/v1/me/tickets",
    {
      onRequest: [authenticate, requirePrincipalType("USER")],
      schema: { response: { 200: ticketListResponseSchema } },
    },
    async (request) => {
      const principal = request.principal as { type: "USER"; userId: string };
      return ordersService.listTicketsForUser(principal.userId);
    },
  );

  // Public: identifies a ticket by its public_code only — no ownership data, no Claim
  // Token, no internal UUIDs (see orders.service.ts's checkTicketByPublicCode).
  typed.get(
    "/v1/tickets/check/:publicCode",
    {
      schema: { params: publicCodeParamsSchema, response: { 200: publicTicketCheckResponseSchema } },
    },
    async (request) => ordersService.checkTicketByPublicCode(request.params.publicCode),
  );

  // DEV-ONLY. Payment is deferred; this is the placeholder that lets a clickable demo
  // reach a CONFIRMED ticket + a guest Claim Token at all. See requireDevOrderConfirmation.
  typed.post(
    "/v1/dev/orders/:id/confirm",
    {
      preHandler: [requireDevOrderConfirmation(env)],
      schema: { params: orderIdParamsSchema, response: { 200: confirmOrderResponseSchema } },
    },
    async (request) => ordersService.confirmOrderDevOnly(request.params.id),
  );
}
