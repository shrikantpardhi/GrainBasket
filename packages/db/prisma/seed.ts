/**
 * Development seed. Creates one working mill: a shop with a catalogue across
 * all three product pillars, grind options, stock, opening hours, and one
 * account in each of the three universes so the separation is visible in dev.
 *
 * Idempotent: safe to re-run. Uses the base (unscoped) client deliberately —
 * seeding is SYSTEM work across shops and is confined to this file.
 */

import "dotenv/config";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const scrypt = promisify(scryptCb) as (
  p: string | Buffer,
  s: string | Buffer,
  k: number,
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL! }),
});

/** 7 days, 8:00–20:00 IST. Minutes from midnight. */
const OPENING_HOURS = JSON.stringify(
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensMinute: 8 * 60,
    closesMinute: 20 * 60,
    closed: false,
  })),
);

interface SeedVariant {
  label: string;
  packWeightGrams: number;
  pricePerKgPaise: number;
  stockOnHandGrams: number;
  sku: string;
}

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  type: string;
  category: string;
  isMilledToOrder: boolean;
  expectedYieldBps?: number;
  /** Indian GST: flours/grains 5%, dry fruits 12%. */
  gstBps: number;
  variants: SeedVariant[];
}

const CATEGORIES = [
  { slug: "flours", name: "Fresh Milled Flours" },
  { slug: "grains", name: "Whole Grains & Pulses" },
  { slug: "dry-fruits", name: "Dry Fruits & Nuts" },
];

const PRODUCTS: SeedProduct[] = [
  {
    slug: "chakki-atta",
    name: "Chakki Fresh Atta",
    description:
      "Stone-ground whole wheat, milled after you order. Choose your grind — fine for rotis, coarse for dalia.",
    type: "FLOUR",
    category: "flours",
    gstBps: 500,
    isMilledToOrder: true,
    expectedYieldBps: 9800,
    variants: [
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 5500, stockOnHandGrams: 120_000, sku: "ATTA-1" },
      { label: "5 kg", packWeightGrams: 5000, pricePerKgPaise: 5200, stockOnHandGrams: 200_000, sku: "ATTA-5" },
      { label: "10 kg", packWeightGrams: 10_000, pricePerKgPaise: 4900, stockOnHandGrams: 250_000, sku: "ATTA-10" },
    ],
  },
  {
    slug: "besan",
    name: "Fresh Besan (Gram Flour)",
    description: "Milled from whole chana on order — noticeably sweeter than packet besan.",
    type: "FLOUR",
    category: "flours",
    gstBps: 500,
    isMilledToOrder: true,
    expectedYieldBps: 9700,
    variants: [
      { label: "500 g", packWeightGrams: 500, pricePerKgPaise: 12_000, stockOnHandGrams: 40_000, sku: "BESAN-500" },
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 11_500, stockOnHandGrams: 60_000, sku: "BESAN-1" },
    ],
  },
  {
    slug: "bajra-flour",
    name: "Bajra Flour",
    description: "Pearl millet, ground fresh. Best within a week — that is the point.",
    type: "FLOUR",
    category: "flours",
    gstBps: 500,
    isMilledToOrder: true,
    variants: [
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 6000, stockOnHandGrams: 50_000, sku: "BAJRA-1" },
    ],
  },
  {
    slug: "sharbati-wheat",
    name: "Sharbati Wheat (Whole)",
    description: "MP Sharbati, hand-cleaned. Buy whole and have it milled, or take it home.",
    type: "GRAIN",
    category: "grains",
    gstBps: 500,
    isMilledToOrder: false,
    variants: [
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 4800, stockOnHandGrams: 300_000, sku: "WHEAT-1" },
      { label: "5 kg", packWeightGrams: 5000, pricePerKgPaise: 4500, stockOnHandGrams: 500_000, sku: "WHEAT-5" },
      { label: "10 kg", packWeightGrams: 10_000, pricePerKgPaise: 4300, stockOnHandGrams: 600_000, sku: "WHEAT-10" },
    ],
  },
  {
    slug: "rajma",
    name: "Rajma (Kidney Beans)",
    description: "Jammu rajma, uniform size, quick to cook.",
    type: "PULSE",
    category: "grains",
    gstBps: 500,
    isMilledToOrder: false,
    variants: [
      { label: "500 g", packWeightGrams: 500, pricePerKgPaise: 16_000, stockOnHandGrams: 40_000, sku: "RAJMA-500" },
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 15_000, stockOnHandGrams: 80_000, sku: "RAJMA-1" },
    ],
  },
  {
    slug: "basmati-rice",
    name: "Basmati Rice",
    description: "Aged 18 months. Long grain, low starch.",
    type: "GRAIN",
    category: "grains",
    gstBps: 500,
    isMilledToOrder: false,
    variants: [
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 14_000, stockOnHandGrams: 100_000, sku: "RICE-1" },
      { label: "5 kg", packWeightGrams: 5000, pricePerKgPaise: 13_000, stockOnHandGrams: 150_000, sku: "RICE-5" },
    ],
  },
  {
    slug: "moong-dal",
    name: "Moong Dal (Split)",
    description: "Yellow moong, split and cleaned.",
    type: "PULSE",
    category: "grains",
    gstBps: 500,
    isMilledToOrder: false,
    variants: [
      { label: "500 g", packWeightGrams: 500, pricePerKgPaise: 13_000, stockOnHandGrams: 30_000, sku: "MOONG-500" },
      { label: "1 kg", packWeightGrams: 1000, pricePerKgPaise: 12_500, stockOnHandGrams: 60_000, sku: "MOONG-1" },
    ],
  },
  {
    slug: "almonds",
    name: "Almonds",
    description: "California almonds. Premium grade is larger and sweeter.",
    type: "DRY_FRUIT",
    category: "dry-fruits",
    gstBps: 1200,
    isMilledToOrder: false,
    variants: [
      { label: "250 g", packWeightGrams: 250, pricePerKgPaise: 90_000, stockOnHandGrams: 20_000, sku: "ALMOND-250" },
      { label: "500 g", packWeightGrams: 500, pricePerKgPaise: 88_000, stockOnHandGrams: 30_000, sku: "ALMOND-500" },
    ],
  },
  {
    slug: "cashews",
    name: "Cashews (W240)",
    description: "Whole white cashews, W240 grade.",
    type: "DRY_FRUIT",
    category: "dry-fruits",
    gstBps: 1200,
    isMilledToOrder: false,
    variants: [
      { label: "250 g", packWeightGrams: 250, pricePerKgPaise: 110_000, stockOnHandGrams: 15_000, sku: "CASHEW-250" },
      { label: "500 g", packWeightGrams: 500, pricePerKgPaise: 108_000, stockOnHandGrams: 25_000, sku: "CASHEW-500" },
    ],
  },
];

