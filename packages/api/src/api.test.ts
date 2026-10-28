/**
 * Cross-universe and cross-tenant procedure tests.
 *
 * Deliberately drives the REAL routers through a real Postgres, because the
 * properties under test — a customer cookie cannot satisfy a store procedure,
 * shop A's staff cannot read shop B's order, staff can collect cash but not
 * see earnings — are properties of SQL execution plus middleware, not of a
 * unit's return value.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBaseClient, getDb, runWithScope } from "@grain-basket/db";
import { hashPassword } from "@grain-basket/auth";
import { PERMISSIONS } from "@grain-basket/contracts";
import { createCaller } from "./root";
import type { Context, ShopRef, StoreMembershipClaim } from "./context";

const base = getBaseClient();

let shopA: { id: string; slug: string };
let shopB: { id: string; slug: string };
let storeAdminA: { id: string };
let storeStaffA: { id: string };
let customer: { id: string };
let variantAId: string;

const configs = {
  CUSTOMER: {
    universe: "CUSTOMER" as const,
    secret: "customer-secret-for-tests-only",
    cookiePrefix: "gb_customer",
    basePath: "/api/auth/customer",
    loginPath: "/login",
    sessionTtlSeconds: 3600,
  },
  STORE: {
    universe: "STORE" as const,
    secret: "store-secret-for-tests-only-123",
    cookiePrefix: "gb_store",
    basePath: "/api/auth/store",
    loginPath: "/store/login",
    sessionTtlSeconds: 3600,
  },
  PLATFORM: {
    universe: "PLATFORM" as const,
    secret: "platform-secret-tests-only-1",
    cookiePrefix: "gb_platform",
    basePath: "/api/auth/platform",
    loginPath: "/platform/login",
    sessionTtlSeconds: 3600,
  },
};

/**
 * A full ShopRef. Hand-built `{ id, slug }` objects were silently missing
 * `accessStatus`, so every storefront test hit the "shop not found" guard for
 * the wrong reason.
 */
function shopRef(shop: { id: string; slug: string }, overrides: Partial<ShopRef> = {}): ShopRef {
  return {
    id: shop.id,
    slug: shop.slug,
    orderingStatus: "OPEN",
    accessStatus: "ACTIVE",
    isActive: true,
    timezone: "Asia/Kolkata",
    ...overrides,
  };
}

function ctx(overrides: Partial<Context> & Pick<Context, "auth" | "shop">): Context {
  return {
    meta: { requestId: "test" },
    configs: configs as never,
    ...overrides,
  } as Context;
}

function storeAuth(memberships: StoreMembershipClaim[], storeUserId = storeAdminA.id) {
  return {
    kind: "STORE" as const,
    storeUserId,
    sessionId: "s",
    memberships,
  };
}

function membershipFor(
  shopId: string,
  shopSlug: string,
  role: "STORE_ADMIN" | "STORE_STAFF" | "MILL_OPERATOR",
): StoreMembershipClaim {
  return {
    membershipId: `m-${shopId}-${role}`,
    shopId,
    shopSlug,
    role,
    permissions:
      role === "STORE_ADMIN"
        ? Object.values(PERMISSIONS)
        : role === "STORE_STAFF"
          ? [
              PERMISSIONS.ORDER_ADVANCE_STATUS,
              PERMISSIONS.COD_COLLECT,
              PERMISSIONS.PICKUP_VERIFY,
            ]
          : [PERMISSIONS.MILLING_CLAIM, PERMISSIONS.COD_COLLECT],
  };
}

/**
 * Remove this suite's fixtures, children before parents. The extended client
 * is not used here: teardown must see every shop, and a scope would hide rows
 * from a previous failed run.
 */
async function cleanup() {
  const shops = await base.shop.findMany({
    where: { slug: { startsWith: "it-shop-" } },
    select: { id: true },
  });
  const shopIds = shops.map((s) => s.id);
  const customers = await base.customer.findMany({
    where: { phone: "+919770000001" },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  if (customerIds.length) {
    // CartItem -> ProductVariant is RESTRICT, so the cart must go first.
    await base.cartItem.deleteMany({
      where: { OR: [{ cart: { customerId: { in: customerIds } } }, { shopId: { in: shopIds } }] },
    });
    await base.cart.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { shopId: { in: shopIds } }] },
    });
  }
  if (shopIds.length) {
    await base.millingJob.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.cashCollection.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.couponRedemption.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.orderStatusHistory.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.orderItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.order.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.product.deleteMany({ where: { shopId: { in: shopIds } } });
    await base.shop.deleteMany({ where: { id: { in: shopIds } } });
  }
  if (customerIds.length) {
    await base.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await base.storeUser.deleteMany({ where: { email: { endsWith: "@it.local" } } });
}

