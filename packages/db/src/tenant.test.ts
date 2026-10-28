/**
 * Tenancy isolation tests. These run against a real Postgres (the docker
 * compose service) because the thing being tested is what SQL actually
 * executes — mocking Prisma would test the mock, not the isolation.
 *
 * Run with `pnpm db:up` first, then `pnpm --filter @grain-basket/db test`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBaseClient, getDb } from "./client";
import {
  runWithScope,
  MissingScopeError,
  toPublicScope,
  toCustomerScope,
  type StoreScope,
  type PlatformScope,
} from "./scope";

const base = getBaseClient();
const db = getDb();

let shopAId: string;
let shopBId: string;
let productAId: string;
let productBId: string;

const platformScope: PlatformScope = {
  kind: "PLATFORM",
  platformUserId: "test-platform-admin",
  role: "PLATFORM_ADMIN",
  permissions: [],
  requestId: "test-request",
};

function storeScope(shopId: string): StoreScope {
  return {
    kind: "STORE",
    shopId,
    membershipId: `membership-${shopId}`,
    storeUserId: `user-${shopId}`,
    role: "STORE_ADMIN",
    permissions: [],
  };
}

beforeAll(async () => {
  // Clean slate for the fixtures this file owns. Base (unscoped) client: the
  // extension correctly refuses to do this.
  await base.order.deleteMany({ where: { orderNumber: { startsWith: "TEST-" } } });
  await base.product.deleteMany({ where: { slug: { startsWith: "test-product-" } } });
  await base.shop.deleteMany({ where: { slug: { startsWith: "test-shop-" } } });

  const shopA = await base.shop.create({
    data: {
      slug: "test-shop-a",
      name: "Test Shop A",
      line1: "1 Test Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
    },
  });
  const shopB = await base.shop.create({
    data: {
      slug: "test-shop-b",
      name: "Test Shop B",
      line1: "2 Test Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411002",
    },
  });
  shopAId = shopA.id;
  shopBId = shopB.id;

  const productA = await base.product.create({
    data: { shopId: shopAId, slug: "test-product-a", name: "Wheat A", type: "GRAIN" },
  });
  const productB = await base.product.create({
    data: { shopId: shopBId, slug: "test-product-b", name: "Wheat B", type: "GRAIN" },
  });
  productAId = productA.id;
  productBId = productB.id;
});

afterAll(async () => {
  await base.product.deleteMany({ where: { slug: { startsWith: "test-product-" } } });
  await base.shop.deleteMany({ where: { slug: { startsWith: "test-shop-" } } });
  await base.$disconnect();
});

describe("scope propagation", () => {
  /**
   * Regression: `runWithScope(scope, () => db.x.findMany())` — a non-async
   * callback — used to return a promise whose continuations ran outside the
   * ALS store, so Prisma's execution threw MissingScopeError. Both forms must
   * work, because both are natural to write.
   */
  it("propagates through a non-async callback returning a promise", async () => {
    const rows = await runWithScope(storeScope(shopAId), () => db.product.findMany());
    expect(rows.map((r) => r.id)).toContain(productAId);
  });

  it("propagates through an async callback", async () => {
    const rows = await runWithScope(storeScope(shopAId), async () => db.product.findMany());
    expect(rows.map((r) => r.id)).toContain(productAId);
  });
});

describe("fail-closed scoping", () => {
  it("throws when a tenant query runs with no scope", async () => {
    await expect(db.product.findMany()).rejects.toThrow(MissingScopeError);
  });

  it("throws for a create with no scope", async () => {
    await expect(
      db.product.create({
        data: { shopId: shopAId, slug: "test-product-x", name: "X", type: "GRAIN" },
      }),
    ).rejects.toThrow(MissingScopeError);
  });

  it("throws for a count with no scope", async () => {
    await expect(db.product.count()).rejects.toThrow(MissingScopeError);
  });
});

