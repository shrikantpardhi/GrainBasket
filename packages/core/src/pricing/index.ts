/**
 * The one pricing pipeline. Cart preview, checkout, invoice, refund, and the
 * Expo app all call `priceOrder`. If two of those computed a total differently
 * we would eventually take money that doesn't match the invoice, which is a
 * GST problem, not just a bug.
 *
 * Fixed order of operations (changing this is a product decision, not a
 * refactor):
 *
 *   1. line totals           (per-kg rate x weight + grind/sift modifiers)
 *   2. automatic promotions  (code-free category/product discounts)
 *   3. coupon discount       (one coupon, applied after promotions)
 *   4. delivery fee          (can be zeroed by a FREE_DELIVERY coupon)
 *   5. tax extraction        (on the discounted total, prices are GST-inclusive)
 *   6. grand total
 *
 * All amounts are integer paise. No floats.
 */

import { type Paise, priceForWeight, extractInclusiveTax } from "@grain-basket/contracts";

/** ------------------------------------------------------------------ */
/* Inputs                                                               */
/** ------------------------------------------------------------------ */

export interface GrindModifier {
  /** Extra paise per kg for this fineness. May be negative (a discount). */
  finenessDeltaPerKgPaise: number;
  /** Extra paise per kg when sifted. */
  siftedDeltaPerKgPaise: number;
}

export interface PricedLineInput {
  /** Stable identifier for correlating output back to the cart item. */
  key: string;
  productId: string;
  categoryId: string | null;
  /** Authoritative per-kg rate. */
  pricePerKgPaise: Paise;
  packWeightGrams: number;
  /** Defaults to 1. */
  quantity?: number;
  /** Null when the product is not milled. */
  grindModifier?: GrindModifier | null;
  isSifted?: boolean;
}

/** A code-free automatic promotion. `PERCENT` uses basis points. */
export interface AutoPromotion {
  id: string;
  /** Applies to one product, one category, or (both null) every line. */
  productId: string | null;
  categoryId: string | null;
  type: "PERCENT" | "FLAT";
  /** bps for PERCENT, paise for FLAT. FLAT is split across matching lines. */
  value: number;
  /** Optional cap in paise, mostly for PERCENT. */
  maxDiscountPaise?: number | null;
}

export interface AppliedCoupon {
  id: string;
  code: string;
  type: "PERCENT" | "FLAT" | "FREE_DELIVERY";
  /** bps for PERCENT, paise for FLAT, ignored for FREE_DELIVERY. */
  value: number;
  maxDiscountPaise?: number | null;
  minOrderPaise?: number | null;
  fundingParty: "STORE" | "PLATFORM";
}

export interface TaxRule {
  /** GST rate in basis points, e.g. 500 = 5%. */
  gstBps: number;
  /** Whether displayed prices already include GST. Indian retail: true. */
  taxInclusive: boolean;
  /** true when the shop's state differs from the delivery state. */
  interState?: boolean;
}

export interface PriceOrderInput {
  lines: PricedLineInput[];
  promotions?: AutoPromotion[];
  coupon?: AppliedCoupon | null;
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryFeePaise?: Paise;
  tax: TaxRule;
  minOrderPaise?: Paise | null;
}

/** ------------------------------------------------------------------ */
/* Outputs                                                              */
/** ------------------------------------------------------------------ */

export interface PricedLine {
  key: string;
  productId: string;
  quantity: number;
  unitPricePaise: Paise;
  lineSubtotalPaise: Paise;
  promotionDiscountPaise: Paise;
  couponDiscountPaise: Paise;
  /** Subtotal less all discounts, before tax extraction. */
  netPaise: Paise;
  taxPaise: Paise;
  basePaise: Paise;
}

export interface PricedOrder {
  lines: PricedLine[];
  /** Sum of line subtotals before any discount. */
  subtotalPaise: Paise;
  promotionDiscountPaise: Paise;
  /** Goods discount only. Delivery waived by a coupon is reported separately. */
  couponDiscountPaise: Paise;
  /** Discount applied against the delivery fee (FREE_DELIVERY coupons). */
  deliveryDiscountPaise: Paise;
  /** The delivery fee actually charged, after any waiver. */
  deliveryFeePaise: Paise;
  /** Tax embedded in the discounted total (never added on top). */
  taxPaise: Paise;
  /** What the customer actually pays. */
  totalPaise: Paise;
  /** Who funded the coupon discount — settlement needs this. */
  couponFundingParty: "STORE" | "PLATFORM" | null;
  appliedCouponId: string | null;
  /** True when the cart is under the shop's minimum order value. */
  belowMinimum: boolean;
}

/** ------------------------------------------------------------------ */
/* The pipeline                                                         */
/** ------------------------------------------------------------------ */