const GRIND_OPTIONS = [
  { code: "fine-unsifted", fineness: "FINE", sifted: false, priceDeltaPerKgPaise: 0, isDefault: true },
  { code: "fine-sifted", fineness: "FINE", sifted: true, priceDeltaPerKgPaise: 200, isDefault: false },
  { code: "medium-unsifted", fineness: "MEDIUM", sifted: false, priceDeltaPerKgPaise: 0, isDefault: false },
  { code: "medium-sifted", fineness: "MEDIUM", sifted: true, priceDeltaPerKgPaise: 200, isDefault: false },
  { code: "coarse-unsifted", fineness: "COARSE", sifted: false, priceDeltaPerKgPaise: 0, isDefault: false },
  { code: "whole", fineness: "WHOLE", sifted: false, priceDeltaPerKgPaise: 0, isDefault: false },
];

async function main() {
  console.log("Seeding Grain Basket…");

  const legalEntity = await client.legalEntity.upsert({
    where: { id: "seed-legal-entity" },
    update: {},
    create: {
      id: "seed-legal-entity",
      legalName: "Grain Basket Mills Pvt Ltd",
      tradeName: "Grain Basket",
      // GST is optional. Fill these in to exercise invoicing.
      gstin: null,
      stateCode: "27",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      invoicePrefix: "GB",
    },
  });

  const shop = await client.shop.upsert({
    where: { slug: "kothrud" },
    update: {},
    create: {
      slug: "kothrud",
      name: "Grain Basket — Kothrud",
      searchText: "grain basket kothrud pune 411038 maharashtra",
      description: "Stone-ground flours and whole grains, milled fresh in Kothrud.",
      line1: "Shop 4, Paud Road",
      area: "Kothrud",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411038",
      lat: 18.5074,
      lng: 73.8077,
      phone: "+912012345678",
      legalEntityId: legalEntity.id,
    },
  });

  await client.shopSettings.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      millThroughputGramsPerHour: 60_000,
      bufferMinutes: 10,
      lastOrderLeadMinutes: 30,
      openingHours: JSON.parse(OPENING_HOURS),
      inPresenceCapacityPerSlot: 1,
    },
  });

  await client.shopTranslation.upsert({
    where: { shopId_locale: { shopId: shop.id, locale: "hi" } },
    update: {},
    create: {
      shopId: shop.id,
      locale: "hi",
      name: "ग्रेन बास्केट — कोथरूड",
      tagline: "ताज़ा पिसा आटा, रोज़",
      description: "कोथरूड में पत्थर पर पिसा ताज़ा आटा और साबुत अनाज।",
    },
  });

  for (const area of [
    { pincode: "411038", deliveryFeePaise: 3000, minOrderPaise: 20_000, freeAbovePaise: 100_000 },
    { pincode: "411004", deliveryFeePaise: 4000, minOrderPaise: 25_000, freeAbovePaise: 120_000 },
    { pincode: "411030", deliveryFeePaise: 5000, minOrderPaise: 30_000, freeAbovePaise: 150_000 },
  ]) {
    await client.serviceableArea.upsert({
      where: { shopId_pincode: { shopId: shop.id, pincode: area.pincode } },
      update: {},
      create: { shopId: shop.id, ...area },
    });
  }

  const categoryIds = new Map<string, string>();
  for (const [index, cat] of CATEGORIES.entries()) {
    const row = await client.category.upsert({
      where: { shopId_slug: { shopId: shop.id, slug: cat.slug } },
      update: {},
      create: { shopId: shop.id, slug: cat.slug, name: cat.name, sortOrder: index },
    });
    categoryIds.set(cat.slug, row.id);
  }

  const grindIds: string[] = [];
  for (const grind of GRIND_OPTIONS) {
    const row = await client.grindOption.upsert({
      where: { shopId_code: { shopId: shop.id, code: grind.code } },
      update: {},
      create: { shopId: shop.id, ...grind },
    });
    grindIds.push(row.id);
  }

  for (const [index, product] of PRODUCTS.entries()) {
    const created = await client.product.upsert({
      where: { shopId_slug: { shopId: shop.id, slug: product.slug } },
      update: {},
      create: {
        shopId: shop.id,
        categoryId: categoryIds.get(product.category) ?? null,
        slug: product.slug,
        name: product.name,
        description: product.description,
        type: product.type,
        isMilledToOrder: product.isMilledToOrder,
        expectedYieldBps: product.expectedYieldBps ?? 10_000,
        gstBps: product.gstBps,
        sortOrder: index,
        searchText: `${product.name} ${product.description} ${product.type}`.toLowerCase(),
      },
    });

    for (const [vIndex, variant] of product.variants.entries()) {
      const pricePaise = Math.round((variant.pricePerKgPaise * variant.packWeightGrams) / 1000);
      await client.productVariant.upsert({
        where: { shopId_sku: { shopId: shop.id, sku: variant.sku } },
        update: {},
        create: {
          shopId: shop.id,
          productId: created.id,
          sku: variant.sku,
          label: variant.label,
          packWeightGrams: variant.packWeightGrams,
          pricePerKgPaise: variant.pricePerKgPaise,
          pricePaise,
          stockOnHandGrams: variant.stockOnHandGrams,
          sortOrder: vIndex,
        },
      });
    }

    // Milled products get the grind selector attached.
    if (product.isMilledToOrder) {
      for (const grindOptionId of grindIds) {
        await client.productGrindOption.upsert({
          where: { productId_grindOptionId: { productId: created.id, grindOptionId } },
          update: {},
          create: { shopId: shop.id, productId: created.id, grindOptionId },
        });
      }
    }
  }

  // --- Accounts, one per universe -----------------------------------------
  const passwordHash = await hashPassword("grainbasket-dev-password");

  const platformAdmin = await client.platformUser.upsert({
    where: { email: "admin@grainbasket.local" },
    update: {},
    create: {
      email: "admin@grainbasket.local",
      name: "Platform Admin",
      passwordHash,
      role: "PLATFORM_ADMIN",
    },
  });

  await client.platformUser.upsert({
    where: { email: "support@grainbasket.local" },
    update: {},
    create: {
      email: "support@grainbasket.local",
      name: "Platform Support",
      passwordHash,
      role: "PLATFORM_SUPPORT",
    },
  });

  const storeAdmin = await client.storeUser.upsert({
    where: { email: "store@grainbasket.local" },
    update: {},
    create: {
      email: "store@grainbasket.local",
      name: "Kothrud Store Admin",
      passwordHash,
    },
  });

  await client.storeMembership.upsert({
    where: { storeUserId_shopId: { storeUserId: storeAdmin.id, shopId: shop.id } },
    update: {},
    create: { storeUserId: storeAdmin.id, shopId: shop.id, role: "STORE_ADMIN" },
  });

  await client.customer.upsert({
    where: { phone: "+919876543210" },
    update: {},
    create: { phone: "+919876543210", name: "Test Customer", defaultGrind: "FINE" },
  });

  console.log(`
Seeded.

  Shop           ${shop.name}   (slug: ${shop.slug})
  Products       ${PRODUCTS.length} across ${CATEGORIES.length} categories
  Platform admin admin@grainbasket.local    role PLATFORM_ADMIN
  Platform suppt support@grainbasket.local  role PLATFORM_SUPPORT
  Store admin    store@grainbasket.local    (STORE_ADMIN at ${shop.slug})
  Customer       +919876543210              (OTP printed to the dev console)

  Password for all three staff accounts: grainbasket-dev-password
  Platform id: ${platformAdmin.id}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect();
  });
