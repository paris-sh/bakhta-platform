// Typed application error hierarchy. Every module throws one of these (never a bare Error)
// for any condition the API contract should expose to a client; the error-handler plugin is
// the single place that maps them to an HTTP response, so no route handler writes its own
// status-code logic.

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = "FORBIDDEN";
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
}

/** A purchase or confirmation attempted outside the draw's sales window (409, specific code). */
export class SalesNotOpenYetError extends AppError {
  readonly statusCode = 409;
  readonly code = "SALES_NOT_OPEN_YET";
}

export class SalesClosedError extends AppError {
  readonly statusCode = 409;
  readonly code = "SALES_CLOSED";
}

export class DrawNotOnSaleError extends AppError {
  readonly statusCode = 409;
  readonly code = "DRAW_NOT_ON_SALE";
}

export class ConfirmationRequiredError extends AppError {
  readonly statusCode = 428;
  readonly code = "CONFIRMATION_REQUIRED";
}

export class RateLimitedError extends AppError {
  readonly statusCode = 429;
  readonly code = "RATE_LIMITED";
}

export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = "INTERNAL_ERROR";
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