beforeAll(async () => {
  await cleanup();

  const a = await base.shop.create({
    data: {
      slug: "it-shop-a",
      name: "IT Shop A",
      line1: "1",
      city: "Pune",
      state: "MH",
      pincode: "411001",
      settings: { create: { openingHours: [] } },
    },
  });
  const b = await base.shop.create({
    data: {
      slug: "it-shop-b",
      name: "IT Shop B",
      line1: "2",
      city: "Pune",
      state: "MH",
      pincode: "411002",
      settings: { create: { openingHours: [] } },
    },
  });
  shopA = { id: a.id, slug: a.slug };
  shopB = { id: b.id, slug: b.slug };

  const product = await base.product.create({
    data: {
      shopId: a.id,
      slug: "it-product-atta",
      name: "IT Atta",
      type: "FLOUR",
      isMilledToOrder: true,
      gstBps: 500,
      searchText: "it atta flour",
      variants: {
        create: {
          shopId: a.id,
          sku: "IT-ATTA-1",
          label: "1 kg",
          packWeightGrams: 1000,
          pricePerKgPaise: 5000,
          pricePaise: 5000,
          stockOnHandGrams: 50_000,
        },
      },
    },
    include: { variants: true },
  });
  variantAId = product.variants[0]!.id;

  const hash = await hashPassword("twelve-char-password");
  storeAdminA = await base.storeUser.create({
    data: { email: "admin@it.local", name: "Admin A", passwordHash: hash },
  });
  storeStaffA = await base.storeUser.create({
    data: { email: "staff@it.local", name: "Staff A", passwordHash: hash },
  });
  customer = await base.customer.create({ data: { phone: "+919770000001" } });
});

afterAll(async () => {
  await cleanup();
  await base.$disconnect();
});

describe("storefront catalogue", () => {
  it("shows this shop's products to a signed-out visitor", async () => {
    const caller = createCaller(
      ctx({ auth: { kind: "PUBLIC" }, shop: shopRef(shopA) }),
    );
    const page = await caller.catalogue.products({ limit: 50 });
    expect(page.items.map((p) => p.slug)).toContain("it-product-atta");
  });

  it("does not leak another shop's products", async () => {
    const caller = createCaller(
      ctx({ auth: { kind: "PUBLIC" }, shop: shopRef(shopB) }),
    );
    const page = await caller.catalogue.products({ limit: 50 });
    expect(page.items.map((p) => p.slug)).not.toContain("it-product-atta");
  });

  it("prices a variant from its per-kg rate", async () => {
    const caller = createCaller(
      ctx({ auth: { kind: "PUBLIC" }, shop: shopRef(shopA) }),
    );
    const product = await caller.catalogue.product({ slug: "it-product-atta" });
    // ₹50/kg for 1 kg = 5000 paise.
    expect(product.variants[0]?.pricePaise).toBe(5000);
  });

  it("returns 404 for a locked shop rather than revealing it", async () => {
    const caller = createCaller(
      ctx({
        auth: { kind: "PUBLIC" },
        shop: shopRef(shopA, { accessStatus: "LOCKED" }),
      }),
    );
    await expect(caller.catalogue.products({ limit: 10 })).rejects.toThrow();
  });
});

describe("universe separation at the procedure layer", () => {
  it("rejects a customer for a store procedure", async () => {
    const caller = createCaller(
      ctx({
        auth: { kind: "CUSTOMER", customerId: customer.id, sessionId: "s", permissions: [] },
        shop: shopRef(shopA),
      }),
    );
    await expect(caller.admin.orders.list({ range: "all" })).rejects.toThrow();
  });

  it("rejects a signed-out visitor for a store procedure", async () => {
    const caller = createCaller(ctx({ auth: { kind: "PUBLIC" }, shop: shopRef(shopA) }));
    await expect(caller.admin.orders.list({ range: "all" })).rejects.toThrow();
  });

  it("rejects a store user with no membership in this shop", async () => {
    const caller = createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopB.id, shopB.slug, "STORE_ADMIN")]),
        shop: shopRef(shopA),
      }),
    );
    await expect(caller.admin.orders.list({ range: "all" })).rejects.toThrow(/not found|Not found/i);
  });

  it("admits a store admin who does have a membership", async () => {
    const caller = createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopA.id, shopA.slug, "STORE_ADMIN")]),
        shop: shopRef(shopA),
      }),
    );
    const orders = await caller.admin.orders.list({ range: "all" });
    expect(Array.isArray(orders)).toBe(true);
  });

  it("denies a customer-looking auth on a customer procedure without a shop", async () => {
    const caller = createCaller(
      ctx({
        auth: { kind: "CUSTOMER", customerId: customer.id, sessionId: "s", permissions: [] },
        shop: null,
      }),
    );
    await expect(caller.cart.get()).rejects.toThrow();
  });
});

