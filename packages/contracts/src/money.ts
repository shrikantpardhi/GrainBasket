/**
 * Money is always integer paise. There is no float anywhere in the money path
 * and no `number` in rupees. Every conversion between a rate and an amount
 * happens here so rounding is decided once.
 */

export type Paise = number;

const PAISE_PER_RUPEE = 100;

/**
 * Derive a line price from the authoritative per-kg rate.
 *
 * `pricePerKgPaise` is the source of truth; `pricePaise` on a variant is a
 * denormalized cache and is always recomputed through this function.
 */
export function priceForWeight(pricePerKgPaise: Paise, packWeightGrams: number): Paise {
  assertNonNegativeInt(pricePerKgPaise, "pricePerKgPaise");
  assertNonNegativeInt(packWeightGrams, "packWeightGrams");
  // Divide-then-multiply would lose paise on odd rates. Multiply in a safe
  // integer range: rates stay well under 2^53 / 100_000 in practice, but we
  // guard anyway.
  const product = pricePerKgPaise * packWeightGrams;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(
      `pricePerKgPaise * packWeightGrams overflows safe integer range (${pricePerKgPaise} * ${packWeightGrams})`,
    );
  }
  return Math.round(product / 1000);
}

/** Apply a basis-point rate (10000 bps = 100%). */
export function applyBasisPoints(amountPaise: Paise, bps: number): Paise {
  assertNonNegativeInt(amountPaise, "amountPaise");
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`bps must be a non-negative integer, got ${bps}`);
  }
  return Math.round((amountPaise * bps) / 10_000);
}

/** Rupees (as a decimal string or number) to paise. Accepts "124.50". */
export function rupeesToPaise(rupees: string | number): Paise {
  const asString = typeof rupees === "number" ? rupees.toFixed(2) : rupees.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(asString)) {
    throw new TypeError(`Not a valid rupee amount: ${rupees}`);
  }
  const negative = asString.startsWith("-");
  const [whole = "0", frac = ""] = (negative ? asString.slice(1) : asString).split(".");
  const paise = Number(whole) * PAISE_PER_RUPEE + Number(frac.padEnd(2, "0"));
  return negative ? -paise : paise;
}

/** Paise to a plain rupee decimal string, e.g. 124050 -> "1240.50". */
export function paiseToRupeesString(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const frac = String(abs % PAISE_PER_RUPEE).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Display only — Indian grouping (₹1,24,050.50). Server code must never parse
 * this back; use `rupeesToPaise` on raw input.
 */
export function formatPaise(paise: Paise, locale: string = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / PAISE_PER_RUPEE);
}

/**
 * Extract the tax component embedded in a tax-inclusive amount.
 * Indian retail prices are quoted inclusive of GST, so the invoice has to
 * back out the tax rather than add it on top.
 */
export function extractInclusiveTax(grossPaise: Paise, gstBps: number): { base: Paise; tax: Paise } {
  assertNonNegativeInt(grossPaise, "grossPaise");
  if (!Number.isInteger(gstBps) || gstBps < 0) {
    throw new RangeError(`gstBps must be a non-negative integer, got ${gstBps}`);
  }
  const base = Math.round((grossPaise * 10_000) / (10_000 + gstBps));
  return { base, tax: grossPaise - base };
}

/** Split a tax amount into its CGST/SGST halves for intra-state invoices. */
export function splitTax(taxPaise: Paise): { cgst: Paise; sgst: Paise; igst: Paise } {
  const cgst = Math.round(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst, igst: 0 };
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}
