/**
 * Cart. One active cart per customer per shop, enforced by looking up rather
 * than trusting the client to send a cart id.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AppError,
  ERROR_CODES,
  priceForWeight,
  DEFAULT_LOCALE,
  INTL_TAGS,
} from "@grain-basket/contracts";
import { getDb, runWithScope } from "@grain-basket/db";
import { customerProcedure, router } from "../procedures";
import { checkCoupon, quoteCart, unitPriceFor } from "../services/pricing-service";

const grindSelection = z.object({
  grindOptionId: z.string().nullable().optional(),
  sifted: z.boolean().nullable().optional(),
});

export const cartRouter = router({
  /** The live cart, priced server-side. */
  get: customerProcedure.query(async ({ ctx }) => {
    const quote = await buildQuote(ctx.scope, ctx.shop!.id, ctx.auth as never);
    return quote;
  }),

  /**
   * Add or increment a line. `quantity` is the delta, because a shopper tapping
   * "+" twice should not need to read the current quantity first.
   */
  add: customerProcedure
    .input(
      z.object({
        variantId: z.string(),
        quantity: z.number().int().min(1).max(50).default(1),
        ...grindSelection.shape,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const shopId = ctx.shop!.id;
      const customerId = (ctx.auth as { customerId: string }).customerId;

      const variant = await db.productVariant.findFirst({
        where: { id: input.variantId, isActive: true },
        include: { product: true },
      });
      if (!variant) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "That product size isn't available");
      }

      // Grind is only offered on products that are milled to order. Accepting
      // it silently on a dry fruit would create a milling job with no grain.
      let grindOptionId: string | null = null;
      if (variant.product.isMilledToOrder) {
        const requested = input.grindOptionId ?? null;
        if (requested) {
          const option = await db.grindOption.findFirst({
            where: { id: requested, isActive: true },
            include: { shops: true },
          });
          if (!option) {
            throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Pick a valid grind");
          }
          const offered = option.shops.some((row) => row.productId === variant.productId);
          if (!offered) {
            throw new AppError(
              ERROR_CODES.VALIDATION_FAILED,
              "That grind isn't available for this product",
            );
          }
          grindOptionId = option.id;
        }
      }

      const cart = await ensureCart(customerId, shopId);

      const existing = await db.cartItem.findFirst({
        where: {
          cartId: cart.id,
          variantId: input.variantId,
          grindOptionId,
          isSifted: input.sifted ?? null,
        },
      });

      const unitPricePaise = unitPriceFor(variant);

      if (existing) {
        await db.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(existing.quantity + input.quantity, 50) },
        });
      } else {
        await db.cartItem.create({
          data: {
            cartId: cart.id,
            // Overwritten from scope by the tenant extension; supplied here
            // because the Prisma types require it at the call site.
            shopId,
            variantId: variant.id,
            quantity: input.quantity,
            grindOptionId,
            isSifted: input.sifted ?? null,
            unitPricePaise,
          },
        });
      }

      return buildQuote(ctx.scope, shopId, ctx.auth as never);
    }),

  updateQuantity: customerProcedure
    .input(z.object({ cartItemId: z.string(), quantity: z.number().int().min(0).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const shopId = ctx.shop!.id;

      if (input.quantity === 0) {
        await db.cartItem.deleteMany({ where: { id: input.cartItemId } });
      } else {
        const updated = await db.cartItem.updateMany({
          where: { id: input.cartItemId },
          data: { quantity: input.quantity },
        });
        if (updated.count === 0) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "That item is no longer in your cart");
        }
      }
      return buildQuote(ctx.scope, shopId, ctx.auth as never);
    }),

  remove: customerProcedure
    .input(z.object({ cartItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.cartItem.deleteMany({ where: { id: input.cartItemId } });
      return buildQuote(ctx.scope, ctx.shop!.id, ctx.auth as never);
    }),

  /** Validate a coupon and say exactly why it won't apply, in the UI's terms. */
  applyCoupon: customerProcedure
    .input(z.object({ code: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const customerId = (ctx.auth as { customerId: string }).customerId;
      const shopId = ctx.shop!.id;

      const cart = await ensureCart(customerId, shopId);
      const current = await buildQuote(ctx.scope, shopId, ctx.auth as never);

      const result = await checkCoupon({
        code: input.code,
        cartSubtotalAfterPromotionsPaise:
          current.priced.subtotalPaise - current.priced.promotionDiscountPaise,
        customerId,
        customerOrderCount: await db.order.count(),
      });

      if (!result.verdict.ok) {
        return { ok: false as const, reason: result.verdict.reason, coupon: null };
      }

      await db.cart.update({
        where: { id: cart.id },
        data: { couponCode: result.code },
      });

      const priced = await buildQuote(ctx.scope, shopId, ctx.auth as never);
      return { ok: true as const, reason: null, coupon: priced.coupon };
    }),

  removeCoupon: customerProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const customerId = (ctx.auth as { customerId: string }).customerId;
    const cart = await ensureCart(customerId, ctx.shop!.id);
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return buildQuote(ctx.scope, ctx.shop!.id, ctx.auth as never);
  }),
});

/**
 * Load the cart and price it. Runs inside the caller's scope so every read is
 * shop-filtered and the customer's own rows only.
 */