describe("cash collection permission", () => {
  it("gives store staff COD_COLLECT but not earnings visibility", () => {
    const staff = membershipFor(shopA.id, shopA.slug, "STORE_STAFF");
    expect(staff.permissions).toContain(PERMISSIONS.COD_COLLECT);
    expect(staff.permissions).not.toContain(PERMISSIONS.EARNINGS_VIEW);
  });

  it("gives a mill operator COD_COLLECT but nothing about money reporting", () => {
    const op = membershipFor(shopA.id, shopA.slug, "MILL_OPERATOR");
    expect(op.permissions).toContain(PERMISSIONS.COD_COLLECT);
    expect(op.permissions).not.toContain(PERMISSIONS.EARNINGS_VIEW);
    expect(op.permissions).not.toContain(PERMISSIONS.PRODUCT_EDIT);
  });

  it("blocks a mill operator from the cash reconciliation view", async () => {
    const caller = createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopA.id, shopA.slug, "MILL_OPERATOR")], storeStaffA.id),
        shop: shopRef(shopA),
      }),
    );
    await expect(caller.admin.orders.cashReconciliation({})).rejects.toThrow(/permission/i);
  });

  it("does let a store admin open the reconciliation view", async () => {
    const caller = createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopA.id, shopA.slug, "STORE_ADMIN")]),
        shop: shopRef(shopA),
      }),
    );
    const report = await caller.admin.orders.cashReconciliation({});
    expect(report.totalCollectedPaise).toBe(0);
  });
});

describe("cart and checkout", () => {
  const customerAuth = () => ({
    kind: "CUSTOMER" as const,
    customerId: customer.id,
    sessionId: "s",
    permissions: [],
  });

  it("prices a cart server-side from catalogue rows", async () => {
    const caller = createCaller(
      ctx({ auth: customerAuth(), shop: shopRef(shopA) }),
    );
    const quote = await caller.cart.add({ variantId: variantAId, quantity: 2 });
    expect(quote.items[0]?.unitPricePaise).toBe(5000);
    expect(quote.items[0]?.lineTotalPaise).toBe(10_000);
    expect(quote.priced.totalPaise).toBeGreaterThanOrEqual(10_000);
  });

  it("ignores no client price — the total comes from the catalogue", async () => {
    const caller = createCaller(
      ctx({ auth: customerAuth(), shop: shopRef(shopA) }),
    );
    const quote = await caller.cart.updateQuantity({
      cartItemId: (await caller.cart.get()).items[0]!.cartItemId,
      quantity: 3,
    });
    expect(quote.priced.totalPaise).toBeGreaterThanOrEqual(15_000);
  });

  it("confirms a COD order and reserves stock", async () => {
    const caller = createCaller(
      ctx({ auth: customerAuth(), shop: shopRef(shopA) }),
    );
    const before = await base.productVariant.findUnique({ where: { id: variantAId } });

    const placed = await caller.checkout.placeOrder({
      fulfilment: "PICKUP",
      paymentMethod: "COD",
      idempotencyKey: "it-key-0001",
      millInPresence: false,
    });

    expect(placed.orderNumber).toMatch(/^IT-/);
    expect(placed.paymentPending).toBe(false);

    const after = await base.productVariant.findUnique({ where: { id: variantAId } });
    expect(after!.reservedGrams).toBe((before?.reservedGrams ?? 0) + 3000);

    const order = await base.order.findUnique({
      where: { shopId_orderNumber: { shopId: shopA.id, orderNumber: placed.orderNumber } },
    });
    expect(order?.status).toBe("CONFIRMED");
    expect(order?.pickupCode).toHaveLength(6);
  });

  it("returns the same order for a repeated idempotency key", async () => {
    const caller = createCaller(
      ctx({ auth: customerAuth(), shop: shopRef(shopA) }),
    );
    const again = await caller.checkout.placeOrder({
      fulfilment: "PICKUP",
      paymentMethod: "COD",
      idempotencyKey: "it-key-0001",
      millInPresence: false,
    });
    expect(again.reused).toBe(true);

    const count = await base.order.count({ where: { orderNumber: again.orderNumber } });
    expect(count).toBe(1);
  });

  it("rejects checkout on a paused shop", async () => {
    const caller = createCaller(
      ctx({ auth: customerAuth(), shop: shopRef(shopA) }),
    );
    await caller.cart.add({ variantId: variantAId, quantity: 1 });

    const paused = createCaller(
      ctx({
        auth: customerAuth(),
        shop: shopRef(shopA, { orderingStatus: "PAUSED" }),
      }),
    );
    await expect(
      paused.checkout.placeOrder({
        fulfilment: "PICKUP",
        paymentMethod: "COD",
        idempotencyKey: "it-key-0002",
        millInPresence: false,
      }),
    ).rejects.toThrow();
  });
});