describe("shop isolation", () => {
  it("returns only the caller's shop's rows", async () => {
    const rows = await runWithScope(storeScope(shopAId), () => db.product.findMany());
    expect(rows.map((r) => r.id)).toContain(productAId);
    expect(rows.map((r) => r.id)).not.toContain(productBId);
  });

  it("cannot read another shop's row by primary key", async () => {
    const row = await runWithScope(storeScope(shopAId), () =>
      db.product.findUnique({ where: { id: productBId } }),
    );
    expect(row).toBeNull();
  });

  it("cannot update another shop's row", async () => {
    const result = await runWithScope(storeScope(shopAId), () =>
      db.product.updateMany({
        where: { id: productBId },
        data: { name: "Hijacked" },
      }),
    );
    expect(result.count).toBe(0);

    const untouched = await base.product.findUnique({ where: { id: productBId } });
    expect(untouched?.name).toBe("Wheat B");
  });

  it("cannot delete another shop's row", async () => {
    const result = await runWithScope(storeScope(shopAId), () =>
      db.product.deleteMany({ where: { id: productBId } }),
    );
    expect(result.count).toBe(0);
  });

  it("overwrites a client-supplied shopId on create", async () => {
    const created = await runWithScope(storeScope(shopAId), () =>
      db.product.create({
        // Deliberately trying to plant a row in shop B.
        data: {
          shopId: shopBId,
          slug: "test-product-planted",
          name: "Planted",
          type: "GRAIN",
        },
      }),
    );
    expect(created.shopId).toBe(shopAId);
    await base.product.delete({ where: { id: created.id } });
  });
});

