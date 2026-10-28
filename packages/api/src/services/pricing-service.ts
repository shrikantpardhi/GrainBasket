/**
 * Turns a cart's live rows into `priceOrder` input, and applies the quote.
 *
 * This is the server half of the pricing contract: the client never sends a
 * total, it sends a cart, and the total comes back recomputed from catalogue
 * rows read inside the caller's scope. A client that tampered with a price in
 * devtools gets the real one back.
 *
 * GST is per product because a single order mixes 5% flour with 12% dry
 * fruits. `priceOrder` takes one rate, so this groups lines by their product's
 * rate, prices each group, and sums. Splitting by rate is also what the
 * invoice needs, so the group boundaries are returned rather than discarded.
 */

import {
  AppError,
  ERROR_CODES,
  priceForWeight,
  type Paise,
} from "@grain-basket/contracts";
import { priceOrder, evaluateCoupon, type PricedOrder } from "@grain-basket/core";
import { getDb } from "@grain-basket/db";

export interface CartLineRow {
  id: string;
  variantId: string | null;
  quantity: number;
  grindOptionId: string | null;
  isSifted: boolean | null;
  unitPricePaise: number;
  variant: {
    id: string;
    packWeightGrams: number;
    pricePerKgPaise: number;
    productId: string;
    product: {
      id: string;
      name: string;
      categoryId: string | null;
      gstBps: number;
      isMilledToOrder: boolean;
    };
  } | null;
  /** Populated by the caller from the shop's grind options. */
  grindOption?: {
    id: string;
    priceDeltaPerKgPaise: number;
  } | null;
}

export interface QuoteInput {
  lines: readonly CartLineRow[];
  deliveryFeePaise: Paise;
  minOrderPaise: Paise;
  fulfilment: "DELIVERY" | "PICKUP";
  couponId?: string | null;
  taxInclusive?: boolean;
}

export interface Quote {
  /** The authoritative totals, priced per GST rate group. */
  priced: PricedOrder;
  /** Tax split per rate — what the invoice prints. */
  taxByRate: { gstBps: number; taxablePaise: Paise; taxPaise: Paise }[];
  /** Per-line figures the checkout UI displays. */
  lines: {
    cartItemId: string;
    gstBps: number;
    linePaise: Paise;
    taxPaise: Paise;
  }[];
}

/**
 * Price a cart. Pure with respect to the DB except for reading the active
 * coupon & promotions, which happen in the caller's scope.
 */
export async function quoteCart(input: QuoteInput): Promise<Quote> {
  if (input.lines.length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Cart is empty");
  }

  const db = getDb();

  const [coupon, promotions] = await Promise.all([
    input.couponId ? loadCoupon(input.couponId) : Promise.resolve(null),
    db.promotion.findMany({
      where: { isActive: true },
      // Date filtering happens below so a missing bound means "no bound".
    }),
  ]);

  const now = new Date();
  const livePromotions = promotions.filter(
    (p) => p.startsAt <= now && p.endsAt >= now,
  );

  // Group lines by GST rate. Grouping first means the tax split is exact
  // rather than a blended average that would under-collect on the 12% items.
  const byRate = new Map<number, CartLineRow[]>();
  for (const line of input.lines) {
    if (!line.variant) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "A cart item points at a variant that no longer exists",
      );
    }
    const rate = line.variant.product.gstBps;
    const bucket = byRate.get(rate) ?? [];
    bucket.push(line);
    byRate.set(rate, bucket);
  }

  let subtotal = 0;
  let promotionDiscount = 0;
  let couponDiscount = 0;
  let deliveryDiscount = 0;
  let deliveryFee = 0;
  let tax = 0;
  let total = 0;
  const taxByRate: Quote["taxByRate"] = [];
  const pricedLines: Quote["lines"] = [];
  const allPricedLines: PricedOrder["lines"] = [];
  let couponFundingParty: Quote["priced"]["couponFundingParty"] = null;
  let appliedCouponId: string | null = null;
  let belowMinimum = false;

  const taxInclusive = input.taxInclusive ?? true;

  // The coupon applies to the whole cart, so it is passed to exactly one group
  // (the first) after all groups have been priced. Otherwise a 10% coupon
  // would be applied once per GST rate and stack.
  const rateGroups = [...byRate.entries()];

  for (const [index, [gstBps, lines]] of rateGroups.entries()) {
    const groupPriced = priceOrder({
      lines: lines.map((line) => ({
        key: line.id,
        productId: line.variant!.product.id,
        categoryId: line.variant!.product.categoryId,
        pricePerKgPaise: line.variant!.pricePerKgPaise,
        packWeightGrams: line.variant!.packWeightGrams,
        quantity: line.quantity,
        grindModifier: line.grindOption
          ? {
              finenessDeltaPerKgPaise: line.grindOption.priceDeltaPerKgPaise,
              siftedDeltaPerKgPaise: 0,
            }
          : null,
        isSifted: line.isSifted ?? false,
      })),
      promotions: livePromotions.map((p) => ({
        id: p.id,
        productId: p.productId,
        categoryId: p.categoryId,
        type: p.type as "PERCENT" | "FLAT",
        value: p.value,
        maxDiscountPaise: p.maxDiscountPaise,
      })),
      // Only the first group carries the coupon; see above.
      coupon: index === 0 && coupon ? coupon : null,
      fulfilment: input.fulfilment,
      // Delivery is charged once, on the first group.
      deliveryFeePaise: index === 0 ? input.deliveryFeePaise : 0,
      tax: { gstBps, taxInclusive },
      minOrderPaise: null,
    });

    subtotal += groupPriced.subtotalPaise;
    promotionDiscount += groupPriced.promotionDiscountPaise;
    couponDiscount += groupPriced.couponDiscountPaise;
    deliveryDiscount += groupPriced.deliveryDiscountPaise;
    deliveryFee += groupPriced.deliveryFeePaise;
    tax += groupPriced.taxPaise;
    total += groupPriced.totalPaise;
    if (groupPriced.appliedCouponId) appliedCouponId = groupPriced.appliedCouponId;
    if (groupPriced.couponFundingParty) couponFundingParty = groupPriced.couponFundingParty;

    taxByRate.push({
      gstBps,
      taxablePaise: groupPriced.lines.reduce((sum, l) => sum + l.basePaise, 0),
      taxPaise: groupPriced.taxPaise,
    });

    allPricedLines.push(...groupPriced.lines);
    for (const line of groupPriced.lines) {
      pricedLines.push({
        cartItemId: line.key,
        gstBps,
        linePaise: line.netPaise,
        taxPaise: line.taxPaise,
      });
    }
  }

  belowMinimum = input.minOrderPaise > 0 && total < input.minOrderPaise;

  const priced: PricedOrder = {
    lines: allPricedLines,
    subtotalPaise: subtotal,
    promotionDiscountPaise: promotionDiscount,
    couponDiscountPaise: couponDiscount,
    deliveryDiscountPaise: deliveryDiscount,
    deliveryFeePaise: deliveryFee,
    taxPaise: tax,
    totalPaise: total,
    couponFundingParty,
    appliedCouponId,
    belowMinimum,
  };

  return { priced, taxByRate, lines: pricedLines };
}