export function priceOrder(input: PriceOrderInput): PricedOrder {
  if (input.lines.length === 0) {
    return emptyOrder(input);
  }

  const promotions = input.promotions ?? [];

  // -- 1. Line totals -----------------------------------------------------
  const baseLines = input.lines.map((line) => {
    const quantity = line.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
    }
    const perKg =
      line.pricePerKgPaise +
      (line.grindModifier?.finenessDeltaPerKgPaise ?? 0) +
      (line.isSifted ? (line.grindModifier?.siftedDeltaPerKgPaise ?? 0) : 0);

    // A modifier must never make a flour free or negative.
    const effectivePerKg = Math.max(0, perKg);
    const unitPricePaise = priceForWeight(effectivePerKg, line.packWeightGrams);

    return {
      line,
      quantity,
      unitPricePaise,
      lineSubtotalPaise: unitPricePaise * quantity,
    };
  });

  const subtotalPaise = baseLines.reduce((sum, l) => sum + l.lineSubtotalPaise, 0);

  // -- 2. Automatic promotions -------------------------------------------
  // Each promotion's discount is allocated across the lines it matches, so
  // per-line tax extraction stays correct.
  const promotionByLine = new Map<string, number>();
  let promotionDiscountPaise = 0;

  for (const promo of promotions) {
    const matching = baseLines.filter((l) => promotionMatches(promo, l.line));
    if (matching.length === 0) continue;

    const matchingTotal = matching.reduce((sum, l) => sum + l.lineSubtotalPaise, 0);
    if (matchingTotal === 0) continue;

    let promoDiscount =
      promo.type === "PERCENT"
        ? Math.round((matchingTotal * promo.value) / 10_000)
        : Math.min(promo.value, matchingTotal);

    if (promo.maxDiscountPaise != null) {
      promoDiscount = Math.min(promoDiscount, promo.maxDiscountPaise);
    }
    if (promoDiscount <= 0) continue;

    promotionDiscountPaise += promoDiscount;

    // Allocate proportionally; the last matching line absorbs the rounding
    // remainder so the allocation always sums exactly to promoDiscount.
    let allocated = 0;
    matching.forEach((l, index) => {
      const isLast = index === matching.length - 1;
      const share = isLast
        ? promoDiscount - allocated
        : Math.floor((promoDiscount * l.lineSubtotalPaise) / matchingTotal);
      allocated += share;
      promotionByLine.set(l.line.key, (promotionByLine.get(l.line.key) ?? 0) + share);
    });
  }

  const afterPromotions = baseLines.map((l) => {
    const promoDiscount = Math.min(promotionByLine.get(l.line.key) ?? 0, l.lineSubtotalPaise);
    return { ...l, promoDiscount, afterPromo: l.lineSubtotalPaise - promoDiscount };
  });

  const afterPromotionsTotal = afterPromotions.reduce((sum, l) => sum + l.afterPromo, 0);

  // -- 3. Coupon ----------------------------------------------------------
  let couponDiscountPaise = 0;
  let deliveryDiscountPaise = 0;
  let deliveryFeePaise = input.fulfilment === "PICKUP" ? 0 : (input.deliveryFeePaise ?? 0);
  let appliedCouponId: string | null = null;

  if (input.coupon) {
    const coupon = input.coupon;
    const minimum = coupon.minOrderPaise ?? input.minOrderPaise ?? 0;
    if (afterPromotionsTotal < minimum) {
      // Not applied. Callers that need to explain why run `evaluateCoupon`
      // first; this path is the final guard so a stale cart can never get a
      // discount it no longer qualifies for.
    } else if (coupon.type === "FREE_DELIVERY") {
      // Waives the delivery fee. It must NOT also come off the goods total —
      // that would discount the order twice, once against goods and once
      // against delivery.
      deliveryDiscountPaise = deliveryFeePaise;
      deliveryFeePaise = 0;
      appliedCouponId = coupon.id;
    } else {
      let discount =
        coupon.type === "PERCENT"
          ? Math.round((afterPromotionsTotal * coupon.value) / 10_000)
          : Math.min(coupon.value, afterPromotionsTotal);

      if (coupon.maxDiscountPaise != null) {
        discount = Math.min(discount, coupon.maxDiscountPaise);
      }
      // Never discount more than the goods are worth — the total cannot go
      // below zero, and negative totals break refunds and invoices.
      discount = Math.min(discount, afterPromotionsTotal);
      couponDiscountPaise = discount;
      appliedCouponId = coupon.id;
    }
  }

  // Coupon discount is spread proportionally over the post-promotion lines so
  // each line can be taxed on its own net amount.
  const couponByLine = new Map<string, number>();
  if (couponDiscountPaise > 0) {
    let allocated = 0;
    afterPromotions.forEach((l, index) => {
      const isLast = index === afterPromotions.length - 1;
      const share = isLast
        ? couponDiscountPaise - allocated
        : Math.floor((couponDiscountPaise * l.afterPromo) / afterPromotionsTotal);
      allocated += share;
      couponByLine.set(l.line.key, share);
    });
  }

  // -- 4 & 5. Tax extraction ---------------------------------------------
  // Prices are GST-inclusive at the line level, so tax is backed out of each
  // line's net amount. Delivery is taxed at the same rate.
  const lines: PricedLine[] = afterPromotions.map((l) => {
    const couponDiscount = Math.min(couponByLine.get(l.line.key) ?? 0, l.afterPromo);
    const net = l.afterPromo - couponDiscount;
    const { base, tax } = input.tax.taxInclusive
      ? extractInclusiveTax(net, input.tax.gstBps)
      : { base: net, tax: Math.round((net * input.tax.gstBps) / 10_000) };

    return {
      key: l.line.key,
      productId: l.line.productId,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      lineSubtotalPaise: l.lineSubtotalPaise,
      promotionDiscountPaise: l.promoDiscount,
      couponDiscountPaise: couponDiscount,
      netPaise: net,
      taxPaise: tax,
      basePaise: base,
    };
  });

  const goodsTaxPaise = lines.reduce((sum, l) => sum + l.taxPaise, 0);
  const deliveryTaxPaise = input.tax.taxInclusive
    ? extractInclusiveTax(deliveryFeePaise, input.tax.gstBps).tax
    : Math.round((deliveryFeePaise * input.tax.gstBps) / 10_000);

  // -- 6. Grand total -----------------------------------------------------
  // When prices are tax-inclusive the total is simply goods + delivery; tax is
  // an informational breakdown, not an addition.
  const totalPaise = input.tax.taxInclusive
    ? afterPromotionsTotal - couponDiscountPaise + deliveryFeePaise
    : afterPromotionsTotal - couponDiscountPaise + deliveryFeePaise + goodsTaxPaise + deliveryTaxPaise;

  const minOrder = input.minOrderPaise ?? 0;

  return {
    lines,
    subtotalPaise,
    promotionDiscountPaise,
    couponDiscountPaise,
    deliveryDiscountPaise,
    deliveryFeePaise,
    taxPaise: goodsTaxPaise + deliveryTaxPaise,
    totalPaise,
    couponFundingParty:
      input.coupon && couponDiscountPaise + deliveryDiscountPaise > 0
        ? input.coupon.fundingParty
        : null,
    appliedCouponId,
    belowMinimum: minOrder > 0 && totalPaise < minOrder,
  };
}

