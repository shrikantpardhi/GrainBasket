/**
 * Tenant scope. This is the single mechanism that keeps shop A's rows out of
 * shop B's queries, and it is deliberately impossible to run a tenant query
 * without one.
 *
 * The failure mode this design exists to prevent:
 *
 *     if (shopId) args.where.shopId = shopId        // WRONG
 *
 * That line is a no-op on every call path with no shop context — the Razorpay
 * webhook, the subscription cron, platform reporting, Better Auth's adapter —
 * so those paths silently return every shop's rows. There is no error, no
 * warning, and no test failure unless someone writes the test. A Lebanese
 * data leak that looks like a working feature.
 *
 * So: the scope is mandatory, discriminated, and carried in AsyncLocalStorage.
 * `requireScope()` throws rather than defaulting to "everything".
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PlatformRole, StoreRole } from "@grain-basket/contracts";
import { AppError, ERROR_CODES } from "@grain-basket/contracts";

/** A member of one shop, acting with that membership's permissions. */
export interface StoreScope {
  kind: "STORE";
  shopId: string;
  membershipId: string;
  storeUserId: string;
  role: StoreRole;
  permissions: readonly string[];
}

/**
 * An end customer, always pinned to the storefront they are browsing.
 *
 * `shopIds` is required, not optional, and that is load-bearing. A customer
 * reads two very different sets of rows: catalogue rows belonging to ONE shop
 * (which they have no `customerId` on) and their own orders (which they do).
 * Without a shop on the scope, the catalogue half can only be answered by
 * leaving the query unscoped — the exact hole the extension exists to close.
 * The storefront route always names a shop, so the scope always has one.
 */
export interface CustomerScope {
  kind: "CUSTOMER";
  customerId: string;
  sessionId: string;
  /** Exactly one shop: one shop per cart, one storefront at a time. */
  shopIds: readonly string[];
}

/**
 * Platform staff. The ONLY scope allowed to omit a shop filter — and only
 * `platformProcedure`/`supportProcedure` may construct one, so every
 * platform-wide read is a deliberate, auditable act rather than a default.
 */
export interface PlatformScope {
  kind: "PLATFORM";
  platformUserId: string;
  role: PlatformRole;
  permissions: readonly string[];
  /** Correlates the audit rows written during this request. */
  requestId: string;
}

/**
 * A logged-out visitor on a storefront. They may read the shop's public
 * catalogue and nothing else — which is enforced by an allowlist, not by
 * remembering to add each new private model to a blocklist.
 */
export interface PublicScope {
  kind: "PUBLIC";
  shopIds: readonly string[];
}

/**
 * Background work with no user: webhooks, cron ticks, seeds. It must name the
 * shops it may touch, so a bug cannot silently widen it to the whole
 * platform.
 */
export interface SystemScope {
  kind: "SYSTEM";
  job: string;
  shopIds: readonly string[];
}

export type Scope =
  | StoreScope
  | CustomerScope
  | PlatformScope
  | PublicScope
  | SystemScope;

const storage = new AsyncLocalStorage<Scope>();

/**
 * Run `fn` with `scope` active. Every entry point must wrap its work.
 *
 * The async branch is not a convenience — it is required for correctness.
 * AsyncLocalStorage propagates into callbacks *created* inside `run`, but if
 * `fn` returns a promise that settles after `run` returns, everything chained
 * onto it (including Prisma's own query execution) runs outside the store and
 * the tenant extension throws MissingScopeError. A non-async callback like
 *
 *     runWithScope(scope, () => db.product.findMany())   // WRONG
 *
 * is exactly the mistake this handles: we adopt the returned promise inside
 * the store so its continuations inherit the context.
 */
