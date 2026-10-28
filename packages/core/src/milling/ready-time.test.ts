import { describe, expect, it } from "vitest";
import { estimateReadyAt, describeLeadTime, type OperatingHours } from "./ready-time";

/** Open every day 8:00–20:00 IST. Minutes from midnight, shop-local. */
const ALL_DAY_8_TO_8: OperatingHours = {
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensMinute: 8 * 60,
    closesMinute: 20 * 60,
  })),
};

/** Base clock: 2026-10-28 10:00 IST (04:30 UTC). */
const TEN_AM_IST = new Date("2026-10-28T04:30:00Z");

function baseInput(overrides: Partial<Parameters<typeof estimateReadyAt>[0]> = {}) {
  return {
    now: TEN_AM_IST,
    throughputGramsPerHour: 60_000, // 60 kg/h = 1 kg/min
    bufferMinutes: 5,
    hours: ALL_DAY_8_TO_8,
    queue: { backlogGrams: 0, inProgressJobs: 0 },
    jobInputGrams: 10_000, // 10 kg
    ...overrides,
  };
}

function istMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}

describe("estimateReadyAt", () => {
  it("with an empty queue, is just work + buffer", () => {
    const result = estimateReadyAt(baseInput());
    // 10 kg at 1 kg/min = 10 min, + 5 buffer = 15
    expect(result.estimatedWorkMinutes).toBe(15);
    expect(istMinutes(result.readyAt)).toBe(10 * 60 + 15);
    expect(result.rolledToNextDay).toBe(false);
  });

  it("charges queued backlog on top of this job", () => {
    const result = estimateReadyAt(
      baseInput({ queue: { backlogGrams: 30_000, inProgressJobs: 1 } }),
    );
    // 30 backlog + 10 job = 40 + 5 buffer = 45
    expect(result.estimatedWorkMinutes).toBe(45);
    expect(istMinutes(result.readyAt)).toBe(10 * 60 + 45);
  });

  it("gives an in-presence 10 kg order a later time than a 2 kg mill-ahead order", () => {
    const inPresence = estimateReadyAt(
      baseInput({
        jobInputGrams: 10_000,
        queue: { backlogGrams: 20_000, inProgressJobs: 2 },
      }),
    );
    const smallAhead = estimateReadyAt(
      baseInput({
        jobInputGrams: 2_000,
        queue: { backlogGrams: 0, inProgressJobs: 0 },
      }),
    );
    expect(inPresence.readyAt.getTime()).toBeGreaterThan(smallAhead.readyAt.getTime());
  });

  it("is ready immediately when there is nothing to mill", () => {
    const result = estimateReadyAt(baseInput({ jobInputGrams: 0 }));
    expect(result.estimatedWorkMinutes).toBe(0);
    expect(result.readyAt.getTime()).toBe(TEN_AM_IST.getTime());
  });

  it("rolls to the next opening when the estimate lands after closing", () => {
    // 19:50 IST, 10 kg job -> 15 min -> 20:05, past the 20:00 close.
    const lateEvening = new Date("2026-10-28T14:20:00Z");
    const result = estimateReadyAt(baseInput({ now: lateEvening }));

    expect(result.rolledToNextDay).toBe(true);
    // Next day opens 08:00.
    expect(istMinutes(result.readyAt)).toBe(8 * 60);
    expect(result.readyAt.getTime()).toBeGreaterThan(lateEvening.getTime());
  });

  it("opens at the shop's opening time when asked before opening hours", () => {
    // 06:00 IST
    const earlyMorning = new Date("2026-10-28T00:30:00Z");
    const result = estimateReadyAt(baseInput({ now: earlyMorning }));
    expect(istMinutes(result.readyAt)).toBe(8 * 60);
  });

  it("skips a closed day", () => {
    const closedWednesday: OperatingHours = {
      days: ALL_DAY_8_TO_8.days.map((d) => (d.dayOfWeek === 3 ? { ...d, closed: true } : d)),
    };
    const result = estimateReadyAt(baseInput({ hours: closedWednesday }));
    // 2026-10-28 is a Wednesday -> rolls to Thursday 08:00.
    expect(result.rolledToNextDay).toBe(true);
    expect(istMinutes(result.readyAt)).toBe(8 * 60);
  });

  it("still accepts an order an hour before closing", () => {
    // 19:00 IST with a 30-minute lead: 19:00 is before 19:30, so the job is
    // accepted and completes the same evening.
    const sevenPm = new Date("2026-10-28T13:30:00Z");
    const result = estimateReadyAt(baseInput({ now: sevenPm, lastOrderLeadMinutes: 30 }));
    expect(result.rolledToNextDay).toBe(false);
    expect(istMinutes(result.readyAt)).toBe(19 * 60 + 15);
  });

  it("refuses a new job inside the last-order lead window", () => {
    // 19:45 IST, shop stops taking jobs at 19:30 for a 20:00 close.
    const quarterToEight = new Date("2026-10-28T14:15:00Z");
    const result = estimateReadyAt(
      baseInput({ now: quarterToEight, lastOrderLeadMinutes: 30 }),
    );
    expect(result.rolledToNextDay).toBe(true);
    expect(istMinutes(result.readyAt)).toBe(8 * 60);
  });

  it("rejects a non-positive throughput", () => {
    expect(() => estimateReadyAt(baseInput({ throughputGramsPerHour: 0 }))).toThrow(RangeError);
  });

  it("rejects negative input weight", () => {
    expect(() => estimateReadyAt(baseInput({ jobInputGrams: -1 }))).toThrow(RangeError);
  });
});

describe("describeLeadTime", () => {
  it("buckets minutes into customer-facing labels", () => {
    expect(describeLeadTime(5)).toBe("READY_NOW");
    expect(describeLeadTime(25)).toBe("UNDER_30");
    expect(describeLeadTime(45)).toBe("UNDER_60");
    expect(describeLeadTime(90)).toBe("UNDER_120");
    expect(describeLeadTime(300)).toBe("TODAY");
    expect(describeLeadTime(600)).toBe("NEXT_DAY");
  });
});