/**
 * Look up an applicable coupon by id inside the current scope. Returns the
 * shape `priceOrder` wants, or null when it does not apply — the caller gets a
 * total without the discount rather than an error, and `checkCoupon` explains
 * why separately.
 */
async function loadCoupon(couponId: string) {
  const db = getDb();
  // The tenant extension allows `shopId IS NULL` through for global coupons.
  const coupon = await db.coupon.findFirst({
    where: { id: couponId, isActive: true },
  });
  if (!coupon) return null;

  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type as "PERCENT" | "FLAT" | "FREE_DELIVERY",
    value: coupon.value,
    maxDiscountPaise: coupon.maxDiscountPaise,
    minOrderPaise: coupon.minOrderPaise,
    fundingParty: coupon.fundingParty as "STORE" | "PLATFORM",
  };
}

/** Explain, in the UI's terms, why a coupon will or won't apply. */
export async function checkCoupon(input: {
  code: string;
  cartSubtotalAfterPromotionsPaise: Paise;
  customerId: string;
  customerOrderCount: number;
}) {
  const db = getDb();
  const coupon = await db.coupon.findFirst({
    where: { code: input.code.trim().toUpperCase(), isActive: true },
  });

  if (!coupon) {
    throw new AppError(ERROR_CODES.COUPON_INVALID, "That code isn't valid here");
  }

  const redemptions = await db.couponRedemption.count({
    where: { couponId: coupon.id, voidedAt: null },
  });

  const customerRedemptions = await db.couponRedemption.count({
    where: { couponId: coupon.id, customerId: input.customerId, voidedAt: null },
  });

  const verdict = evaluateCoupon({
    coupon: {
      isActive: coupon.isActive,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      minOrderPaise: coupon.minOrderPaise,
      firstOrderOnly: coupon.firstOrderOnly,
      totalUsageLimit: coupon.totalUsageLimit,
      totalUsed: redemptions,
      perCustomerLimit: coupon.perCustomerLimit,
      customerRedemptionCount: customerRedemptions,
    },
    cartSubtotalAfterPromotionsPaise: input.cartSubtotalAfterPromotionsPaise,
    customerOrderCount: input.customerOrderCount,
    hasOtherCouponApplied: false,
    now: new Date(),
  });

  return {
    couponId: coupon.id,
    code: coupon.code,
    title: coupon.title,
    type: coupon.type,
    verdict,
  };
}

/** Recompute a variant's authoritative unit price. Shared by cart & checkout. */
export function unitPriceFor(variant: {
  pricePerKgPaise: number;
  packWeightGrams: number;
}): Paise {
  return priceForWeight(variant.pricePerKgPaise, variant.packWeightGrams);
}
