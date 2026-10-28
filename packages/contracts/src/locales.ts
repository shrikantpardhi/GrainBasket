/**
 * Locale contract, shared by the web app, the API, and (later) the Expo app.
 *
 * The URL prefix is authoritative: `/hi/...` is Hindi, `/...` is English.
 * That is what makes a shared WhatsApp link open in the language the sender
 * used, and what lets search engines index both versions separately.
 */

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Locale used when a translation row is missing. Never render a blank label. */
export const FALLBACK_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/**
 * Exact IANA zone for the business. Everything money- or day-boundary-related
 * (shift close, business date on a ledger row, "today's orders") resolves
 * against this, never against the server's local time — which on a serverless
 * platform is UTC and would roll the business day at 5:30 AM IST.
 */
export const BUSINESS_TIMEZONE = "Asia/Kolkata";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(candidate: unknown): Locale {
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}

/**
 * Returns the business-local calendar date as "YYYY-MM-DD". Ledger entries and
 * shift reconciliation group on this rather than on UTC timestamps.
 */
export function businessDate(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
