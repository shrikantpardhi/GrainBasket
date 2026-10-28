/**
 * Order state machine. Pure: the server and the UI call the same functions,
 * so the  buttons an admin sees are exactly the transitions the server will
 * accept. Every write uses compare-and-set (`where { id, status: from }`,
 * require count === 1) so two staff clicking at once can't double-advance.
 */

import type { FulfilmentType, OrderStatus, PaymentMethod } from "@grain-basket/contracts";

export type OrderEvent =
  | { type: "PAYMENT_CAPTURED" }
  | { type: "PAYMENT_FAILED" }
  | { type: "CANCEL"; reason?: string }
  | { type: "GRAIN_RECEIVED"; intakeWeightGrams: number; varianceApproved: boolean }
  | { type: "START_MILLING" }
  | { type: "MILLING_COMPLETE" }
  | { type: "PACK" }
  | { type: "DISPATCH" }
  | { type: "DELIVER" }
  | { type: "READY_FOR_PICKUP" }
  | { type: "PICKUP_VERIFIED" }
  | { type: "COLLECT_CASH"; amountPaise: number; collectedById: string }
  | { type: "COMPLETE" }
  | { type: "REFUND" };

export interface OrderTransitionContext {
  fulfilment: FulfilmentType;
  paymentMethod: PaymentMethod;
  /** Number of linked milling jobs still not COMPLETED. */
  incompleteMillingJobs: number;
  /** Whether every item in the order requires milling. */
  hasMillingItems: boolean;
  /** true once an online payment is CAPTURED. */
  isPrepaid: boolean;
  /** COD amount outstanding, if any. */
  codOutstandingPaise: number;
}

export type TransitionResult =
  | { ok: true; next: OrderStatus }
  | { ok: false; code: TransitionErrorCode; message: string };

export type TransitionErrorCode =
  | "INVALID_TRANSITION"
  | "MILLING_INCOMPLETE"
  | "SLOT_REQUIRED"
  | "PICKUP_CODE_REQUIRED"
  | "CASH_COLLECTION_NOT_ALLOWED"
  | "PAYMENT_REQUIRED"
  | "INTAKE_VARIANCE_UNAPPROVED"
  | "ALREADY_TERMINAL";

export const TERMINAL: readonly OrderStatus[] = ["COMPLETED", "CANCELLED", "REFUNDED"];

/** The allowed (from -> to) edges, independent of context. Contextual guards
 *  are applied on top in `transitionOrder`. */
