/**
 * Stable error codes that cross the network. The UI maps these to translated
 * messages, so a code is a contract: renaming one is a breaking change.
 */

export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",

  /** Tenancy: a query ran without a scope, or tried to escape one. */
  MISSING_TENANT_SCOPE: "MISSING_TENANT_SCOPE",
  CROSS_TENANT_ACCESS: "CROSS_TENANT_ACCESS",

  /** Identity: a session from the wrong universe was presented. */
  WRONG_UNIVERSE: "WRONG_UNIVERSE",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  /** Commerce. */
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_NOT_APPLICABLE: "COUPON_NOT_APPLICABLE",
  COUPON_ALREADY_USED: "COUPON_ALREADY_USED",
  PRICE_CHANGED: "PRICE_CHANGED",
  CART_SHOP_MISMATCH: "CART_SHOP_MISMATCH",
  SHOP_NOT_ACCEPTING_ORDERS: "SHOP_NOT_ACCEPTING_ORDERS",
  PINCODE_NOT_SERVICEABLE: "PINCODE_NOT_SERVICEABLE",
  BELOW_MIN_ORDER: "BELOW_MIN_ORDER",

  /** Fulfilment and money. */
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  MILLING_INCOMPLETE: "MILLING_INCOMPLETE",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  CASH_COLLECTION_NOT_ALLOWED: "CASH_COLLECTION_NOT_ALLOWED",
  PICKUP_CODE_INVALID: "PICKUP_CODE_INVALID",
  INTAKE_VARIANCE_UNAPPROVED: "INTAKE_VARIANCE_UNAPPROVED",

  /** Rate limiting and abuse. */
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown by the Prisma tenant extension when a tenant-scoped query has no
 * scope. This is deliberately loud: the alternative — silently querying every
 * shop's rows — is the failure mode the whole tenancy design exists to stop.
 */
export class MissingTenantScopeError extends AppError {
  constructor(model: string, operation: string) {
    super(
      ERROR_CODES.MISSING_TENANT_SCOPE,
      `Tenant-scoped query on ${model}.${operation} ran with no active scope. ` +
        `Every entry point must wrap its work in als.run(scope, ...).`,
    );
    this.name = "MissingTenantScopeError";
  }
}
