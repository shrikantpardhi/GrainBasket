/**
 * The contracts package is where the units are decided, so these tests are
 * about the units themselves: paise, grams, basis points, and the locale tags
 * that decide how a price renders.
 *
 * A bug here is not a bug in one screen — every price, weight, and invoice
 * line in the product derives from these functions.
 */

import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  extractInclusiveTax,
  formatPaise,
  paiseToRupeesString,
  priceForWeight,
  rupeesToPaise,
  splitTax,
} from "./money";
import {
  expectedOutputGrams,
  formatRatePerKg,
  formatWeight,
  kgToGrams,
  yieldBps,
} from "./weight";
import { INTL_TAGS, LOCALES, businessDate, isLocale, resolveLocale } from "./locales";
import { PERMISSIONS, PLATFORM_ROLE_PERMISSIONS, STORE_ROLE_PERMISSIONS, can } from "./permissions";

describe("money — paise in, paise out", () => {
  it("derives a pack price from the per-kg rate", () => {
    expect(priceForWeight(6000, 1000)).toBe(6000);
    expect(priceForWeight(6000, 5000)).toBe(30_000);
    expect(priceForWeight(6000, 250)).toBe(1500);
  });

  it("rounds a half-paisa pack up rather than truncating", () => {
    // ₹33.33/kg for 250 g = 833.25 paise -> 833.
    expect(priceForWeight(3333, 250)).toBe(833);
    // ₹0.01/kg for 500 g = 0.5 paise -> 1, not 0 (a free pack is worse).
    expect(priceForWeight(1, 500)).toBe(1);
  });

  it("refuses a negative or fractional rate instead of guessing", () => {
    expect(() => priceForWeight(-1, 1000)).toThrow(RangeError);
    expect(() => priceForWeight(10.5, 1000)).toThrow(RangeError);
    expect(() => priceForWeight(100, -1)).toThrow(RangeError);
  });

  it("applies a basis-point rate", () => {
    expect(applyBasisPoints(10_000, 500)).toBe(500); // 5%
    expect(applyBasisPoints(10_000, 1200)).toBe(1200); // 12%
    expect(applyBasisPoints(10_000, 10_000)).toBe(10_000); // 100%
  });

  it("round-trips rupees through paise without float drift", () => {
    expect(rupeesToPaise("124.50")).toBe(12_450);
    expect(rupeesToPaise("124")).toBe(12_400);
    expect(rupeesToPaise(124.5)).toBe(12_450);
    expect(paiseToRupeesString(12_450)).toBe("124.50");
    expect(paiseToRupeesString(5)).toBe("0.05");
  });

  it("rejects rupees it cannot read exactly", () => {
    expect(() => rupeesToPaise("12.345")).toThrow(TypeError);
    expect(() => rupeesToPaise("₹100")).toThrow(TypeError);
    expect(() => rupeesToPaise("abc")).toThrow(TypeError);
  });

  it("formats with Indian lakh/crore grouping", () => {
    // ₹1,24,050.50 — not ₹124,050.50. This is why INTL_TAGS exists.
    expect(formatPaise(12_405_050, "en-IN")).toContain("1,24,050");
  });

  it("backs GST out of an inclusive price", () => {
    // ₹100 inclusive of 5% is ₹95.24 + ₹4.76.
    const { base, tax } = extractInclusiveTax(10_000, 500);
    expect(base + tax).toBe(10_000);
    expect(base).toBe(9524);
    expect(tax).toBe(476);
  });

  it("splits an intra-state tax into equal halves with no lost paisa", () => {
    const { cgst, sgst, igst } = splitTax(476);
    expect(cgst + sgst).toBe(476);
    expect(Math.abs(cgst - sgst)).toBeLessThanOrEqual(1);
    expect(igst).toBe(0);
  });
});

