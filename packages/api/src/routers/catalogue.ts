/**
 * Storefront catalogue. Read-only, shop-scoped.
 *
 * Every query here runs inside the context's scope, so the tenant extension
 * filters to the shop in the URL. A product from another shop cannot appear
 * because it cannot be selected — not because a resolver remembered to filter.
 */

import { z } from "zod";
import {
  AppError,
  ERROR_CODES,
  formatPaise,
  priceForWeight,
  INTL_TAGS,
  resolveLocale,
  type Locale,
} from "@grain-basket/contracts";
import { getDb } from "@grain-basket/db";
import { storefrontProcedure, router } from "../procedures";

const localeInput = z.string().optional();

function pickLocale(raw: string | undefined): Locale {
  return resolveLocale(raw);
}

/** Money in the customer's locale, always with Indian grouping. */
function money(paise: number, locale: Locale): string {
  return formatPaise(paise, INTL_TAGS[locale]);
}

export const catalogueRouter = router({
  /** Categories with a live product count, for the shop landing page. */
  categories: storefrontProcedure
    .input(z.object({ locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const locale = pickLocale(input.locale);

      const categories = await db.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          translations: { where: { locale } },
          _count: { select: { products: { where: { isActive: true } } } },
        },
      });

      return categories.map((category) => {
        const translation = category.translations[0];
        return {
          id: category.id,
          slug: category.slug,
          name: translation?.name ?? category.name,
          description: translation?.description ?? category.description,
          productCount: category._count.products,
          /** True when this locale has no translation and copy fell back. */
          isFallback: !translation,
        };
      });
    }),

  /**
   * Product list with filters. `grindable` answers "can I have this milled?",
   * which is the question a chakki mill customer actually asks.
   */
  products: storefrontProcedure
    .input(
      z.object({
        locale: localeInput,
        categorySlug: z.string().optional(),
        type: z.enum(["FLOUR", "GRAIN", "PULSE", "DRY_FRUIT", "OTHER"]).optional(),
        grindableOnly: z.boolean().optional(),
        search: z.string().trim().max(80).optional(),
        limit: z.number().int().min(1).max(60).default(24),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const locale = pickLocale(input.locale);

      const products = await db.product.findMany({
        where: {
          isActive: true,
          ...(input.type ? { type: input.type } : {}),
          ...(input.grindableOnly ? { isMilledToOrder: true } : {}),
          ...(input.categorySlug ? { category: { slug: input.categorySlug } } : {}),
          ...(input.search
            ? { searchText: { contains: input.search.toLowerCase() } }
            : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          translations: { where: { locale } },
          category: { select: { slug: true, name: true } },
          variants: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      const page = products.slice(0, input.limit);
      const nextCursor = products.length > input.limit ? (page[page.length - 1]?.id ?? null) : null;

      return {
        nextCursor,
        items: page.map((product) => {
          const translation = product.translations[0];
          const variants = product.variants.map((variant) => ({
            id: variant.id,
            label: variant.label,
            packWeightGrams: variant.packWeightGrams,
            pricePerKgPaise: variant.pricePerKgPaise,
            pricePaise: priceForWeight(variant.pricePerKgPaise, variant.packWeightGrams),
            priceLabel: money(
              priceForWeight(variant.pricePerKgPaise, variant.packWeightGrams),
              locale,
            ),
            inStock: variant.stockOnHandGrams - variant.reservedGrams >= variant.packWeightGrams,
            /** Weight available to sell right now, in grams. */
            availableGrams: Math.max(0, variant.stockOnHandGrams - variant.reservedGrams),
          }));

          const cheapest = variants.reduce<typeof variants[number] | null>(
            (best, v) => (best === null || v.pricePerKgPaise < best.pricePerKgPaise ? v : best),
            null,
          );

          return {
            id: product.id,
            slug: product.slug,
            name: translation?.name ?? product.name,
            description: translation?.description ?? product.description,
            type: product.type,
            isMilledToOrder: product.isMilledToOrder,
            isFallback: !translation,
            category: product.category,
            imageKeys: product.imageKeys,
            variantCount: variants.length,
            fromPricePaise: cheapest?.pricePaise ?? null,
            fromPricePerKgPaise: cheapest?.pricePerKgPaise ?? null,
            fromPriceLabel: cheapest?.priceLabel ?? null,
            inStock: variants.some((v) => v.inStock),
          };
        }),
      };
    }),

  /** Full product detail: variants, grind options, stock, ratings-free. */
  product: storefrontProcedure
    .input(z.object({ slug: z.string(), locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const locale = pickLocale(input.locale);

      const product = await db.product.findFirst({
        where: { slug: input.slug, isActive: true },
        include: {
          translations: { where: { locale } },
          category: { select: { slug: true, name: true } },
          variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
          grindOptions: {
            include: { grindOption: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      if (!product) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Product not found");
      }

      const translation = product.translations[0];

      return {
        id: product.id,
        slug: product.slug,
        name: translation?.name ?? product.name,
        description: translation?.description ?? product.description,
        isFallback: !translation,
        type: product.type,
        isMilledToOrder: product.isMilledToOrder,
        expectedYieldBps: product.expectedYieldBps,
        gstBps: product.gstBps,
        imageKeys: product.imageKeys,
        category: product.category,
        variants: product.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          label: v.label,
          packWeightGrams: v.packWeightGrams,
          pricePerKgPaise: v.pricePerKgPaise,
          pricePaise: priceForWeight(v.pricePerKgPaise, v.packWeightGrams),
          inStock: v.stockOnHandGrams - v.reservedGrams >= v.packWeightGrams,
          availableGrams: Math.max(0, v.stockOnHandGrams - v.reservedGrams),
          isLowStock:
            v.stockOnHandGrams - v.reservedGrams <= v.lowStockGrams &&
            v.stockOnHandGrams - v.reservedGrams > 0,
        })),
        grindOptions: product.grindOptions.map((row) => ({
          id: row.grindOption.id,
          code: row.grindOption.code,
          fineness: row.grindOption.fineness,
          sifted: row.grindOption.sifted,
          priceDeltaPerKgPaise: row.grindOption.priceDeltaPerKgPaise,
          isDefault: row.grindOption.isDefault,
        })),
        /** The customer's saved preference, if they are signed in. */
        defaultGrind: null as string | null,
      };
    }),

  /** Live banners for a placement, filtered by schedule and status. */
  banners: storefrontProcedure
    .input(z.object({ placement: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const now = new Date();

      const banners = await db.banner.findMany({
        where: {
          placement: input.placement,
          status: "LIVE",
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      });

      return banners.map((banner) => ({
        id: banner.id,
        imageKey: banner.imageKey,
        headline: banner.headline,
        subhead: banner.subhead,
        deepLink: banner.deepLink,
      }));
    }),

  /** Serviceable pincodes, so checkout can validate before the cart exists. */
  serviceableAreas: storefrontProcedure.query(async () => {
    const db = getDb();
    const areas = await db.serviceableArea.findMany({
      where: { isActive: true },
      orderBy: { pincode: "asc" },
    });
    return areas.map((area) => ({
      pincode: area.pincode,
      deliveryFeePaise: area.deliveryFeePaise,
      minOrderPaise: area.minOrderPaise,
      freeAbovePaise: area.freeAbovePaise,
    }));
  }),

  /** Storefront chrome: name, hours, and whether ordering is open. */
  shopInfo: storefrontProcedure
    .input(z.object({ locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const locale = pickLocale(input.locale);

      const shop = await db.shop.findFirst({
        where: { id: ctx.shop.id },
        include: {
          translations: { where: { locale } },
          settings: true,
          legalEntity: { select: { legalName: true, gstin: true } },
        },
      });

      if (!shop || !ctx.shop) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Shop not found");
      }

      const translation = shop.translations[0];

      return {
        id: shop.id,
        slug: shop.slug,
        name: translation?.name ?? shop.name,
        tagline: translation?.tagline ?? null,
        description: translation?.description ?? shop.description,
        address: {
          line1: shop.line1,
          line2: shop.line2,
          area: shop.area,
          city: shop.city,
          state: shop.state,
          pincode: shop.pincode,
        },
        phone: shop.phone,
        lat: shop.lat,
        lng: shop.lng,
        /** Only `OPEN` accepts new orders; PAUSED still drains its queue. */
        acceptingOrders: ctx.shop.orderingStatus === "OPEN",
        deliveryEnabled: shop.settings?.deliveryEnabled ?? true,
        pickupEnabled: shop.settings?.pickupEnabled ?? true,
        openingHours: shop.settings?.openingHours ?? [],
        gstRegistered: Boolean(shop.legalEntity?.gstin),
      };
    }),
});
