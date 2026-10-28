import { describe, expect, it } from "vitest";
import {
  transitionOrder,
  canTransition,
  type OrderTransitionContext,
} from "./order";

function ctx(overrides: Partial<OrderTransitionContext> = {}): OrderTransitionContext {
  return {
    fulfilment: "DELIVERY",
    paymentMethod: "COD",
    incompleteMillingJobs: 0,
    hasMillingItems: false,
    isPrepaid: false,
    codOutstandingPaise: 0,
    ...overrides,
  };
}

describe("order state machine — the trunk", () => {
  it("confirms an unpaid COD order on creation", () => {
    expect(transitionOrder("PENDING_PAYMENT", { type: "PAYMENT_CAPTURED" }, ctx())).toEqual({
      ok: true,
      next: "CONFIRMED",
    });
  });

  it("packs a grain-only order directly from CONFIRMED", () => {
    expect(
      transitionOrder("CONFIRMED", { type: "PACK" }, ctx({ hasMillingItems: false })),
    ).toEqual({ ok: true, next: "PACKED" });
  });

  it("refuses to pack while milling jobs are open", () => {
    const result = transitionOrder(
      "MILLING",
      { type: "PACK" },
      ctx({ hasMillingItems: true, incompleteMillingJobs: 2 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MILLING_INCOMPLETE");
  });

  it("packs once every milling job is complete", () => {
    expect(
      transitionOrder(
        "MILLING",
        { type: "PACK" },
        ctx({ hasMillingItems: true, incompleteMillingJobs: 0 }),
      ),
    ).toEqual({ ok: true, next: "PACKED" });
  });
});

describe("order state machine — fulfilment branches", () => {
  it("dispatches a delivery order and completes a prepaid one on delivery", () => {
    expect(transitionOrder("PACKED", { type: "DISPATCH" }, ctx())).toEqual({
      ok: true,
      next: "OUT_FOR_DELIVERY",
    });
    expect(
      transitionOrder("OUT_FOR_DELIVERY", { type: "DELIVER" }, ctx({ isPrepaid: true })),
    ).toEqual({ ok: true, next: "COMPLETED" });
  });

  it("opens a cash obligation for a COD delivery", () => {
    expect(transitionOrder("OUT_FOR_DELIVERY", { type: "DELIVER" }, ctx())).toEqual({
      ok: true,
      next: "COD_PENDING",
    });
  });

  it("refuses to dispatch a pickup order", () => {
    const result = transitionOrder("PACKED", { type: "DISPATCH" }, ctx({ fulfilment: "PICKUP" }));
    expect(result.ok).toBe(false);
  });

  it("runs the pickup branch for a pickup order", () => {
    expect(
      transitionOrder("PACKED", { type: "READY_FOR_PICKUP" }, ctx({ fulfilment: "PICKUP" })),
    ).toEqual({ ok: true, next: "READY_FOR_PICKUP" });
    expect(
      transitionOrder(
        "READY_FOR_PICKUP",
        { type: "PICKUP_VERIFIED" },
        ctx({ fulfilment: "PICKUP", isPrepaid: true }),
      ),
    ).toEqual({ ok: true, next: "COMPLETED" });
  });
});

describe("order state machine — cash collection", () => {
  it("collects cash on a COD order with the collecting staff member recorded", () => {
    expect(
      transitionOrder(
        "COD_PENDING",
        { type: "COLLECT_CASH", amountPaise: 30_000, collectedById: "staff-1" },
        ctx(),
      ),
    ).toEqual({ ok: true, next: "COD_COLLECTED" });
  });

  it("forbids collecting cash on a prepaid order", () => {
    const result = transitionOrder(
      "COD_PENDING",
      { type: "COLLECT_CASH", amountPaise: 30_000, collectedById: "staff-1" },
      ctx({ isPrepaid: true, paymentMethod: "UPI" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CASH_COLLECTION_NOT_ALLOWED");
  });

  it("forbids collecting cash before the order is handed over", () => {
    const result = transitionOrder(
      "PACKED",
      { type: "COLLECT_CASH", amountPaise: 30_000, collectedById: "staff-1" },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it("requires a collecting user", () => {
    const result = transitionOrder(
      "COD_PENDING",
      { type: "COLLECT_CASH", amountPaise: 30_000, collectedById: "" },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it("completes only after cash is collected on a COD order", () => {
    const blocked = transitionOrder("DELIVERED", { type: "COMPLETE" }, ctx());
    expect(blocked.ok).toBe(false);

    expect(transitionOrder("COD_COLLECTED", { type: "COMPLETE" }, ctx())).toEqual({
      ok: true,
      next: "COMPLETED",
    });
  });
});

describe("order state machine — termination", () => {
  it("refuses any transition out of a terminal state", () => {
    for (const terminal of ["COMPLETED", "CANCELLED", "REFUNDED"] as const) {
      const result = transitionOrder(terminal, { type: "PACK" }, ctx());
      expect(result.ok).toBe(false);
    }
  });

  it("cancels an unfulfilled order but not a delivered one", () => {
    expect(transitionOrder("PACKED", { type: "CANCEL" }, ctx())).toEqual({
      ok: true,
      next: "CANCELLED",
    });
    expect(transitionOrder("DELIVERED", { type: "CANCEL" }, ctx()).ok).toBe(false);
  });

  it("does not allow skipping from CONFIRMED straight to DELIVERED", () => {
    expect(canTransition("CONFIRMED", "DELIVERED")).toBe(false);
  });
});

describe("order state machine — custom milling intake", () => {
  it("blocks grain receipt until weight variance is approved", () => {
    const result = transitionOrder(
      "AWAITING_GRAIN_DROP",
      { type: "GRAIN_RECEIVED", intakeWeightGrams: 5000, varianceApproved: false },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INTAKE_VARIANCE_UNAPPROVED");
  });

  it("accepts grain once the variance is approved", () => {
    expect(
      transitionOrder(
        "AWAITING_GRAIN_DROP",
        { type: "GRAIN_RECEIVED", intakeWeightGrams: 5000, varianceApproved: true },
        ctx(),
      ),
    ).toEqual({ ok: true, next: "GRAIN_RECEIVED" });
  });
});
