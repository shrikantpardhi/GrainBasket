/**
 * Every enum that crosses a package or network boundary lives here.
 *
 * Rule: these are the values stored in Postgres and sent over the wire.
 * Anything user-facing is looked up from the i18n catalogue by key, never by
 * prettifying the stored value. That is what keeps "MILL_AHEAD" from leaking
 * into Hindi UI as "Mill Ahead".
 */

/** Who a person is — three disjoint universes, never merged into one table. */
export const ACTOR_UNIVERSES = ["PLATFORM", "STORE", "CUSTOMER", "SYSTEM"] as const;
export type ActorUniverse = (typeof ACTOR_UNIVERSES)[number];

export const PLATFORM_ROLES = ["PLATFORM_ADMIN", "PLATFORM_SUPPORT"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const STORE_ROLES = ["STORE_ADMIN", "STORE_STAFF", "MILL_OPERATOR"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

/** ------------------------------------------------------------------ */
/* Shop                                                                 */
/** ------------------------------------------------------------------ */

/**
 * Status is split into three independent axes on purpose. A compliance hold
 * (`orderingStatus = PAUSED`) must still let the shop drain its milling queue
 * and read its own data, which a single "suspended" enum cannot express.
 */
export const ORDERING_STATUSES = ["OPEN", "PAUSED", "CLOSED"] as const;
export type OrderingStatus = (typeof ORDERING_STATUSES)[number];

export const ACCESS_STATUSES = ["ACTIVE", "LOCKED"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const PAYOUT_STATUSES = ["ACTIVE", "HOLD"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** ------------------------------------------------------------------ */
/* Catalogue                                                            */
/** ------------------------------------------------------------------ */

export const PRODUCT_TYPES = ["FLOUR", "GRAIN", "PULSE", "DRY_FRUIT", "OTHER"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** How finely the grain is ground. Independent of sifting. */
export const GRIND_FINENESSES = ["FINE", "MEDIUM", "COARSE", "WHOLE"] as const;
export type GrindFineness = (typeof GRIND_FINENESSES)[number];

export const SIFT_CHOICES = ["SIFTED", "UNSIFTED"] as const;
export type SiftChoice = (typeof SIFT_CHOICES)[number];

/** ------------------------------------------------------------------ */
/* Milling                                                              */
/** ------------------------------------------------------------------ */

/**
 * MILL_IN_PRESENCE reserves an operator slot and must run inside it.
 * MILL_AHEAD consumes queue throughput and can be reordered by promise time.
 */
export const MILLING_MODES = ["MILL_AHEAD", "MILL_IN_PRESENCE"] as const;
export type MillingMode = (typeof MILLING_MODES)[number];

export const MILLING_JOB_STATUSES = [
  "QUEUED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type MillingJobStatus = (typeof MILLING_JOB_STATUSES)[number];

/** ------------------------------------------------------------------ */
/* Ordering                                                             */
/** ------------------------------------------------------------------ */

export const ORDER_TYPES = ["ONE_TIME", "CUSTOM_MILLING", "SUBSCRIPTION"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const FULFILMENT_TYPES = ["DELIVERY", "PICKUP"] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];

/**
 * The shared trunk, then two branches on top of it:
 *
 *   PENDING_PAYMENT -> CONFIRMED | PAYMENT_FAILED | CANCELLED
 *   CONFIRMED -> MILLING (milled items) -> PACKED
 *             -> PACKED (grains/nuts only)
 *             -> CANCELLED
 *   PACKED -> OUT_FOR_DELIVERY -> DELIVERED
 *          -> READY_FOR_PICKUP -> PICKED_UP
 *   DELIVERED/PICKED_UP -> (prepaid) COMPLETED
 *                       -> (COD) COD_PENDING -> COD_COLLECTED -> COMPLETED
 *
 * Also, for custom milling, intake states sit between CONFIRMED and MILLING:
 *   AWAITING_GRAIN_DROP -> GRAIN_RECEIVED
 */
export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAYMENT_FAILED",
  "CONFIRMED",
  "AWAITING_GRAIN_DROP",
  "GRAIN_RECEIVED",
  "MILLING",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "COD_PENDING",
  "COD_COLLECTED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses from which nothing further can happen. */
export const TERMINAL_ORDER_STATUSES = ["COMPLETED", "CANCELLED", "REFUNDED"] as const;

/** ------------------------------------------------------------------ */
/* Payments                                                             */
/** ------------------------------------------------------------------ */

export const PAYMENT_METHODS = ["COD", "UPI", "CARD", "NETBANKING", "WALLET"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_PROVIDERS = ["RAZORPAY", "MANUAL", "STUB"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** ------------------------------------------------------------------ */
/* Money movement                                                       */
/** ------------------------------------------------------------------ */

/**
 * The ledger is append-only and is the source of truth for earnings.
 * Order rows are mutable; ledger rows never are.
 */
export const LEDGER_ENTRY_TYPES = [
  "SALE",
  "PLATFORM_FEE",
  "COUPON_DISCOUNT_STORE_FUNDED",
  "COUPON_DISCOUNT_PLATFORM_FUNDED",
  "REFUND",
  "COD_COLLECTION",
  "CASH_REMITTANCE",
  "CASH_VARIANCE",
  "ADJUSTMENT",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** Who absorbs a discount. Settlement nets it against that party. */
export const FUNDING_PARTIES = ["STORE", "PLATFORM"] as const;
export type FundingParty = (typeof FUNDING_PARTIES)[number];

/** ------------------------------------------------------------------ */
/* Marketing                                                            */
/** ------------------------------------------------------------------ */

export const BANNER_PLACEMENTS = [
  "HOME_HERO",
  "HOME_STRIP",
  "CATEGORY_TOP",
  "CART_UPSELL",
  "STORE_FINDER",
] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const BANNER_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "PAUSED", "ENDED"] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

export const COUPON_TYPES = ["PERCENT", "FLAT", "FREE_DELIVERY"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** ------------------------------------------------------------------ */
/* Slots                                                                */
/** ------------------------------------------------------------------ */

export const SLOT_TYPES = ["DELIVERY", "PICKUP", "DROPOFF"] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** ------------------------------------------------------------------ */
/* Subscriptions                                                        */
/** ------------------------------------------------------------------ */

export const SUBSCRIPTION_INTERVALS = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  "PENDING_MANDATE",
  "ACTIVE",
  "PAUSED",
  "PAST_DUE",
  "CANCELLED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_RUN_STATUSES = [
  "SCHEDULED",
  "AWAITING_PAYMENT",
  "PAID",
  "QUEUED",
  "FULFILLED",
  "SKIPPED",
  "FAILED",
  "CANCELLED",
] as const;
export type SubscriptionRunStatus = (typeof SUBSCRIPTION_RUN_STATUSES)[number];

/** ------------------------------------------------------------------ */
/* Stock                                                                */
/** ------------------------------------------------------------------ */

export const STOCK_LEDGER_TYPES = [
  "PURCHASE",
  "SALE",
  "RETURN",
  "SPOILAGE",
  "CORRECTION",
  "RESERVATION",
  "RESERVATION_RELEASE",
] as const;
export type StockLedgerType = (typeof STOCK_LEDGER_TYPES)[number];
