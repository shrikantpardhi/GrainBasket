/**
 * Subscription run state machine.
 *
 * The run owns money and fulfilment; the subscription owns the schedule. That
 * split is what makes the scheduler idempotent: a run is unique on
 * (subscriptionId, scheduledFor), so a re-fired cron tick finds the existing
 * run instead of creating a second order.
 */

import type { SubscriptionRunStatus } from "@grain-basket/contracts";

const EDGES: Record<SubscriptionRunStatus, readonly SubscriptionRunStatus[]> = {
  SCHEDULED: ["AWAITING_PAYMENT", "SKIPPED", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["QUEUED"],
  QUEUED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  SKIPPED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionRun(from: SubscriptionRunStatus, to: SubscriptionRunStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export function nextRunStatuses(from: SubscriptionRunStatus): readonly SubscriptionRunStatus[] {
  return EDGES[from] ?? [];
}

export const RETRYABLE_RUN_STATUSES: readonly SubscriptionRunStatus[] = ["FAILED", "AWAITING_PAYMENT"];

/**
 * Retry policy: +1, +2, +3 days, then give up and mark the subscription
 * PAST_DUE. Expressed as data so the cron sweep stays a dumb loop.
 */
export const RETRY_OFFSETS_DAYS = [1, 2, 3] as const;

export function nextRetryDate(scheduledFor: Date, attempt: number): Date | null {
  const offset = RETRY_OFFSETS_DAYS[attempt];
  if (offset === undefined) return null;
  const next = new Date(scheduledFor);
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}
