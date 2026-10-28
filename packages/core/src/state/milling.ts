/**
 * Milling job state machine. A job is complete only when the output weight is
 * recorded — that number drives yield, refunds on shortfall, and the
 * "milled on" freshness badge.
 */

import type { MillingJobStatus } from "@grain-basket/contracts";

export type MillingEvent =
  | { type: "ASSIGN"; operatorId: string }
  | { type: "START" }
  | { type: "COMPLETE"; outputGrams: number }
  | { type: "CANCEL"; reason: string };

export type MillingTransition =
  | { ok: true; next: MillingJobStatus }
  | { ok: false; message: string };

const EDGES: Record<MillingJobStatus, readonly MillingJobStatus[]> = {
  QUEUED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "QUEUED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionMilling(from: MillingJobStatus, to: MillingJobStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export function nextMillingStatuses(from: MillingJobStatus): readonly MillingJobStatus[] {
  return EDGES[from] ?? [];
}

export function transitionMilling(
  from: MillingJobStatus,
  event: MillingEvent,
): MillingTransition {
  switch (event.type) {
    case "ASSIGN":
      if (from !== "QUEUED" && from !== "ASSIGNED") {
        return fail(`Cannot assign a job that is ${from}`);
      }
      if (!event.operatorId) return fail("An operator is required");
      return { ok: true, next: "ASSIGNED" };

    case "START":
      if (from !== "ASSIGNED") return fail("Assign the job to an operator before starting");
      return { ok: true, next: "IN_PROGRESS" };

    case "COMPLETE":
      if (from !== "IN_PROGRESS") return fail(`Cannot complete a job that is ${from}`);
      if (!Number.isInteger(event.outputGrams) || event.outputGrams <= 0) {
        return fail("Completion requires a positive output weight in grams");
      }
      return { ok: true, next: "COMPLETED" };

    case "CANCEL":
      if (!event.reason.trim()) return fail("A cancellation reason is required");
      if (from === "COMPLETED") return fail("A completed job cannot be cancelled");
      return { ok: true, next: "CANCELLED" };
  }
}

function fail(message: string): MillingTransition {
  return { ok: false, message };
}
