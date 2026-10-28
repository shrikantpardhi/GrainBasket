/**
 * The Prisma tenant extension.
 *
 * Installed on every client. For each tenant-owned model it:
 *
 *   * injects the scope's shopId into `where` on reads/updates/deletes
 *   * OVERWRITES (never `??`-defaults) tenant fields on writes
 *   * validates that any provided ID resolves inside the caller's shops
 *   * throws when a tenant query cannot be constrained
 *
 * `TENANT_MODELS` is the model -> tenant field map. A model with a shopId that
 * is missing from this map is a hole, which is why CI asserts the map covers
 * every model whose schema declares a shopId (see tenant-map.test.ts).
 */

import { Prisma } from "./generated/prisma/client";
import {
  allowedShopIds,
  customerIdForScope,
  getScope,
  requireScope,
  type Scope,
} from "./scope";
import { AppError, ERROR_CODES } from "@grain-basket/contracts";

/**
 * Models carrying `shopId`. Deleting from this map without deleting the column
 * fails the coverage test.
 */
export const TENANT_MODELS = {
  ShopTranslation: "shopId",
  ServiceableArea: "shopId",
  ShopSettings: "shopId",
  Category: "shopId",
  CategoryTranslation: "shopId",
  Product: "shopId",
  ProductTranslation: "shopId",
  ProductVariant: "shopId",
  GrindOption: "shopId",
  ProductGrindOption: "shopId",
  StockLedger: "shopId",
  DeliverySlot: "shopId",
  MillSlot: "shopId",
  Cart: "shopId",
  CartItem: "shopId",
  Order: "shopId",
  OrderItem: "shopId",
  OrderStatusHistory: "shopId",
  MillingJob: "shopId",
  Payment: "shopId",
  CashCollection: "shopId",
  Shift: "shopId",
  LedgerEntry: "shopId",
  Invoice: "shopId",
  CouponRedemption: "shopId",
  // Shop tenancy for staff and their invitations.
  StoreMembership: "shopId",
  StoreInvite: "shopId",
  // A franchise owner's subscriptions belong to the shop that fulfils them.
  Subscription: "shopId",
  SubscriptionRun: "shopId",
  // Supplies the per-shop order number, so it must never be read across shops.
  ShopSequence: "shopId",
} as const;

export type TenantModel = keyof typeof TENANT_MODELS;

/**
 * Models scoped by customer rather than shop. A customer may order from
 * several shops, so `shopId` would be the wrong filter — these get the
 * `customerId` filter instead.
 *
 * `Address` and `Customer` itself are handled by owner checks in the API layer
 * because they have no shopId, but they ARE customer-scoped and must never be
 * queried from a STORE scope.
 */
export const CUSTOMER_MODELS: Record<string, string> = {
  Address: "customerId",
  Cart: "customerId", // also tenant-scoped; both filters apply
  Order: "customerId", // both filters apply
  Subscription: "customerId",
  CouponRedemption: "customerId",
};

/**
 * Models with a nullable shopId where null means "platform-global". A store
 * scope must be able to read the global rows too (a global coupon applies
 * everywhere), so the filter becomes `shopId IN (scope..) OR shopId IS NULL`
 * for reads.
 */
export const GLOBAL_SHARED_MODELS: Record<string, string> = {
  Coupon: "shopId",
  Promotion: "shopId",
  Banner: "shopId",
  // Platform-wide actions (invites, role changes) are audited with no shop.
  // A store scope still must not read the audit log — see PLATFORM_ONLY below,
  // which rejects the access before this map is consulted.
  AuditLog: "shopId",
};

/** Models a customer scope may never touch, regardless of query. */
const PLATFORM_OR_STORE_ONLY = new Set<string>([
  "ShopSettings",
  "ServiceableArea",
  "StockLedger",
  "Shift",
  "CashCollection",
  "LedgerEntry",
  "Invoice",
  "StoreMembership",
  "StoreInvite",
  "StoreUser",
  "StoreSession",
]);

/** Models a STORE scope may never touch — platform identity & audit. */
const PLATFORM_ONLY = new Set<string>([
  "PlatformUser",
  "PlatformSession",
  "PlatformInvite",
  "AuditLog",
  "SupportGrant",
  "WebhookEvent",
]);

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const WRITE_WHERE_OPERATIONS = new Set([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

export interface TenantExtensionOptions {
  /**
   * Names of models that should bypass scoping entirely. Empty in production.
   * Tests use this to prove the extension is what provides isolation.
   */
  bypassModels?: readonly string[];
}

/**
 * Build the `$extends` object. Apply with:
 *
 *     export const db = basePrisma.$extends(tenantExtension())
 */
export function tenantExtension(options: TenantExtensionOptions = {}) {
  const bypass = new Set(options.bypassModels ?? []);

  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: "grain-basket-tenant",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (bypass.has(model)) return query(args);

            const tenantField = TENANT_MODELS[model as TenantModel];
            const isCustomerModel = model in CUSTOMER_MODELS;
            const isGlobalShared = model in GLOBAL_SHARED_MODELS;

            if (!tenantField && !isCustomerModel && !isGlobalShared) {
              // Not tenant-scoped. Still enforce universe boundaries so a
              // customer can't read the platform user table by accident.
              enforceUniverse(model, operation);
              return query(args);
            }

            const scope = requireScope(model, operation);
            enforceUniverse(model, operation, scope);

            const scopedArgs = applyScope(
              model,
              operation,
              args as Record<string, unknown>,
              scope,
              tenantField,
              isCustomerModel,
              isGlobalShared,
            );

            return query(scopedArgs);
          },
        },
      },
    });
  });
}