describe("weight — grams in, grams out", () => {
  it("parses kg strings without float error", () => {
    expect(kgToGrams("1")).toBe(1000);
    expect(kgToGrams("2.5")).toBe(2500);
    expect(kgToGrams("0.125")).toBe(125);
    expect(kgToGrams(2.5)).toBe(2500);
  });

  it("rejects weights it cannot represent in whole grams", () => {
    expect(() => kgToGrams("1.2345")).toThrow(TypeError);
    expect(() => kgToGrams("-1")).toThrow(TypeError);
    expect(() => kgToGrams("2kg")).toThrow(TypeError);
  });

  it("formats under a kilo in grams and above it in kg", () => {
    expect(formatWeight(500, "en-IN")).toBe("500 g");
    expect(formatWeight(2500, "en-IN")).toContain("2.5 kg");
  });

  it("formats the authoritative rate as ₹/kg", () => {
    expect(formatRatePerKg(6000, "en-IN")).toBe("₹60/kg");
    expect(formatRatePerKg(6450, "en-IN")).toBe("₹64.5/kg");
  });

  it("computes expected output from a yield in basis points", () => {
    expect(expectedOutputGrams(10_000, 9800)).toBe(9800);
    expect(expectedOutputGrams(10_000, 10_000)).toBe(10_000);
  });

  it("computes observed yield and clamps it to 100%", () => {
    expect(yieldBps(10_000, 9800)).toBe(9800);
    expect(yieldBps(10_000, 12_000)).toBe(10_000); // clamped, not 120%
    expect(yieldBps(0, 0)).toBe(0); // no divide-by-zero
  });
});

describe("locales", () => {
  it("recognises exactly the supported locales", () => {
    expect(LOCALES).toEqual(["en", "hi"]);
    expect(isLocale("hi")).toBe(true);
    expect(isLocale("ta")).toBe(false);
    expect(resolveLocale("ta")).toBe("en");
  });

  it("maps every locale to an Indian Intl tag", () => {
    for (const locale of LOCALES) {
      expect(INTL_TAGS[locale]).toMatch(/-IN$/);
    }
  });

  it("resolves the business date in IST, not the server's zone", () => {
    // 20:00 UTC on 28 Oct is 01:30 IST on 29 Oct. A business day that rolled
    // at UTC midnight would file this under the wrong date on every report.
    expect(businessDate(new Date("2026-10-28T20:00:00Z"))).toBe("2026-10-29");
    expect(businessDate(new Date("2026-10-28T10:00:00Z"))).toBe("2026-10-28");
  });
});

describe("permissions", () => {
  it("gives store staff cash collection but not earnings visibility", () => {
    const staff = STORE_ROLE_PERMISSIONS.STORE_STAFF;
    expect(can(staff, PERMISSIONS.COD_COLLECT)).toBe(true);
    expect(can(staff, PERMISSIONS.EARNINGS_VIEW)).toBe(false);
  });

  it("gives a mill operator no pricing or earnings rights", () => {
    const op = STORE_ROLE_PERMISSIONS.MILL_OPERATOR;
    expect(can(op, PERMISSIONS.MILLING_CLAIM)).toBe(true);
    expect(can(op, PERMISSIONS.PRODUCT_EDIT)).toBe(false);
    expect(can(op, PERMISSIONS.EARNINGS_VIEW)).toBe(false);
  });

  it("gives platform support no store configuration or refunds", () => {
    const support = PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPPORT;
    expect(can(support, PERMISSIONS.ORDER_VIEW_ALL)).toBe(true);
    expect(can(support, PERMISSIONS.STORE_EDIT)).toBe(false);
    expect(can(support, PERMISSIONS.REFUND_ISSUE)).toBe(false);
    expect(can(support, PERMISSIONS.CUSTOMER_PII_REVEAL)).toBe(false);
  });

  it("gives a platform admin everything", () => {
    const admin = PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN;
    for (const permission of Object.values(PERMISSIONS)) {
      expect(can(admin, permission)).toBe(true);
    }
  });

  it("keeps the permission keys unique", () => {
    const values = Object.values(PERMISSIONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
