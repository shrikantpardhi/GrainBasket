import { describe, expect, it } from "vitest";
import {
  priceOrder,
  evaluateCoupon,
  type CouponEligibilityInput,
  type PricedLineInput,
  type TaxRule,
} from "./index";

const GST5: TaxRule = { gstBps: 500, taxInclusive: true };

function line(overrides: Partial<PricedLineInput> = {}): PricedLineInput {
  return {
    key: "line-1",
    productId: "prod-wheat",
    categoryId: "cat-flour",
    pricePerKgPaise: 6000, // ₹60/kg
    packWeightGrams: 1000,
    ...overrides,
  };
}

describe("priceOrder — line totals", () => {
  it("prices a 5 kg pack off the authoritative per-kg rate", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 5000 })],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.subtotalPaise).toBe(30_000); // ₹300
    expect(result.totalPaise).toBe(30_000);
  });

  it("multiplies by quantity", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 1000, quantity: 3 })],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.subtotalPaise).toBe(18_000);
  });

  it("applies grind and sift modifiers before pricing", () => {
    const result = priceOrder({
      lines: [
        line({
          grindModifier: { finenessDeltaPerKgPaise: 500, siftedDeltaPerKgPaise: 200 },
          isSifted: true,
        }),
      ],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    // (6000 + 500 + 200) * 1000 / 1000 = 6700
    expect(result.lines[0]!.unitPricePaise).toBe(6700);
  });

  it("ignores the sift modifier when the item is not sifted", () => {
    const result = priceOrder({
      lines: [
        line({
          grindModifier: { finenessDeltaPerKgPaise: 500, siftedDeltaPerKgPaise: 200 },
          isSifted: false,
        }),
      ],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.lines[0]!.unitPricePaise).toBe(6500);
  });
});

describe("priceOrder — promotions", () => {
  it("applies a category percent promotion", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 5000 })],
      promotions: [
        {
          id: "p1",
          productId: null,
          categoryId: "cat-flour",
          type: "PERCENT",
          value: 1000, // 10%
        },
      ],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.promotionDiscountPaise).toBe(3000); // 10% of ₹300
    expect(result.totalPaise).toBe(27_000);
  });

  it("caps a percent promotion at maxDiscountPaise", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 10_000 })],
      promotions: [
        {
          id: "p1",
          productId: null,
          categoryId: "cat-flour",
          type: "PERCENT",
          value: 5000,
          maxDiscountPaise: 5000, // cap ₹50
        },
      ],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.promotionDiscountPaise).toBe(5000);
  });

  it("splits a flat promotion so the allocation sums exactly", () => {
    const result = priceOrder({
      lines: [
        line({ key: "a", productId: "wheat", packWeightGrams: 1000 }),
        line({ key: "b", productId: "rice", packWeightGrams: 2000 }),
        line({ key: "c", productId: "bajra", packWeightGrams: 3000 }),
      ],
      promotions: [
        { id: "p1", productId: null, categoryId: null, type: "FLAT", value: 1000 },
      ],
      fulfilment: "PICKUP",
      tax: GST5,
    });
    const allocated = result.lines.reduce((s, l) => s + l.promotionDiscountPaise, 0);
    expect(allocated).toBe(1000);
    expect(result.promotionDiscountPaise).toBe(1000);
  });
});

describe("priceOrder — coupons", () => {
  it("applies a percent coupon after promotions", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 10_000 })], // ₹600
      promotions: [
        { id: "p1", productId: null, categoryId: null, type: "PERCENT", value: 1000 },
      ],
      coupon: {
        id: "c1",
        code: "SAVE10",
        type: "PERCENT",
        value: 1000,
        fundingParty: "STORE",
      },
      fulfilment: "PICKUP",
      tax: GST5,
    });
    // ₹600 - 10% promo = ₹540; then 10% coupon = ₹54
    expect(result.promotionDiscountPaise).toBe(6000);
    expect(result.couponDiscountPaise).toBe(5400);
    expect(result.totalPaise).toBe(48_600);
  });

  it("never discounts below zero", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 1000 })], // ₹60
      coupon: {
        id: "c1",
        code: "BIG",
        type: "FLAT",
        value: 999_999,
        fundingParty: "PLATFORM",
      },
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.totalPaise).toBe(0);
    expect(result.couponFundingParty).toBe("PLATFORM");
  });

  it("zeroes delivery for a FREE_DELIVERY coupon without touching goods", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 1000 })],
      coupon: {
        id: "c1",
        code: "FREESHIP",
        type: "FREE_DELIVERY",
        value: 0,
        fundingParty: "STORE",
      },
      fulfilment: "DELIVERY",
      deliveryFeePaise: 4900,
      tax: GST5,
    });
    expect(result.deliveryFeePaise).toBe(0);
    expect(result.totalPaise).toBe(6000);
  });

  it("does not apply a coupon below its minimum order value", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 1000 })], // ₹60
      coupon: {
        id: "c1",
        code: "MIN500",
        type: "FLAT",
        value: 5000,
        minOrderPaise: 50_000,
        fundingParty: "STORE",
      },
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.couponDiscountPaise).toBe(0);
    expect(result.totalPaise).toBe(6000);
  });
});

