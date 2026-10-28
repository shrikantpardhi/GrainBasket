/**
 * Tenancy isolation tests. These run against a real Postgres (the docker
 * compose service) because the thing being tested is what SQL actually
 * executes — mocking Prisma would test the mock, not the isolation.
 *
 * Run with `pnpm db:up` first, then `pnpm --filter @grain-basket/db test`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBaseClient, getDb } from "./client";
import { runWithScope, MissingScopeError, type StoreScope, type PlatformScope } from "./scope";

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
