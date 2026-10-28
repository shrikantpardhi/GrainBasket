/**
 * The request context, and the only place a `Scope` is ever constructed from a
 * live request.
 *
 * Three universes, three cookie prefixes, three session tables. There is no
 * combined "who am I" that tries each in turn: `buildContext` reads the cookie
 * for the universe the ROUTER asked for, and nothing else. A customer cookie
 * presented to a store router yields no session, which is the separation
 * working rather than an error to work around.
 *
 * The storefront is also browsable signed out, so the context can be
 * `PUBLIC` — a visitor pinned to one shop who may read its catalogue and
 * nothing else.
 */

import {
  getUniverseConfigs,
  resolveSession,
  sessionCookieName,
  type UniverseConfig,
} from "@grain-basket/auth";
import {
  AppError,
  ERROR_CODES,
  PLATFORM_ROLE_PERMISSIONS,
  STORE_ROLE_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  type PlatformRole,
  type StoreRole,
} from "@grain-basket/contracts";
import { getBaseClient, type Scope } from "@grain-basket/db";

export interface CookieReader {
  /** Raw cookie value, or undefined when absent. */
  get(name: string): string | undefined;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId: string;
}

/** A shop as it appears in a storefront request. */
export interface ShopRef {
  id: string;
  slug: string;
  orderingStatus: string;
  accessStatus: string;
  isActive: boolean;
  timezone: string;
}

/**
 * Who is making this request.
 *
 * `PUBLIC` carries no claims — it is a visitor who has not logged in. The
 * context is intentionally a union rather than `session: Session | null`
 * because a null session on a store procedure is a different failure from a
 * visitor browsing, and conflating them is how an unauthenticated request
 * reaches a back office.
 */
export type Auth =
  | { kind: "PUBLIC" }
  | {
      kind: "CUSTOMER";
      customerId: string;
      sessionId: string;
      permissions: typeof CUSTOMER_PERMISSIONS;
    }
  | {
      kind: "STORE";
      storeUserId: string;
      sessionId: string;
      /** Every active membership for this user, resolved from the DB. */
      memberships: readonly StoreMembershipClaim[];
    }
  | {
      kind: "PLATFORM";
      platformUserId: string;
      sessionId: string;
      role: PlatformRole;
      permissions: readonly string[];
    };

export interface StoreMembershipClaim {
  membershipId: string;
  shopId: string;
  shopSlug: string;
  role: StoreRole;
  permissions: readonly string[];
}

export interface Context {
  auth: Auth;
  /** The shop the request targets, when it targets one. */
  shop: ShopRef | null;
  meta: RequestMeta;
  configs: Record<"CUSTOMER" | "STORE" | "PLATFORM", UniverseConfig>;
  /**
   * The raw session token presented for THIS universe, if any. Only sign-out
   * needs it — everywhere else goes through the resolved `auth`.
   */
  cookieToken?: string;
}

export interface BuildContextInput {
  cookies: CookieReader;
  headers?: { ip?: string; userAgent?: string };
  requestId?: string;
  /** Resolve a shop by slug before auth, so membership checks can be scoped. */
  shopSlug?: string;
}

/**
 * Build a request context.
 *
 * Deliberately does NOT look for a session it wasn't asked for. The caller
 * says which universe by calling `buildCustomerContext`, `buildStoreContext`,
 * or `buildPlatformContext`. `buildContext` exists for the storefront, which
 * accepts public, customer, and store-session-as-customer.
 */
export async function buildContext(input: BuildContextInput): Promise<Context> {
  const configs = getUniverseConfigs();
  const meta: RequestMeta = {
    ip: input.headers?.ip,
    userAgent: input.headers?.userAgent,
    requestId: input.requestId ?? crypto.randomUUID(),
  };

  const shop = input.shopSlug ? await findShopBySlug(input.shopSlug) : null;

  // A storefront request authenticates as a customer if a customer session is
  // present. It deliberately does not fall back to store or platform cookies.
  const token = input.cookies.get(sessionCookieName(configs.CUSTOMER.cookiePrefix));
  const resolved = await resolveSession(configs.CUSTOMER, token);

  const auth: Auth = resolved
    ? {
        kind: "CUSTOMER",
        customerId: resolved.userId,
        sessionId: resolved.sessionId,
        permissions: CUSTOMER_PERMISSIONS,
      }
    : { kind: "PUBLIC" };

  return { auth, shop, meta, configs, cookieToken: token };
}

