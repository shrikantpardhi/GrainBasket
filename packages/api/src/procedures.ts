/**
 * Procedure bases — one per access level.
 *
 * Every procedure is a `publicProcedure` underneath; the bases stack
 * middleware that (a) checks the right universe authenticated the request,
 * (b) checks the permission key, and (c) wraps the resolver in
 * `runWithScope` so the tenant extension has a scope to enforce.
 *
 * The last part is not optional bookkeeping. A resolver that runs without a
 * scope throws `MissingScopeError` on its first tenant query, so the wrap is
 * what makes the procedure usable at all — and its absence is loud rather
 * than a silent "all shops".
 */

import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import {
  AppError,
  ERROR_CODES,
  PERMISSIONS,
  can,
  type Permission,
} from "@grain-basket/contracts";
import {
  runWithScope,
  MissingScopeError,
  type Scope,
  type StoreScope,
  type PlatformScope,
} from "@grain-basket/db";
import {
  storefrontScope,
  type Auth,
  type Context,
  type StoreMembershipClaim,
} from "./context";

/** The auth member a base has already proven is present. */
type Narrow<Kind extends Auth["kind"]> = Extract<Auth, { kind: Kind }>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (cause instanceof AppError) {
      return {
        ...shape,
        // The stable code is what the UI translates; the message is a dev aid.
        data: { ...shape.data, code: cause.code, details: cause.details },
      };
    }
    if (cause instanceof ZodError) {
      return {
        ...shape,
        data: { ...shape.data, code: ERROR_CODES.VALIDATION_FAILED, details: cause.issues },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** No auth, no scope. Only for health checks and i18n lookups. */
export const publicProcedure = t.procedure;

/**
 * A signed-out storefront visitor. Establishes a PUBLIC scope pinned to the
 * shop in the URL, so catalogue reads are shop-filtered and every write is
 * refused by the extension.
 */
export const storefrontProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.shop) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No shop in this request",
      cause: new AppError(ERROR_CODES.NOT_FOUND, "No shop in this request"),
    });
  }
  if (ctx.shop.accessStatus !== "ACTIVE" || !ctx.shop.isActive) {
    // 404 rather than 403: a locked shop's existence is not disclosed.
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Shop not found",
      cause: new AppError(ERROR_CODES.NOT_FOUND, "Shop not found"),
    });
  }

  const scope = storefrontScope(ctx);
  const shop = ctx.shop as NonNullable<Context["shop"]>;
  return runWithScope(scope, () => next({ ctx: { ...ctx, shop, scope } }));
});

/**
 * A signed-in customer. Unlike `storefrontProcedure`, the scope carries a
 * customerId, so queries reach the customer's own orders and cart but not
 * anyone else's.
 */
export const customerProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.auth.kind !== "CUSTOMER") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue",
      cause: new AppError(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue"),
    });
  }
  if (!ctx.shop) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No shop in this request",
      cause: new AppError(ERROR_CODES.NOT_FOUND, "No shop in this request"),
    });
  }

  const scope: Scope = {
    kind: "CUSTOMER",
    customerId: ctx.auth.customerId,
    sessionId: ctx.auth.sessionId,
    shopIds: [ctx.shop.id],
  };

  const auth = ctx.auth as Narrow<"CUSTOMER">;
  return runWithScope(scope, () => next({ ctx: { ...ctx, shop: ctx.shop, auth, scope } }));
});

/**
 * Store back office. Resolves the membership for the shop in the URL and fails
 * if the user has none — the membership is the permission, not the login.
 */
export const storeProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.auth.kind !== "STORE") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Not found",
      cause: new AppError(ERROR_CODES.UNAUTHENTICATED, "Not signed in"),
    });
  }
  if (!ctx.shop) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Not found",
      cause: new AppError(ERROR_CODES.NOT_FOUND, "Shop not found"),
    });
  }

  const membership = ctx.auth.memberships.find((m) => m.shopId === ctx.shop?.id);
  if (!membership) {
    // A store user without a membership here gets the same 404 as an outsider:
    // the shop's existence must not leak between franchises.
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Not found",
      cause: new AppError(ERROR_CODES.NOT_FOUND, "Shop not found"),
    });
  }

  const scope: StoreScope = {
    kind: "STORE",
    shopId: membership.shopId,
    membershipId: membership.membershipId,
    storeUserId: ctx.auth.storeUserId,
    role: membership.role,
    permissions: membership.permissions,
  };

  // Narrow the types: the guards above proved both are present, and resolvers
  // should not have to re-check them to read storeUserId or shop.id.
  const auth = ctx.auth as Narrow<"STORE">;
  const shop = ctx.shop as NonNullable<Context["shop"]>;
  return runWithScope(scope, () =>
    next({ ctx: { ...ctx, shop, auth, membership, scope } }),
  );
});

/** Platform console. Every call runs unscoped by design and is audited. */
export const platformProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.auth.kind !== "PLATFORM") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Not found",
      cause: new AppError(ERROR_CODES.UNAUTHENTICATED, "Not signed in"),
    });
  }

  const scope: PlatformScope = {
    kind: "PLATFORM",
    platformUserId: ctx.auth.platformUserId,
    role: ctx.auth.role,
    permissions: ctx.auth.permissions,
    requestId: ctx.meta.requestId,
  };

  const auth = ctx.auth as Narrow<"PLATFORM">;
  return runWithScope(scope, () => next({ ctx: { ...ctx, auth, scope } }));
});

/**
 * Build a store procedure guarded by a named permission.
 *
 *     export const collectCash = storeProcedureWith(PERMISSIONS.COD_COLLECT)
 */
export function storeProcedureWith(required: Permission) {
  return storeProcedure.use(async ({ ctx, next }) => {
    if (!can(ctx.membership.permissions as readonly Permission[], required)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing permission: ${required}`,
        cause: new AppError(ERROR_CODES.FORBIDDEN, `Missing permission: ${required}`),
      });
    }
    return next();
  });
}

export function platformProcedureWith(required: Permission) {
  return platformProcedure.use(async ({ ctx, next }) => {
    if (!can(ctx.auth.permissions as readonly Permission[], required)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing permission: ${required}`,
        cause: new AppError(ERROR_CODES.FORBIDDEN, `Missing permission: ${required}`),
      });
    }
    return next();
  });
}

/**
 * Wrap resolver work in the scope from context. Exported so routers that build
 * a scope themselves (auth, cart) use the same call shape.
 */
export function scoped<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  return runWithScope(scope, fn);
}

/** Re-exported so surfaces share one permission vocabulary. */
export { PERMISSIONS, MissingScopeError };
export type { StoreMembershipClaim };