function promotionMatches(promo: AutoPromotion, line: PricedLineInput): boolean {
  if (promo.productId && promo.productId !== line.productId) return false;
  if (promo.categoryId && promo.categoryId !== line.categoryId) return false;
  return true;
}

function emptyOrder(input: PriceOrderInput): PricedOrder {
  return {
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
  };
}

/**
 * Why a coupon didn't apply, for the UI. Checked separately from `priceOrder`
 * so the pricing path stays allocation-only and the eligibility rules live in
 * one readable place.
 */
export type CouponRejection =
  | "NOT_STARTED"
  | "EXPIRED"
  | "BELOW_MINIMUM"
  | "NOT_APPLICABLE_TO_CART"
  | "CUSTOMER_LIMIT_REACHED"
  | "TOTAL_LIMIT_REACHED"
  | "FIRST_ORDER_ONLY"
  | "STACKING_NOT_ALLOWED";

export interface CouponEligibilityInput {
  coupon: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    minOrderPaise: number | null;
    firstOrderOnly: boolean;
    totalUsageLimit: number | null;
    totalUsed: number;
    perCustomerLimit: number | null;
    customerRedemptionCount: number;
  };
  cartSubtotalAfterPromotionsPaise: Paise;
  customerOrderCount: number;
  hasOtherCouponApplied: boolean;
  now: Date;
}

export function evaluateCoupon(
  input: CouponEligibilityInput,
): { ok: true } | { ok: false; reason: CouponRejection } {
  const { coupon } = input;

  if (!coupon.isActive) return { ok: false, reason: "EXPIRED" };
  if (coupon.startsAt && input.now < coupon.startsAt) return { ok: false, reason: "NOT_STARTED" };
  if (coupon.endsAt && input.now > coupon.endsAt) return { ok: false, reason: "EXPIRED" };
  if (input.hasOtherCouponApplied) return { ok: false, reason: "STACKING_NOT_ALLOWED" };
  if (coupon.firstOrderOnly && input.customerOrderCount > 0) {
    return { ok: false, reason: "FIRST_ORDER_ONLY" };
  }
  if (coupon.minOrderPaise != null && input.cartSubtotalAfterPromotionsPaise < coupon.minOrderPaise) {
    return { ok: false, reason: "BELOW_MINIMUM" };
  }
  if (coupon.totalUsageLimit != null && coupon.totalUsed >= coupon.totalUsageLimit) {
    return { ok: false, reason: "TOTAL_LIMIT_REACHED" };
  }
  if (
    coupon.perCustomerLimit != null &&
    coupon.customerRedemptionCount >= coupon.perCustomerLimit
  ) {
    return { ok: false, reason: "CUSTOMER_LIMIT_REACHED" };
  }
  return { ok: true };
}
