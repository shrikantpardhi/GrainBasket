/**
 * Weight is always integer grams. Pack sizes, stock on hand, milling yields,
 * and line quantities all share this unit so nothing silently mixes kg and g.
 */

export type Grams = number;

const GRAMS_PER_KG = 1000;

export function kgToGrams(kg: string | number): Grams {
  const asString = typeof kg === "number" ? String(kg) : kg.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(asString)) {
    throw new TypeError(`Not a valid weight in kg: ${kg}`);
  }
  const [whole = "0", frac = ""] = asString.split(".");
  return Number(whole) * GRAMS_PER_KG + Number(frac.padEnd(3, "0"));
}

export function gramsToKg(grams: Grams): number {
  assertNonNegativeInt(grams, "grams");
  return grams / GRAMS_PER_KG;
}

/** "2.5 kg" / "500 g" — display only, never parsed back. */
export function formatWeight(grams: Grams, locale: string = "en-IN"): string {
  assertNonNegativeInt(grams, "grams");
  if (grams < GRAMS_PER_KG) {
    const rounded = Math.round(grams);
    return `${new Intl.NumberFormat(locale).format(rounded)} g`;
  }
  const kg = grams / GRAMS_PER_KG;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(kg);
  return `${formatted} kg`;
}

/** Display an authoritative per-kg rate as "₹64/kg". */
export function formatRatePerKg(pricePerKgPaise: number, locale: string = "en-IN"): string {
  const rupees = pricePerKgPaise / 100;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `₹${formatted}/kg`;
}

/**
 * Milling yield: how much output flour a given input grain produces.
 * `expectedYieldBps` of 9800 means 98% of input weight comes back as flour.
 */
export function expectedOutputGrams(inputGrams: Grams, expectedYieldBps: number): Grams {
  assertNonNegativeInt(inputGrams, "inputGrams");
  if (!Number.isInteger(expectedYieldBps) || expectedYieldBps < 0) {
    throw new RangeError(`expectedYieldBps must be a non-negative integer`);
  }
  return Math.round((inputGrams * expectedYieldBps) / 10_000);
}

/** Observed yield in basis points, clamped to 0..10000. */
export function yieldBps(inputGrams: Grams, outputGrams: Grams): number {
  assertNonNegativeInt(inputGrams, "inputGrams");
  assertNonNegativeInt(outputGrams, "outputGrams");
  if (inputGrams === 0) return 0;
  return Math.min(10_000, Math.round((outputGrams * 10_000) / inputGrams));
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}