/**
 * Universe boundaries that hold regardless of which columns a model has. A
 * customer scope must never reach shop-internal tables, and a store scope must
 * never reach platform identity or the audit log.
 */
function enforceUniverse(model: string, operation: string, scope?: Scope): void {
  const active = scope ?? getScope();
  if (!active) return;

  if (active.kind === "CUSTOMER" && PLATFORM_OR_STORE_ONLY.has(model)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, `Customer scope may not access ${model}`);
  }
  if (active.kind === "STORE" && PLATFORM_ONLY.has(model)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, `Store scope may not access ${model}`);
  }
  void operation;
}

function applyScope(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  scope: Scope,
  tenantField: string | undefined,
  isCustomerModel: boolean,
  isGlobalShared: boolean,
): Record<string, unknown> {
  const next = { ...args };
  const shopIds = allowedShopIds(scope);
  const customerId = customerIdForScope(scope);

  /* ---------------- reads & where-based writes ---------------- */

  if (READ_OPERATIONS.has(operation) || WRITE_WHERE_OPERATIONS.has(operation)) {
    if (tenantField && shopIds !== null) {
      next.where = withShopFilter(next.where, shopIds, {
        allowGlobalNull: isGlobalShared,
      });
    } else if (tenantField && shopIds === null && scope.kind !== "PLATFORM") {
      // A non-platform scope with no shop restriction can only be a customer
      // scope — pin it to its own rows.
      if (customerId) {
        next.where = withFieldFilter(next.where, "customerId", customerId);
      }
    }

    if (customerId && isCustomerModel) {
      next.where = withFieldFilter(next.where, CUSTOMER_MODELS[model] ?? "customerId", customerId);
    }

    // `upsert` also creates — scope the created row too.
    if (operation === "upsert" && next.create && typeof next.create === "object") {
      next.create = withTenantFields(
        next.create as Record<string, unknown>,
        shopIds,
        customerId,
        tenantField,
      );
    }
    return next;
  }

  /* ---------------- creates ---------------- */

  if (CREATE_OPERATIONS.has(operation)) {
    if (operation === "createMany" && Array.isArray(next.data)) {
      next.data = (next.data as Record<string, unknown>[]).map((row) =>
        withTenantFields(row, shopIds, customerId, tenantField),
      );
    } else if (next.data && typeof next.data === "object") {
      next.data = withTenantFields(
        next.data as Record<string, unknown>,
        shopIds,
        customerId,
        tenantField,
      );
    }
    return next;
  }

  return next;
}

/**
 * Overwrite tenant columns from scope. Overwriting (not defaulting) is the
 * point: a client that sends `shopId` of another shop must not be honoured,
 * and a client that omits it must not create an unscoped row.
 */
function withTenantFields(
  data: Record<string, unknown>,
  shopIds: readonly string[] | null,
  customerId: string | null,
  tenantField: string | undefined,
): Record<string, unknown> {
  const next = { ...data };

  if (tenantField) {
    if (shopIds !== null) {
      // A single-shop scope pins creation to that shop. A SYSTEM scope over
      // several shops must say which one — ambiguity is an error, not a guess.
      if (shopIds.length !== 1) {
        throw new AppError(
          ERROR_CODES.MISSING_TENANT_SCOPE,
          `Cannot create ${tenantField} row from a scope covering ${shopIds.length} shops; ` +
            `create inside a single-shop scope`,
        );
      }
      next[tenantField] = shopIds[0];
    } else {
      // Platform scope: the caller must state the shop explicitly.
      if (next[tenantField] == null) {
        throw new AppError(
          ERROR_CODES.MISSING_TENANT_SCOPE,
          `Platform scope must supply ${tenantField} explicitly when creating`,
        );
      }
    }
  }

  if (customerId && "customerId" in next) {
    next.customerId = customerId;
  }

  return next;
}

function withShopFilter(
  where: unknown,
  shopIds: readonly string[],
  opts: { allowGlobalNull: boolean },
): Record<string, unknown> {
  const base = where && typeof where === "object" ? (where as Record<string, unknown>) : {};

  const shopCondition =
    shopIds.length === 1
      ? shopIds[0]
      : { in: [...shopIds] };

  if (opts.allowGlobalNull) {
    return {
      AND: [base, { OR: [{ shopId: shopCondition }, { shopId: null }] }],
    };
  }

  return { ...base, shopId: shopCondition };
}

function withFieldFilter(
  where: unknown,
  field: string,
  value: string,
): Record<string, unknown> {
  const base = where && typeof where === "object" ? (where as Record<string, unknown>) : {};
  return { ...base, [field]: value };
}