const EDGES: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "CANCELLED"],
  CONFIRMED: ["AWAITING_GRAIN_DROP", "MILLING", "PACKED", "CANCELLED"],
  AWAITING_GRAIN_DROP: ["GRAIN_RECEIVED", "CANCELLED"],
  GRAIN_RECEIVED: ["MILLING", "CANCELLED"],
  MILLING: ["PACKED", "CANCELLED"],
  PACKED: ["OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["COMPLETED", "COD_PENDING"],
  READY_FOR_PICKUP: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["COMPLETED", "COD_PENDING"],
  COD_PENDING: ["COD_COLLECTED"],
  COD_COLLECTED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

/** Statuses reachable from `from`, ignoring contextual guards. Drives the UI. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return EDGES[from] ?? [];
}

export function transitionOrder(
  from: OrderStatus,
  event: OrderEvent,
  ctx: OrderTransitionContext,
): TransitionResult {
  if (TERMINAL.includes(from) && event.type !== "REFUND") {
    return fail("ALREADY_TERMINAL", `Order is already ${from}`);
  }

  switch (event.type) {
    case "PAYMENT_CAPTURED":
      return step(from, "CONFIRMED");

    case "PAYMENT_FAILED":
      return step(from, "PAYMENT_FAILED");

    case "CANCEL":
      // A delivered order is not cancellable; it is refundable.
      if (from === "DELIVERED" || from === "PICKED_UP" || from === "COMPLETED") {
        return fail("INVALID_TRANSITION", "Delivered orders must be refunded, not cancelled");
      }
      return step(from, "CANCELLED");

    case "GRAIN_RECEIVED":
      if (from !== "AWAITING_GRAIN_DROP") {
        return fail("INVALID_TRANSITION", "Grain can only be received while awaiting drop-off");
      }
      if (!event.varianceApproved) {
        return fail(
          "INTAKE_VARIANCE_UNAPPROVED",
          "Intake weight differs from the order beyond tolerance and needs customer approval",
        );
      }
      return step(from, "GRAIN_RECEIVED");

    case "START_MILLING":
      if (from === "CONFIRMED" || from === "GRAIN_RECEIVED") return step(from, "MILLING");
      return fail("INVALID_TRANSITION", `Cannot start milling from ${from}`);

    case "MILLING_COMPLETE":
      return fail(
        "INVALID_TRANSITION",
        "Completing milling alone does not change order status; pack the order next",
      );

    case "PACK": {
      if (from !== "MILLING" && from !== "CONFIRMED" && from !== "GRAIN_RECEIVED") {
        return fail("INVALID_TRANSITION", `Cannot pack from ${from}`);
      }
      // The rule that stops unmilled flour going out the door.
      if (ctx.hasMillingItems && ctx.incompleteMillingJobs > 0) {
        return fail(
          "MILLING_INCOMPLETE",
          `${ctx.incompleteMillingJobs} milling job(s) are still open`,
        );
      }
      return step(from, "PACKED");
    }

    case "DISPATCH":
      if (ctx.fulfilment !== "DELIVERY") {
        return fail("INVALID_TRANSITION", "This is a pickup order");
      }
      return step(from, "OUT_FOR_DELIVERY");

    case "DELIVER":
      if (ctx.fulfilment !== "DELIVERY") {
        return fail("INVALID_TRANSITION", "This is a pickup order");
      }
      if (!canTransition(from, "DELIVERED")) {
        return fail("INVALID_TRANSITION", `Cannot deliver from ${from}`);
      }
      // Prepaid goes straight to COMPLETED; COD opens a cash obligation.
      return { ok: true, next: ctx.isPrepaid ? "COMPLETED" : "COD_PENDING" };

    case "READY_FOR_PICKUP":
      if (ctx.fulfilment !== "PICKUP") {
        return fail("INVALID_TRANSITION", "This is a delivery order");
      }
      return step(from, "READY_FOR_PICKUP");

    case "PICKUP_VERIFIED":
      if (ctx.fulfilment !== "PICKUP") {
        return fail("INVALID_TRANSITION", "This is a delivery order");
      }
      if (from !== "READY_FOR_PICKUP") {
        return fail("PICKUP_CODE_REQUIRED", "Order is not ready for pickup");
      }
      return { ok: true, next: ctx.isPrepaid ? "COMPLETED" : "COD_PENDING" };

    case "COLLECT_CASH": {
      if (ctx.isPrepaid || ctx.paymentMethod !== "COD") {
        return fail(
          "CASH_COLLECTION_NOT_ALLOWED",
          "Cash can only be collected on an unpaid COD order",
        );
      }
      if (from !== "COD_PENDING") {
        return fail("CASH_COLLECTION_NOT_ALLOWED", `No cash is due on a ${from} order`);
      }
      if (!event.collectedById) {
        return fail("CASH_COLLECTION_NOT_ALLOWED", "A collecting staff member is required");
      }
      if (!Number.isInteger(event.amountPaise) || event.amountPaise < 0) {
        return fail("CASH_COLLECTION_NOT_ALLOWED", "Collected amount must be a paise integer");
      }
      return step(from, "COD_COLLECTED");
    }

    case "COMPLETE":
      if (from === "COD_COLLECTED" || (ctx.isPrepaid && (from === "DELIVERED" || from === "PICKED_UP"))) {
        return step(from, "COMPLETED");
      }
      if (from === "DELIVERED" || from === "PICKED_UP") {
        return fail("PAYMENT_REQUIRED", "Cash is still outstanding on this order");
      }
      return fail("INVALID_TRANSITION", `Cannot complete from ${from}`);

    case "REFUND":
      return step(from, "REFUNDED");
  }
}

function step(from: OrderStatus, to: OrderStatus): TransitionResult {
  if (!canTransition(from, to)) {
    return fail("INVALID_TRANSITION", `Cannot go from ${from} to ${to}`);
  }
  return { ok: true, next: to };
}

function fail(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message };
}

/**
 * Guard used when confirming an order. Kept separate because it runs on the
 * PENDING_PAYMENT -> CONFIRMED edge where both payment rails converge.
 */
export function canConfirmOrder(input: {
  paymentMethod: PaymentMethod;
  isPaymentCaptured: boolean;
  shopAcceptingOrders: boolean;
}): TransitionResult {
  if (!input.shopAcceptingOrders) {
    return fail("INVALID_TRANSITION", "This shop is not accepting orders right now");
  }
  if (input.paymentMethod !== "COD" && !input.isPaymentCaptured) {
    return fail("PAYMENT_REQUIRED", "Online payment has not been captured");
  }
  return { ok: true, next: "CONFIRMED" };
}