describe("priceOrder — tax and delivery", () => {
  it("treats inclusive prices as gross and backs tax out", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 10_000 })], // ₹600 gross
      fulfilment: "PICKUP",
      tax: GST5,
    });
    expect(result.totalPaise).toBe(60_000);
    // 600 / 1.05 = 571.43 -> tax 28.57
    expect(result.lines[0]!.basePaise).toBe(57_143);
    expect(result.lines[0]!.taxPaise).toBe(2857);
    expect(result.taxPaise).toBe(2857);
  });

  it("adds tax on top when prices are exclusive", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 10_000 })],
      fulfilment: "PICKUP",
      tax: { gstBps: 500, taxInclusive: false },
    });
    expect(result.taxPaise).toBe(3000);
    expect(result.totalPaise).toBe(63_000);
  });

  it("charges delivery for delivery orders and nothing for pickup", () => {
    const delivery = priceOrder({
      lines: [line()],
      fulfilment: "DELIVERY",
      deliveryFeePaise: 4000,
      tax: GST5,
    });
    expect(delivery.totalPaise).toBe(10_000);

    const pickup = priceOrder({
      lines: [line()],
      fulfilment: "PICKUP",
      deliveryFeePaise: 4000,
      tax: GST5,
    });
    expect(pickup.totalPaise).toBe(6000);
    expect(pickup.deliveryFeePaise).toBe(0);
  });

  it("flags a cart under the shop minimum", () => {
    const result = priceOrder({
      lines: [line({ packWeightGrams: 1000 })],
      fulfilment: "PICKUP",
      tax: GST5,
      minOrderPaise: 20_000,
    });
    expect(result.belowMinimum).toBe(true);
  });

  it("keeps line discounts consistent: subtotal - promos - coupon + delivery = total", () => {
    const result = priceOrder({
      lines: [
        line({ key: "a", productId: "wheat", packWeightGrams: 3000 }),
        line({ key: "b", productId: "rice", packWeightGrams: 7000, categoryId: "cat-grain" }),
      ],
      promotions: [
        { id: "p1", productId: "wheat", categoryId: null, type: "PERCENT", value: 500 },
      ],
      coupon: { id: "c1", code: "X", type: "FLAT", value: 2000, fundingParty: "STORE" },
      fulfilment: "DELIVERY",
      deliveryFeePaise: 3000,
      tax: GST5,
    });
    expect(
      result.subtotalPaise -
        result.promotionDiscountPaise -
        result.couponDiscountPaise +
        result.deliveryFeePaise,
    ).toBe(result.totalPaise);
  });
});

describe("evaluateCoupon", () => {
  // Annotated so `null` stays "nullable field" rather than widening to the
  // literal type null, which would reject a Date in the overrides.
  const base: CouponEligibilityInput["coupon"] = {
    isActive: true,
    startsAt: null,
    endsAt: null,
    minOrderPaise: null,
    firstOrderOnly: false,
    totalUsageLimit: null,
    totalUsed: 0,
    perCustomerLimit: null,
    customerRedemptionCount: 0,
  };
  const now = new Date("2026-10-28T10:00:00Z");

  function check(overrides: Partial<typeof base> = {}, input: Partial<Parameters<typeof evaluateCoupon>[0]> = {}) {
    return evaluateCoupon({
      coupon: { ...base, ...overrides },
      cartSubtotalAfterPromotionsPaise: 10_000,
      customerOrderCount: 0,
      hasOtherCouponApplied: false,
      now,
      ...input,
    });
  }

  it("accepts a plain valid coupon", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("rejects an expired coupon", () => {
    expect(check({ endsAt: new Date("2026-10-01T00:00:00Z") })).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("rejects a coupon that has not started", () => {
    expect(check({ startsAt: new Date("2026-12-01T00:00:00Z") })).toEqual({
      ok: false,
      reason: "NOT_STARTED",
    });
  });

  it("rejects below the minimum order value", () => {
    expect(check({ minOrderPaise: 50_000 })).toEqual({ ok: false, reason: "BELOW_MINIMUM" });
  });

  it("rejects when the total usage cap is reached", () => {
    expect(check({ totalUsageLimit: 100, totalUsed: 100 })).toEqual({
      ok: false,
      reason: "TOTAL_LIMIT_REACHED",
    });
  });

  it("rejects when this customer hit their limit", () => {
    expect(check({ perCustomerLimit: 1, customerRedemptionCount: 1 })).toEqual({
      ok: false,
      reason: "CUSTOMER_LIMIT_REACHED",
    });
  });

  it("rejects a first-order-only coupon for a returning customer", () => {
    expect(check({ firstOrderOnly: true }, { customerOrderCount: 2 })).toEqual({
      ok: false,
      reason: "FIRST_ORDER_ONLY",
    });
  });

  it("rejects stacking a second coupon", () => {
    expect(check({}, { hasOtherCouponApplied: true })).toEqual({
      ok: false,
      reason: "STACKING_NOT_ALLOWED",
    });
  });
});
