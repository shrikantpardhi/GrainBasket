/**
 * The permission layer. Roles are coarse buckets; these keys are what code
 * actually checks. No procedure anywhere compares a role string directly —
 * it asks `can(role, PERMISSIONS.X)` so the capability matrix in the plan has
 * exactly one implementation.
 */

import type { PlatformRole, StoreRole } from "./enums";
import { AppError, ERROR_CODES } from "./errors";

export const PERMISSIONS = {
  // --- Catalogue -----------------------------------------------------------
  CATALOGUE_BROWSE: "catalogue.browse",
  PRODUCT_EDIT: "product.edit",
  STOCK_ADJUST: "stock.adjust",
  INVENTORY_VIEW: "inventory.view",

  // --- Orders --------------------------------------------------------------
  ORDER_VIEW_ALL: "order.viewAll",
  ORDER_VIEW_OWN: "order.viewOwn",
  ORDER_ADVANCE_STATUS: "order.advanceStatus",
  ORDER_CANCEL_STUCK: "order.cancelStuck",
  PICKUP_VERIFY: "order.pickupVerify",
  ORDER_ADD_NOTE: "order.addNote",

  // --- Milling -------------------------------------------------------------
  MILLING_CLAIM: "milling.claim",
  MILLING_RECORD_WEIGHT: "milling.recordWeight",
  MILLING_CONFIGURE: "milling.configure",

  // --- Money ---------------------------------------------------------------
  /** Handover cash collection. Separated from viewing money on purpose. */
  COD_COLLECT: "money.codCollect",
  EARNINGS_VIEW: "money.earningsView",
  LEDGER_VIEW: "money.ledgerView",
  REFUND_ISSUE: "money.refundIssue",
  SETTLEMENT_CONFIGURE: "money.settlementConfigure",

  // --- Customer data -------------------------------------------------------
  CUSTOMER_PII_VIEW: "customer.piiView",
  CUSTOMER_PII_REVEAL: "customer.piiReveal",
  CUSTOMER_HISTORY_VIEW: "customer.historyView",

  // --- Shop administration -------------------------------------------------
  STORE_CREATE: "store.create",
  STORE_EDIT: "store.edit",
  STORE_STATUS_MANAGE: "store.statusManage",
  STORE_ASSIGN_ADMIN: "store.assignAdmin",
  STORE_SETTINGS_EDIT: "store.settingsEdit",
  STORE_SLOTS_EDIT: "store.slotsEdit",
  STORE_AREAS_EDIT: "store.areasEdit",
  STAFF_INVITE: "staff.invite",
  STAFF_REMOVE: "staff.remove",

  // --- Marketing -----------------------------------------------------------
  BANNER_MANAGE_STORE: "marketing.banner.store",
  BANNER_MANAGE_GLOBAL: "marketing.banner.global",
  COUPON_MANAGE_STORE: "marketing.coupon.store",
  COUPON_MANAGE_GLOBAL: "marketing.coupon.global",
  COUPON_REDEMPTIONS_VIEW: "marketing.coupon.redemptions",

  // --- Subscriptions -------------------------------------------------------
  SUBSCRIPTION_MANAGE: "subscription.manage",
  SUBSCRIPTION_VIEW: "subscription.view",

  // --- Platform ------------------------------------------------------------
  PLATFORM_USER_MANAGE: "platform.userManage",
  AUDIT_VIEW: "audit.view",
  BULK_EXPORT: "data.bulkExport",

  // --- Support registry ----------------------------------------------------
  SUPPORT_RESEND_NOTIFICATION: "support.resendNotification",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What every signed-in customer can do. Scoping to their own rows is enforced
 *  by the tenant extension, not by this map. */
export const CUSTOMER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.CATALOGUE_BROWSE,
  PERMISSIONS.ORDER_VIEW_OWN,
  PERMISSIONS.SUBSCRIPTION_MANAGE,
];