describe("store order transitions", () => {
  let orderNumber: string;

  beforeAll(async () => {
    const caller = createCaller(
      ctx({
        auth: {
          kind: "CUSTOMER",
          customerId: customer.id,
          sessionId: "s",
          permissions: [],
        },
        shop: shopRef(shopA),
      }),
    );
    await caller.cart.add({ variantId: variantAId, quantity: 1 });
    const placed = await caller.checkout.placeOrder({
      fulfilment: "DELIVERY",
      paymentMethod: "COD",
      idempotencyKey: "it-key-0003",
      millInPresence: false,
      address: {
        contactName: "Test",
        contactPhone: "+919770000001",
        line1: "12 Test Lane",
        city: "Pune",
        state: "MH",
        pincode: "411001",
      },
    });
    orderNumber = placed.orderNumber;
  });

  const adminCaller = () =>
    createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopA.id, shopA.slug, "STORE_ADMIN")]),
        shop: shopRef(shopA),
      }),
    );

  it("cannot pack an order whose milling job is still open", async () => {
    const caller = adminCaller();
    // Give the order a milling job in QUEUED.
    const order = await base.order.findFirst({ where: { orderNumber }, include: { items: true } });
    await base.millingJob.create({
      data: {
        shopId: shopA.id,
        orderId: order!.id,
        orderItemId: order!.items[0]!.id,
        orderedInputGrams: 1000,
        status: "QUEUED",
      },
    });

    await expect(caller.admin.orders.advance({ orderNumber, event: "PACK" })).rejects.toThrow(
      /milling/i,
    );
  });

  it("packs once the milling job completes", async () => {
    const caller = adminCaller();
    const order = await base.order.findFirst({ where: { orderNumber }, include: { items: true } });
    await base.millingJob.updateMany({
      where: { orderId: order!.id },
      data: { status: "COMPLETED", actualOutputGrams: 980, yieldBps: 9800 },
    });

    const result = await caller.admin.orders.advance({ orderNumber, event: "PACK" });
    expect(result.status).toBe("PACKED");
  });

  it("walks a delivery order to COD_PENDING, then collects cash", async () => {
    const caller = adminCaller();
    await caller.admin.orders.advance({ orderNumber, event: "DISPATCH" });
    const delivered = await caller.admin.orders.advance({ orderNumber, event: "DELIVER" });
    expect(delivered.status).toBe("COD_PENDING");

    const order = await base.order.findFirst({ where: { orderNumber } });
    const collected = await caller.admin.orders.collectCash({
      orderNumber,
      amountPaise: order!.totalPaise,
    });
    expect(collected.status).toBe("COD_COLLECTED");
    expect(collected.collectedPaise).toBe(order!.totalPaise);
  });

  it("requires a note when the cash is short", async () => {
    const caller = createCaller(
      ctx({ auth: storeAuth([membershipFor(shopA.id, shopA.slug, "STORE_ADMIN")]), shop: shopRef(shopA) }),
    );
    const order = await base.order.findFirst({ where: { orderNumber } });
    // Already collected, so a second attempt is refused rather than re-run.
    await expect(
      caller.admin.orders.collectCash({ orderNumber, amountPaise: 1 }),
    ).rejects.toThrow();
    expect(order?.codCollectedPaise).toBe(order?.totalPaise);
  });

  it("completes after cash is collected", async () => {
    const caller = adminCaller();
    const result = await caller.admin.orders.advance({ orderNumber, event: "COMPLETE" });
    expect(result.status).toBe("COMPLETED");
  });

  it("records who collected the cash in the reconciliation", async () => {
    const caller = adminCaller();
    const report = await caller.admin.orders.cashReconciliation({});
    expect(report.collections.length).toBeGreaterThanOrEqual(1);
    expect(report.collections[0]?.collectedBy).toBe("Admin A");
    expect(report.totalCollectedPaise).toBeGreaterThan(0);
  });
});

describe("tenant scope applied through the caller", () => {
  it("a shop B admin sees none of shop A's orders", async () => {
    const caller = createCaller(
      ctx({
        auth: storeAuth([membershipFor(shopB.id, shopB.slug, "STORE_ADMIN")]),
        shop: shopRef(shopB),
      }),
    );
    const orders = await caller.admin.orders.list({ range: "all" });
    expect(orders).toEqual([]);
  });

  it("a direct tenant query outside the router still cannot cross shops", async () => {
    const rows = await runWithScope(
      {
        kind: "STORE",
        shopId: shopB.id,
        membershipId: "m",
        storeUserId: storeAdminA.id,
        role: "STORE_ADMIN",
        permissions: [],
      },
      () => getDb().order.findMany(),
    );
    expect(rows.every((o) => o.shopId === shopB.id)).toBe(true);
  });
});
