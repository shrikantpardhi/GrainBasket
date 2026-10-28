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

/**
 * What a logged-out visitor may read. An allowlist, deliberately: a new private
 * model is denied without anyone remembering to add it here. Public catalogue
 * browsing is the entire storefront surface for someone with no session.
 *
 * `Shop` has no `shopId` column (its primary key IS the tenant key), so it is
 * handled by a separate id filter — see ID_FILTERED.
 */
const PUBLIC_ALLOWED = new Set<string>([
  "Shop",
  "ShopTranslation",
  "ShopSettings",
  "ServiceableArea",
  "Category",
  "CategoryTranslation",
  "Product",
  "ProductTranslation",
  "ProductVariant",
  "GrindOption",
  "ProductGrindOption",
  "Banner",
  "Promotion",
  "Coupon",
  "DeliverySlot",
]);

/**
 * Models keyed by a column other than `shopId` that still must be narrowed.
 * `Shop` is public but a scoped visitor should only reach the shop(s) in their
 * scope; `Customer` is keyed by its own id, so a customer scope filters on
 * `id` rather than inventing a `customerId` column that would be null for
 * self.
 */
const ID_FILTERED: Record<string, string> = {
  Shop: "id",
  Customer: "id",
};

/** Models a customer scope may never touch, regardless of query. */
const PLATFORM_OR_STORE_ONLY = new Set<string>([
  "ShopSettings",
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

/** Models only a PLATFORM scope may touch — identity internals & audit. */
const PLATFORM_ONLY = new Set<string>([
  "PlatformUser",
  "PlatformSession",
  "PlatformInvite",
  "OtpChallenge",
  "AuditLog",
  "SupportGrant",
  "WebhookEvent",
]);

/**
 * Models no user-facing scope may read directly.
 *
 * `Customer` and `Address` are here because they have no `shopId`: without a
 * deny, a STORE or PUBLIC scope would reach every customer's phone number and
 * home address. Orders carry `contactName`/`contactPhone`/`addressSnapshot`
 * precisely so the storefront and back office never need the live rows.
 * Customers reach their own through the CUSTOMER branch below, which pins them
 * by id.
 */
const NEVER_UNSCOPED = new Set<string>(["Customer", "Address"]);

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

/**
 * `findUnique` takes only unique fields, so a scope filter cannot simply be
 * added to its where — but with the extended client an extra field may be
 * ANDed in, and the key must be preserved rather than overwritten.
 */
const UNIQUE_LOOKUPS = new Set(["findUnique", "findUniqueOrThrow"]);

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
            const idField = ID_FILTERED[model];

            if (!tenantField && !isCustomerModel && !isGlobalShared && !idField) {
              // Not tenant-scoped. Still enforce universe boundaries so a
              // customer can't read the platform user table by accident.
              enforceUniverse(model, operation);
              return query(args);
            }

            if (idField) {
              // Keyed by something other than shopId/customerId — `Shop` (its
              // PK is the tenant key) and a customer's own `Customer` row.
              const scope = requireScope(model, operation);
              enforceUniverse(model, operation, scope);
              const scoped = applyIdFilter(
                model,
                operation,
                args as Record<string, unknown>,
                scope,
                idField,
              );
              // A `whereUnique` out of scope cannot be expressed as a filter,
              // so the query must not run at all.
              if (scoped === DENY) {
                if (operation === "findUniqueOrThrow" || operation.endsWith("OrThrow")) {
                  throw new AppError(ERROR_CODES.NOT_FOUND, `${model} not found`);
                }
                return null;
              }
              return query(scoped);
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

  switch (active.kind) {
    case "PLATFORM":
      return;

    case "SYSTEM":
      // Background jobs act on behalf of no user. They still may not read
      // identity internals — a cron or webhook has no business seeing a
      // customer's phone number directly.
      if (PLATFORM_ONLY.has(model) || NEVER_UNSCOPED.has(model)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `SYSTEM job "${active.job}" may not access ${model}`,
        );
      }
      return;

    case "STORE":
      if (PLATFORM_ONLY.has(model) || NEVER_UNSCOPED.has(model)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `Store scope may not access ${model}; use the order snapshot instead`,
        );
      }
      return;

    case "CUSTOMER":
      // A customer reads the public catalogue plus their own rows. A shop's
      // delivery fees and minimum order are public — checkout cannot work
      // without them — so they stay readable, unlike stock levels or settings.
      if (
        (PLATFORM_OR_STORE_ONLY.has(model) || PLATFORM_ONLY.has(model)) &&
        !PUBLIC_ALLOWED.has(model)
      ) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `Customer scope may not access ${model}`);
      }
      // Being readable on the storefront is not a licence to write. The
      // catalogue, banners, coupons and shop settings are all in
      // PUBLIC_ALLOWED, and without this a customer could reprice a product
      // or mint themselves a coupon. A customer's own writes land on Cart,
      // Order, Address, Subscription and CouponRedemption — none of which are
      // storefront-readable — so nothing legitimate is denied here.
      if (PUBLIC_ALLOWED.has(model) && !READ_OPERATIONS.has(operation)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `Customer scope may not ${operation} ${model}`,
        );
      }
      return;

    case "PUBLIC":
      if (!PUBLIC_ALLOWED.has(model)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `A signed-out visitor may not access ${model}`,
        );
      }
      // Signed-out means read-only. A browse endpoint must never be able to
      // write, even to a model it is allowed to read.
      if (!READ_OPERATIONS.has(operation)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `A signed-out visitor may not ${operation} ${model}`,
        );
      }
      return;
  }
  void operation;
}