export function runWithScope<T>(scope: Scope, fn: () => T): T {
  return storage.run(scope, () => {
    const result = fn();
    if (isPromiseLike(result)) {
      // Keep the store alive for the whole promise chain.
      return result.then(
        (value) => value,
        (error) => {
          throw error;
        },
      ) as unknown as T;
    }
    return result;
  });
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** The active scope, or `undefined`. Use `requireScope` in domain code. */
export function getScope(): Scope | undefined {
  return storage.getStore();
}

/**
 * The active scope, or a loud failure. This is what the Prisma extension
 * calls: no scope means no tenant query.
 */
export function requireScope(model: string, operation: string): Scope {
  const scope = storage.getStore();
  if (!scope) throw new MissingScopeError(model, operation);
  return scope;
}

export class MissingScopeError extends AppError {
  constructor(model: string, operation: string) {
    super(
      ERROR_CODES.MISSING_TENANT_SCOPE,
      `Tenant-scoped query ${model}.${operation} ran with no active scope. ` +
        `Every entry point must wrap its work in runWithScope(scope, ...).`,
    );
    this.name = "MissingScopeError";
  }
}

/**
 * The shop IDs a scope may read/write. `null` means "no shop restriction"
 * (platform only). Note that returning `null` is a real decision the caller
 * had to be in a PLATFORM scope to make — it is never a fallback.
 */
export function allowedShopIds(scope: Scope): readonly string[] | null {
  switch (scope.kind) {
    case "STORE":
      return [scope.shopId];
    case "SYSTEM":
      if (scope.shopIds.length === 0) {
        throw new AppError(
          ERROR_CODES.MISSING_TENANT_SCOPE,
          `SYSTEM scope "${scope.job}" has no shopIds; refusing to run unscoped`,
        );
      }
      return scope.shopIds;
    case "CUSTOMER":
    case "PUBLIC":
      // Both are pinned to the storefront they are browsing. A customer's own
      // rows are narrowed further by `customerIdForScope`.
      return scope.shopIds;
    case "PLATFORM":
      return null;
  }
}

/** The customer ID a customer scope is pinned to, else null. */
export function customerIdForScope(scope: Scope): string | null {
  return scope.kind === "CUSTOMER" ? scope.customerId : null;
}

/** Narrow a scope to a single customer + storefront. */
export function toCustomerScope(
  input: Omit<CustomerScope, "kind">,
): CustomerScope {
  if (input.shopIds.length === 0) {
    throw new AppError(
      ERROR_CODES.MISSING_TENANT_SCOPE,
      "A customer scope must name the shop it is browsing",
    );
  }
  return { kind: "CUSTOMER", ...input };
}

/** True when the scope may see rows belonging to `shopId`. */
export function scopeCoversShop(scope: Scope, shopId: string): boolean {
  switch (scope.kind) {
    case "PLATFORM":
      return true;
    case "STORE":
      return scope.shopId === shopId;
    case "SYSTEM":
      return scope.shopIds.includes(shopId);
    case "CUSTOMER":
    case "PUBLIC":
      return scope.shopIds.includes(shopId);
  }
}

/** Narrow a scope to a single logged-out storefront visitor. */
export function toPublicScope(input: Omit<PublicScope, "kind">): PublicScope {
  if (input.shopIds.length === 0) {
    throw new AppError(
      ERROR_CODES.MISSING_TENANT_SCOPE,
      "A public scope must name the shop being browsed",
    );
  }
  return { kind: "PUBLIC", ...input };
}

/** Narrow a scope to a single shop, used by store procedures after resolving
 *  the route slug to a membership. */
export function toStoreScope(input: Omit<StoreScope, "kind">): StoreScope {
  return { kind: "STORE", ...input };
}

/**
 * Boot canary. Call once at process start. If this does not throw, the
 * extension is not installed and every tenant check is theatre.
 */
export function assertFailClosed(probe: () => unknown): void {
  let threw = false;
  try {
    probe();
  } catch (error) {
    threw = error instanceof MissingScopeError || error instanceof AppError;
  }
  if (!threw) {
    throw new Error(
      "Fail-closed tenancy check failed: a tenant query ran with no scope and " +
        "did not throw. The Prisma tenant extension is not installed.",
    );
  }
}