/** Store back office: a store session, and nothing else. */
export async function buildStoreContext(input: BuildContextInput): Promise<Context> {
  const configs = getUniverseConfigs();
  const meta: RequestMeta = {
    ip: input.headers?.ip,
    userAgent: input.headers?.userAgent,
    requestId: input.requestId ?? crypto.randomUUID(),
  };

  const shop = input.shopSlug ? await findShopBySlug(input.shopSlug) : null;
  const token = input.cookies.get(sessionCookieName(configs.STORE.cookiePrefix));
  const resolved = await resolveSession(configs.STORE, token);

  if (!resolved) {
    return { auth: { kind: "PUBLIC" }, shop, meta, configs, cookieToken: token };
  }

  const memberships = await loadMemberships(resolved.userId);

  return {
    auth: {
      kind: "STORE",
      storeUserId: resolved.userId,
      sessionId: resolved.sessionId,
      memberships,
    },
    shop,
    meta,
    configs,
    cookieToken: token,
  };
}

/** Platform console: a platform session, and nothing else. */
export async function buildPlatformContext(input: BuildContextInput): Promise<Context> {
  const configs = getUniverseConfigs();
  const meta: RequestMeta = {
    ip: input.headers?.ip,
    userAgent: input.headers?.userAgent,
    requestId: input.requestId ?? crypto.randomUUID(),
  };

  const shop = input.shopSlug ? await findShopBySlug(input.shopSlug) : null;
  const token = input.cookies.get(sessionCookieName(configs.PLATFORM.cookiePrefix));
  const resolved = await resolveSession(configs.PLATFORM, token);

  if (!resolved) {
    return { auth: { kind: "PUBLIC" }, shop, meta, configs, cookieToken: token };
  }

  const user = await getBaseClient().platformUser.findUnique({
    where: { id: resolved.userId },
  });
  if (!user || user.status !== "ACTIVE") {
    return { auth: { kind: "PUBLIC" }, shop, meta, configs, cookieToken: token };
  }

  const role = user.role as PlatformRole;

  return {
    auth: {
      kind: "PLATFORM",
      platformUserId: user.id,
      sessionId: resolved.sessionId,
      role,
      permissions: PLATFORM_ROLE_PERMISSIONS[role] ?? [],
    },
    shop,
    meta,
    configs,
    cookieToken: token,
  };
}

async function findShopBySlug(slug: string): Promise<ShopRef | null> {
  const shop = await getBaseClient().shop.findUnique({ where: { slug } });
  if (!shop) return null;
  return {
    id: shop.id,
    slug: shop.slug,
    orderingStatus: shop.orderingStatus,
    accessStatus: shop.accessStatus,
    isActive: shop.isActive,
    timezone: shop.timezone,
  };
}

async function loadMemberships(storeUserId: string): Promise<StoreMembershipClaim[]> {
  const rows = await getBaseClient().storeMembership.findMany({
    where: { storeUserId, status: "ACTIVE" },
    include: { shop: true },
  });

  return rows
    .filter((row) => row.shop.accessStatus === "ACTIVE")
    .map((row) => {
      const role = row.role as StoreRole;
      const base = STORE_ROLE_PERMISSIONS[role] ?? [];
      // Extra capabilities only ever ADD — the schema says so, and honouring
      // a "revoke" list here would make the role map advisory.
      const grants = (row.capabilities ?? []) as unknown as string[];
      return {
        membershipId: row.id,
        shopId: row.shopId,
        shopSlug: row.shop.slug,
        role,
        permissions: Array.from(new Set([...base, ...grants])),
      };
    });
}

/**
 * The scope a storefront request should run in.
 *
 * Signed in: the customer, pinned to this shop. Signed out: a public visitor,
 * also pinned. Both are shop-bound because the storefront URL names a shop —
 * there is no "all shops" storefront.
 */
export function storefrontScope(ctx: Context): Scope {
  if (!ctx.shop) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "No shop in this request");
  }
  if (ctx.auth.kind === "CUSTOMER") {
    return {
      kind: "CUSTOMER",
      customerId: ctx.auth.customerId,
      sessionId: ctx.auth.sessionId,
      shopIds: [ctx.shop.id],
    };
  }
  return { kind: "PUBLIC", shopIds: [ctx.shop.id] };
}