/**
 * Narrow a model that is keyed by neither `shopId` nor `customerId`.
 *
 *   Shop      -> the shop ids in scope (its `id` IS the tenant key)
 *   Customer  -> a customer scope sees only itself; other scopes are already
 *                denied by NEVER_UNSCOPED, so this branch is CUSTOMER-only.
 */
function applyIdFilter(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  scope: Scope,
  idField: string,
): Record<string, unknown> | typeof DENY {
  const next = { ...args };
  const isUniqueLookup = UNIQUE_LOOKUPS.has(operation);

  if (READ_OPERATIONS.has(operation) || WRITE_WHERE_OPERATIONS.has(operation)) {
    const condition = idFilterCondition(model, scope, idField);
    if (condition === null) {
      // Platform scope: no restriction.
    } else if (condition === DENY) {
      // Only a customer scope reaches the Customer branch; anything else has
      // already been rejected upstream.
      if (isUniqueLookup) return DENY;
      next.where = withFieldFilter(next.where, idField, DENY);
    } else if (isUniqueLookup) {
      // `whereUnique` accepts only unique fields, so there is nowhere to add a
      // scope filter. Compare the key the caller asked for instead of
      // overwriting it — overwriting would return a DIFFERENT row than the one
      // requested, a leak that reads as a successful lookup.
      const requested = (next.where as Record<string, unknown> | undefined)?.[idField];
      if (!matchesCondition(requested, condition)) return DENY;
    } else {
      next.where = withFieldFilter(next.where, idField, condition);
    }
  }
  return next;
}

function matchesCondition(
  requested: unknown,
  condition: string | { in: string[] },
): boolean {
  // A compound or non-id key cannot be proven in scope without a query; let
  // the SQL filter decide (Prisma will reject a key with no matching columns).
  if (typeof requested !== "string") return true;
  return typeof condition === "string" ? requested === condition : condition.in.includes(requested);
}

/** Marker meaning "this scope may see no row at all". */
const DENY = "__DENY__" as const;

/**
 * The value `idField` must equal for this scope, or `null` for unrestricted.
 */
function idFilterCondition(
  model: string,
  scope: Scope,
  idField: string,
): string | { in: string[] } | typeof DENY | null {
  if (model === "Customer") {
    // Only a customer scope reaches here — other scopes are denied upstream.
    return scope.kind === "CUSTOMER" ? scope.customerId : DENY;
  }

  const shopIds = allowedShopIds(scope);
  if (shopIds === null) return null; // platform
  const only = shopIds[0];
  if (shopIds.length === 1 && only) return only;
  return { in: [...shopIds] };
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
    // `shopIds === null` happens only in a PLATFORM scope, where leaving the
    // filter off is the deliberate, audited choice. Every other scope —
    // including a customer's — carries the shops it may see, so no branch here
    // can fall through to an unscoped query.
    if (tenantField && shopIds !== null) {
      next.where = withShopFilter(next.where, shopIds, {
        allowGlobalNull: isGlobalShared,
      });
    }

    // A customer's own rows are narrowed again by customerId. Catalogue rows
    // have no customerId, so they stay shop-wide — which is what a storefront
    // needs and nothing more.
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
  value: string | { in: string[] } | typeof DENY,
): Record<string, unknown> {
  if (value === DENY) {
    // Matches no row: the deny-by-default answer for an out-of-scope lookup.
    return { ...(where && typeof where === "object" ? (where as Record<string, unknown>) : {}), [field]: { in: [] } };
  }
  const base = where && typeof where === "object" ? (where as Record<string, unknown>) : {};
  return { ...base, [field]: value };
}

