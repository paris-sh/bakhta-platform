import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { isAppError } from "../shared/errors.js";

// Single place that turns any thrown error into an HTTP response. Route handlers never set
// status codes themselves — they throw a typed AppError (see shared/errors.ts) or let a Zod
// validation failure propagate, and this is the only place that translates either into the
// stable {error: {code, message, details}} envelope clients can rely on.

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation.",
          details: err.validation,
        },
      });
      return;
    }

    if (isAppError(err)) {
      reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
      return;
    }

    request.log.error({ err }, "Unhandled error");
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found.`,
      },
    });
  });
}