describe("platform scope", () => {
  it("sees every shop's rows", async () => {
    const rows = await runWithScope(platformScope, () => db.product.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(productAId);
    expect(ids).toContain(productBId);
  });

  it("must name the shop explicitly when creating", async () => {
    await expect(
      runWithScope(platformScope, () =>
        db.product.create({
          data: { slug: "test-product-orphan", name: "Orphan", type: "GRAIN" } as never,
        }),
      ),
    ).rejects.toThrow(/must supply shopId/);
  });
});

describe("signed-out storefront scope", () => {
  it("reads this shop's catalogue", async () => {
    const rows = await runWithScope(toPublicScope({ shopIds: [shopAId] }), () =>
      db.product.findMany(),
    );
    expect(rows.map((r) => r.id)).toContain(productAId);
    expect(rows.map((r) => r.id)).not.toContain(productBId);
  });

  it("reads only the shop it was pinned to", async () => {
    const rows = await runWithScope(toPublicScope({ shopIds: [shopAId] }), () =>
      db.shop.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([shopAId]);
  });

  it("cannot read customer identity rows", async () => {
    await expect(
      runWithScope(toPublicScope({ shopIds: [shopAId] }), () => db.customer.findMany()),
    ).rejects.toThrow(/signed-out visitor/);
  });

  it("cannot read order rows", async () => {
    await expect(
      runWithScope(toPublicScope({ shopIds: [shopAId] }), () => db.order.findMany()),
    ).rejects.toThrow(/signed-out visitor/);
  });

  it("cannot write, even to a model it may read", async () => {
    await expect(
      runWithScope(toPublicScope({ shopIds: [shopAId] }), () =>
        db.product.updateMany({ where: { id: productAId }, data: { name: "x" } }),
      ),
    ).rejects.toThrow(/may not updateMany/);
  });

  it("refuses an empty shop list", () => {
    expect(() => toPublicScope({ shopIds: [] })).toThrow(/must name the shop/);
  });
});

describe("customer scope", () => {
  let customerId: string;
  let otherCustomerId: string;

  beforeAll(async () => {
    const made = await base.customer.create({ data: { phone: "+919880000011" } });
    const other = await base.customer.create({ data: { phone: "+919880000012" } });
    customerId = made.id;
    otherCustomerId = other.id;
  });

  afterAll(async () => {
    await base.customer.deleteMany({
      where: { id: { in: [customerId, otherCustomerId] } },
    });
  });

  const scope = () =>
    toCustomerScope({ customerId, sessionId: "s", shopIds: [shopAId] });

  it("sees the shop's catalogue", async () => {
    const rows = await runWithScope(scope(), () => db.product.findMany());
    expect(rows.map((r) => r.id)).toContain(productAId);
    expect(rows.map((r) => r.id)).not.toContain(productBId);
  });

  it("sees only itself in the customer table", async () => {
    const self = await runWithScope(scope(), () => db.customer.findMany());
    expect(self.map((r) => r.id)).toEqual([customerId]);

    // Including by primary key — another customer's row is simply not found.
    const other = await runWithScope(scope(), () =>
      db.customer.findUnique({ where: { id: otherCustomerId } }),
    );
    expect(other).toBeNull();
  });

  it("can read the shop's public settings but not change them", async () => {
    // Opening hours, mill throughput, and delivery/pickup flags are shown on
    // the storefront, so they are readable. Writes are not: GET scope is not
    // a licence to edit the shop's configuration.
    const settings = await runWithScope(scope(), () => db.shopSettings.findMany());
    expect(settings.every((row) => row.shopId === shopAId)).toBe(true);

    await expect(
      runWithScope(scope(), () =>
        db.shopSettings.updateMany({ where: { shopId: shopAId }, data: { bufferMinutes: 0 } }),
      ),
    ).rejects.toThrow(/Customer scope/);
  });

  it("cannot read the stock ledger", async () => {
    await expect(
      runWithScope(scope(), () => db.stockLedger.findMany()),
    ).rejects.toThrow(/Customer scope/);
  });

  it("cannot write anything on the storefront it can read", async () => {
    // The catalogue is public, so a customer can read it — but "can read" must
    // not mean "can reprice". These are the writes a compromised client would
    // attempt first.
    await expect(
      runWithScope(scope(), () =>
        db.product.updateMany({ where: { id: productAId }, data: { name: "Hacked" } }),
      ),
    ).rejects.toThrow(/Customer scope may not updateMany Product/);

    await expect(
      runWithScope(scope(), () =>
        db.productVariant.updateMany({ where: { id: productAId }, data: { pricePerKgPaise: 1 } }),
      ),
    ).rejects.toThrow(/Customer scope may not updateMany ProductVariant/);

    await expect(
      runWithScope(scope(), () =>
        db.coupon.create({
          data: {
            shopId: shopAId,
            code: "FREE100",
            type: "PERCENT",
            value: 10_000,
            fundingParty: "STORE",
          },
        }),
      ),
    ).rejects.toThrow(/Customer scope may not create Coupon/);

    await expect(
      runWithScope(scope(), () =>
        db.shop.updateMany({ where: { id: shopAId }, data: { orderingStatus: "CLOSED" } }),
      ),
    ).rejects.toThrow(/Customer scope may not updateMany Shop/);
  });

  it("can still write its own cart and order rows", async () => {
    // The read-only rule above must not spill onto the models a customer
    // legitimately owns.
    const cart = await runWithScope(scope(), () =>
      db.cart.create({ data: { customerId, shopId: shopAId, status: "ACTIVE" } }),
    );
    expect(cart.customerId).toBe(customerId);

    await runWithScope(scope(), () => db.cart.deleteMany({ where: { id: cart.id } }));
  });

  it("cannot read the shop's cash or ledger", async () => {
    await expect(
      runWithScope(scope(), () => db.cashCollection.findMany()),
    ).rejects.toThrow(/Customer scope/);
    await expect(
      runWithScope(scope(), () => db.ledgerEntry.findMany()),
    ).rejects.toThrow(/Customer scope/);
  });
});

describe("identity holes are closed for shop-side scopes", () => {
  it("a store scope cannot read customers directly", async () => {
    await expect(
      runWithScope(storeScope(shopAId), () => db.customer.findMany()),
    ).rejects.toThrow(/may not access Customer/);
  });

  it("a store scope cannot read addresses", async () => {
    await expect(
      runWithScope(storeScope(shopAId), () => db.address.findMany()),
    ).rejects.toThrow(/may not access Address/);
  });

  it("a store scope cannot read platform users", async () => {
    await expect(
      runWithScope(storeScope(shopAId), () => db.platformUser.findMany()),
    ).rejects.toThrow(/may not access PlatformUser/);
  });
});

describe("system scope", () => {
  it("refuses to run with an empty shop list", async () => {
    await expect(
      runWithScope({ kind: "SYSTEM", job: "cron", shopIds: [] }, () => db.product.findMany()),
    ).rejects.toThrow(/no shopIds/);
  });

  it("is limited to the shops it names", async () => {
    const rows = await runWithScope(
      { kind: "SYSTEM", job: "cron", shopIds: [shopAId] },
      () => db.product.findMany(),
    );
    expect(rows.map((r) => r.id)).toContain(productAId);
    expect(rows.map((r) => r.id)).not.toContain(productBId);
  });
});
