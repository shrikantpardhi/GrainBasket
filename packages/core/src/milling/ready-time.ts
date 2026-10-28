/**
 * Ready-time estimation.
 *
 * This is the single function behind the "Ready by ~2:30 PM" promise shown on
 * the product page, at checkout, and on the confirmation screen. Three callers
 * computing three different times is the fastest way to lose a customer's
 * trust, so they all come through here.
 *
 *     readyAt = now
 *             + backlogMinutes      (QUEUED + IN_PROGRESS work ahead)
 *             + thisJobMinutes      (input grams / mill throughput)
 *             + bufferMinutes       (the shop's own safety margin)
 *
 * Then resolved against operating hours. If the estimate lands after closing
 * it rolls to the next opening time — an order promised for 9 PM when the shop
 * shuts at 8 PM is a broken promise, and worse, an angry customer at the gate.
 */

import { BUSINESS_TIMEZONE } from "@grain-basket/contracts";

export interface OperatingHours {
  /** 0 = Sunday ... 6 = Saturday. Minutes from midnight, shop-local. */
  days: readonly {
    dayOfWeek: number;
    opensMinute: number;
    closesMinute: number;
    closed?: boolean;
  }[];
}

export interface QueueSnapshot {
  /** Jobs already queued or in progress at this shop. */
  backlogGrams: number;
  /** How many in-progress jobs are running right now (they overlap). */
  inProgressJobs: number;
}

export interface ReadyTimeInput {
  now: Date;
  /** The shop's mill throughput in grams per hour. */
  throughputGramsPerHour: number;
  /** Minutes added on top of computed work — the shop's safety margin. */
  bufferMinutes: number;
  hours: OperatingHours;
  queue: QueueSnapshot;
  /** Input weight for this new job. Zero for an order with nothing to mill. */
  jobInputGrams: number;
  /** Minutes before closing during which no new job is accepted. */
  lastOrderLeadMinutes?: number;
  timeZone?: string;
}

export interface ReadyTimeResult {
  readyAt: Date;
  /** The raw pre-hours arithmetic, useful for showing "about an hour". */
  estimatedWorkMinutes: number;
  /** true when the promise had to roll into the next working day. */
  rolledToNextDay: boolean;
}

const MS_PER_MINUTE = 60_000;

export function estimateReadyAt(input: ReadyTimeInput): ReadyTimeResult {
  const {
    now,
    throughputGramsPerHour,
    bufferMinutes,
    hours,
    queue,
    jobInputGrams,
    lastOrderLeadMinutes = 0,
  } = input;

  if (throughputGramsPerHour <= 0) {
    throw new RangeError("throughputGramsPerHour must be positive");
  }
  if (jobInputGrams < 0) {
    throw new RangeError("jobInputGrams cannot be negative");
  }

  // Nothing to mill — ready immediately, bounded by opening hours.
  if (jobInputGrams === 0) {
    const open = resolveOpenMinute(now, hours);
    return {
      readyAt: new Date(open.getTime()),
      estimatedWorkMinutes: 0,
      rolledToNextDay: !isSameBusinessDay(now, open),
    };
  }

  // `lastOrderLeadMinutes` is about accepting the job, not about the promise:
  // the shop stops taking new work N minutes before closing so the mill isn't
  // started on a job it cannot finish. Checked against `now`, before any of
  // the work arithmetic below.
  const closingSoon = isWithinLeadOfClosing(now, hours, lastOrderLeadMinutes);
  if (closingSoon) {
    return {
      readyAt: nextOpening(now, hours),
      estimatedWorkMinutes: 0,
      rolledToNextDay: true,
    };
  }

  const gramsPerMinute = throughputGramsPerHour / 60;

  // Backlog is the queued work only. Jobs already in progress consume time
  // concurrently, so charging the full backlog plus every in-progress job
  // would double-count. We take the queued grams as serial work ahead.
  const backlogMinutes = queue.backlogGrams / gramsPerMinute;
  const thisJobMinutes = jobInputGrams / gramsPerMinute;
  const estimatedWorkMinutes = Math.ceil(backlogMinutes + thisJobMinutes + bufferMinutes);

  const naiveReadyAt = new Date(now.getTime() + estimatedWorkMinutes * MS_PER_MINUTE);
  const resolved = resolveOpenMinute(naiveReadyAt, hours);

  return {
    readyAt: resolved,
    estimatedWorkMinutes,
    rolledToNextDay: !isSameBusinessDay(naiveReadyAt, resolved),
  };
}