export async function buildQuote(
  scope: Parameters<typeof runWithScope>[0],
  shopId: string,
  auth: { customerId: string },
) {
  return runWithScope(scope, async () => {
    const db = getDb();

    const cart = await db.cart.findFirst({
      where: { customerId: auth.customerId, status: "ACTIVE" },
      include: {
        items: {
          include: {
            variant: { include: { product: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const shop = await db.shop.findFirst({
      where: { id: shopId },
      include: { settings: true },
    });
    if (!shop) throw new AppError(ERROR_CODES.NOT_FOUND, "Shop not found");

    const areas = await db.serviceableArea.findMany({
      where: { pincode: shop.pincode, isActive: true },
    });

    if (!cart || cart.items.length === 0) {
      return emptyCart(shop.slug);
    }

    const grindOptions = await db.grindOption.findMany({ where: { isActive: true } });
    const grindById = new Map(grindOptions.map((g) => [g.id, g]));

    const lines = cart.items
      .filter((item) => item.variant !== null)
      .map((item) => {
        const option = item.grindOptionId ? grindById.get(item.grindOptionId) : undefined;
        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          grindOptionId: item.grindOptionId,
          isSifted: item.isSifted,
          unitPricePaise: item.unitPricePaise,
          variant: item.variant,
          grindOption: option ?? null,
        };
      });

    if (lines.length === 0) return emptyCart(shop.slug);

    const coupon = cart.couponCode
      ? await db.coupon.findFirst({
          where: { code: cart.couponCode, isActive: true },
        })
      : null;

    // Delivery fee: pickup is always free; delivery uses the shop's own
    // pincode rate as the default until checkout supplies a real address.
    const area = areas[0];
    const deliveryFeePaise = shop.settings?.pickupEnabled === false
      ? (area?.deliveryFeePaise ?? 0)
      : (area?.deliveryFeePaise ?? 0);

    const quote = await quoteCart({
      lines,
      deliveryFeePaise,
      minOrderPaise: area?.minOrderPaise ?? 0,
      fulfilment: "DELIVERY",
      couponId: coupon?.id ?? null,
      taxInclusive: shop.taxInclusive,
    });

    return {
      shopSlug: shop.slug,
      acceptingOrders: shop.orderingStatus === "OPEN",
      items: lines.map((line) => {
        const pricedLine = quote.lines.find((l) => l.cartItemId === line.id);
        const variant = line.variant!;
        const option = line.grindOption;
        const modifier = option?.priceDeltaPerKgPaise ?? 0;
        const effectivePerKg = Math.max(0, variant.pricePerKgPaise + modifier);
        const unit = priceForWeight(effectivePerKg, variant.packWeightGrams);

        return {
          cartItemId: line.id,
          variantId: variant.id,
          productSlug: variant.product.slug,
          productName: variant.product.name,
          variantLabel: variant.label,
          packWeightGrams: variant.packWeightGrams,
          quantity: line.quantity,
          unitPricePaise: unit,
          lineTotalPaise: unit * line.quantity,
          grindCode: option?.code ?? null,
          isSifted: line.isSifted,
          isMilledToOrder: variant.product.isMilledToOrder,
          availableGrams: Math.max(0, variant.stockOnHandGrams - variant.reservedGrams),
          inStock:
            variant.stockOnHandGrams - variant.reservedGrams >=
            variant.packWeightGrams * line.quantity,
          gstBps: variant.product.gstBps,
          taxPaise: pricedLine?.taxPaise ?? 0,
        };
      }),
      priced: quote.priced,
      taxByRate: quote.taxByRate,
      coupon: coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            title: coupon.title,
            type: coupon.type,
            fundingParty: coupon.fundingParty,
          }
        : null,
      minOrderPaise: area?.minOrderPaise ?? 0,
      freeAbovePaise: area?.freeAbovePaise ?? null,
      deliveryFeePaise,
      currency: "INR" as const,
      moneyFormat: INTL_TAGS[DEFAULT_LOCALE],
    };
  });
}

function emptyCart(shopSlug: string) {
  return {
    shopSlug,
    acceptingOrders: true,
    items: [],
    priced: {
      lines: [],
      subtotalPaise: 0,
      promotionDiscountPaise: 0,
      couponDiscountPaise: 0,
      deliveryDiscountPaise: 0,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      couponFundingParty: null,
      appliedCouponId: null,
      belowMinimum: false,
    },
    taxByRate: [],
    coupon: null,
    minOrderPaise: 0,
    freeAbovePaise: null,
    deliveryFeePaise: 0,
    currency: "INR" as const,
    moneyFormat: INTL_TAGS[DEFAULT_LOCALE],
  };
}

/** Find or create the single active cart for this customer + shop. */
async function ensureCart(customerId: string, shopId: string) {
  const db = getDb();
  const existing = await db.cart.findFirst({
    where: { customerId, status: "ACTIVE" },
  });
  if (existing) {
    if (existing.shopId !== shopId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Your cart has items from another shop",
        cause: new AppError(
          ERROR_CODES.CART_SHOP_MISMATCH,
          "Your cart has items from another shop. Clear it to order here.",
        ),
      });
    }
    return existing;
  }
  return db.cart.create({
    data: { customerId, shopId, status: "ACTIVE" },
  });
}