/**
 * Platform support is read-mostly. The two write permissions here are the
 * entire action registry; everything else is denied in code.
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  PLATFORM_ADMIN: Object.values(PERMISSIONS),
  PLATFORM_SUPPORT: [
    PERMISSIONS.CATALOGUE_BROWSE,
    PERMISSIONS.ORDER_VIEW_ALL,
    PERMISSIONS.ORDER_ADD_NOTE,
    PERMISSIONS.ORDER_CANCEL_STUCK,
    PERMISSIONS.SUPPORT_RESEND_NOTIFICATION,
    PERMISSIONS.EARNINGS_VIEW,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.CUSTOMER_HISTORY_VIEW,
    PERMISSIONS.CUSTOMER_PII_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.SUBSCRIPTION_VIEW,
    PERMISSIONS.COUPON_REDEMPTIONS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ],
};

/**
 * The important omissions, stated so they are not re-added by accident:
 *
 *  PLATFORM_SUPPORT does NOT get CUSTOMER_PII_REVEAL implicitly — revealing a
 *  phone number is a separate audited action gated on a reason code, and it is
 *  checked by its own procedure rather than by this role map.
 *
 *  PLATFORM_SUPPORT does NOT get REFUND_ISSUE, BULK_EXPORT, or any store
 *  configuration permission.
 */
export const STORE_ROLE_PERMISSIONS: Record<StoreRole, readonly Permission[]> = {
  STORE_ADMIN: [
    PERMISSIONS.CATALOGUE_BROWSE,
    PERMISSIONS.PRODUCT_EDIT,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.ORDER_VIEW_ALL,
    PERMISSIONS.ORDER_ADVANCE_STATUS,
    PERMISSIONS.PICKUP_VERIFY,
    PERMISSIONS.ORDER_ADD_NOTE,
    PERMISSIONS.ORDER_CANCEL_STUCK,
    PERMISSIONS.MILLING_CLAIM,
    PERMISSIONS.MILLING_RECORD_WEIGHT,
    PERMISSIONS.MILLING_CONFIGURE,
    PERMISSIONS.COD_COLLECT,
    PERMISSIONS.EARNINGS_VIEW,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.REFUND_ISSUE,
    PERMISSIONS.CUSTOMER_PII_VIEW,
    PERMISSIONS.CUSTOMER_HISTORY_VIEW,
    PERMISSIONS.STORE_SETTINGS_EDIT,
    PERMISSIONS.STORE_SLOTS_EDIT,
    PERMISSIONS.STORE_AREAS_EDIT,
    PERMISSIONS.STAFF_INVITE,
    PERMISSIONS.STAFF_REMOVE,
    PERMISSIONS.BANNER_MANAGE_STORE,
    PERMISSIONS.COUPON_MANAGE_STORE,
    PERMISSIONS.COUPON_REDEMPTIONS_VIEW,
    PERMISSIONS.SUBSCRIPTION_MANAGE,
    PERMISSIONS.SUBSCRIPTION_VIEW,
    PERMISSIONS.BULK_EXPORT,
    PERMISSIONS.SUPPORT_RESEND_NOTIFICATION,
  ],
  /**
   * Store staff run the counter. Critically they CAN collect cash at handover
   * but CANNOT view earnings — collecting money and seeing the books are
   * different capabilities.
   */
  STORE_STAFF: [
    PERMISSIONS.CATALOGUE_BROWSE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.ORDER_VIEW_ALL,
    PERMISSIONS.ORDER_ADVANCE_STATUS,
    PERMISSIONS.PICKUP_VERIFY,
    PERMISSIONS.ORDER_ADD_NOTE,
    PERMISSIONS.MILLING_CLAIM,
    PERMISSIONS.MILLING_RECORD_WEIGHT,
    PERMISSIONS.COD_COLLECT,
    PERMISSIONS.CUSTOMER_PII_VIEW,
    PERMISSIONS.SUPPORT_RESEND_NOTIFICATION,
  ],
  /** Milling only, plus cash at handover. No earnings, no pricing, no refunds. */
  MILL_OPERATOR: [
    PERMISSIONS.CATALOGUE_BROWSE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.MILLING_CLAIM,
    PERMISSIONS.MILLING_RECORD_WEIGHT,
    PERMISSIONS.COD_COLLECT,
  ],
};

export function can(
  permissions: readonly Permission[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}

export function assertCan(
  permissions: readonly Permission[],
  required: Permission,
): void {
  if (!can(permissions, required)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, `Missing permission: ${required}`);
  }
}