/** Human-friendly bucket used for the product page before an exact time exists. */
export function describeLeadTime(minutes: number): "READY_NOW" | "UNDER_30" | "UNDER_60" | "UNDER_120" | "TODAY" | "NEXT_DAY" {
  if (minutes <= 10) return "READY_NOW";
  if (minutes <= 30) return "UNDER_30";
  if (minutes <= 60) return "UNDER_60";
  if (minutes <= 120) return "UNDER_120";
  if (minutes <= 8 * 60) return "TODAY";
  return "NEXT_DAY";
}

/** ------------------------------------------------------------------ */
/* Opening-hours resolution                                             */
/** ------------------------------------------------------------------ */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const hour = Number(get("hour")) % 24;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    dayOfWeek: weekdayMap[get("weekday")] ?? 0,
  };
}

/**
 * Move `at` forward until it falls inside an open window, leaving at least
 * `leadMinutes` before closing. Rolls to the next opening day when needed.
 * Bounded to 14 days so a misconfigured `OperatingHours` fails loudly instead
 * of hanging the request.
 */
export function resolveOpenMinute(
  at: Date,
  hours: OperatingHours,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  let candidate = new Date(at);

  for (let guard = 0; guard < 14; guard++) {
    const p = zonedParts(candidate, timeZone);
    const today = hours.days.find((d) => d.dayOfWeek === p.dayOfWeek);
    const minuteOfDay = p.hour * 60 + p.minute;

    if (today && !today.closed) {
      if (minuteOfDay < today.opensMinute) {
        // Before opening: the promise is the opening time.
        return setZonedMinute(candidate, p, today.opensMinute, timeZone);
      }
      if (minuteOfDay <= today.closesMinute) {
        return candidate;
      }
    }

    // Closed, or past closing — try the next day's opening.
    const nextDay = addDaysZoned(candidate, 1, timeZone);
    const np = zonedParts(nextDay, timeZone);
    const nextDayHours = hours.days.find((d) => d.dayOfWeek === np.dayOfWeek);
    if (nextDayHours && !nextDayHours.closed) {
      return setZonedMinute(nextDay, np, nextDayHours.opensMinute, timeZone);
    }
    candidate = nextDay;
  }

  // No open window found within two weeks: return the original instant rather
  // than an arbitrary one, and let the caller decide (usually: shop is closed,
  // don't show a promise).
  return new Date(at);
}

function addDaysZoned(date: Date, days: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  // Target the start of the following day, not midday: callers pass this into
  // opening-hours resolution, and a midday instant is already "open".
  const asUtc = Date.UTC(p.year, p.month - 1, p.day + days, 0, 0, 0);
  const offsetMs = zoneOffsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offsetMs);
}

/**
 * The first opening minute strictly later than `after`. Used when today's work
 * window has already closed for new jobs.
 */
function nextOpening(
  after: Date,
  hours: OperatingHours,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  let cursor = new Date(after);
  for (let guard = 0; guard < 14; guard++) {
    const p = zonedParts(cursor, timeZone);
    const day = hours.days.find((d) => d.dayOfWeek === p.dayOfWeek);
    if (day && !day.closed) {
      const minuteOfDay = p.hour * 60 + p.minute;
      if (minuteOfDay < day.opensMinute) {
        return setZonedMinute(cursor, p, day.opensMinute, timeZone);
      }
    }
    cursor = addDaysZoned(cursor, 1, timeZone);
  }
  return new Date(after);
}

function setZonedMinute(date: Date, p: ZonedParts, minuteOfDay: number, timeZone: string): Date {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const minute = minuteOfDay % 60;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  const offsetMs = zoneOffsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offsetMs);
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - date.getTime();
}

/**
 * True when the shop is open but within `leadMinutes` of closing, so a new
 * job should not be accepted today.
 */
function isWithinLeadOfClosing(
  now: Date,
  hours: OperatingHours,
  leadMinutes: number,
  timeZone: string = BUSINESS_TIMEZONE,
): boolean {
  if (leadMinutes <= 0) return false;
  const p = zonedParts(now, timeZone);
  const today = hours.days.find((d) => d.dayOfWeek === p.dayOfWeek);
  if (!today || today.closed) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= today.closesMinute - leadMinutes && minuteOfDay < today.closesMinute;
}

function isSameBusinessDay(a: Date, b: Date, timeZone: string = BUSINESS_TIMEZONE): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}
