import { addDays, dayOfWeek, isWeekend } from "./date-utils";

/**
 * How wide a day is drawn on the Gantt timeline, and what the header shows at
 * that width.
 *
 * Three scales are fixed widths. The window scales (`2m` … `18m`) instead fit
 * that many months into the room beside the task column, so a plan that runs
 * for years can be read a half-year or a year at a time. `fit` fits the whole
 * plan. Both follow the window as it is resized.
 */
export const FIXED_GANTT_SCALES = ["days", "weeks", "months"] as const;
export const WINDOW_GANTT_SCALES = [
  "2m",
  "3m",
  "4m",
  "6m",
  "12m",
  "18m",
] as const;

export type FixedGanttScaleId = (typeof FIXED_GANTT_SCALES)[number];
export type WindowGanttScaleId = (typeof WINDOW_GANTT_SCALES)[number];
export type GanttScaleId = FixedGanttScaleId | WindowGanttScaleId | "fit";

/** Pixels per day for each fixed scale, finest first. */
export const GANTT_DAY_WIDTHS: Record<FixedGanttScaleId, number> = {
  days: 32,
  weeks: 12,
  months: 5,
};

export const DEFAULT_GANTT_SCALE: GanttScaleId = "days";

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Bounds on a fitted width. A one-week plan stretched across a wide window is
 * no easier to read past day resolution, and below the floor a decade-long
 * plan would be bars a pixel wide.
 */
export const MIN_FIT_DAY_WIDTH = 0.15;
export const MAX_FIT_DAY_WIDTH = GANTT_DAY_WIDTHS.days;

/**
 * Room kept free when fitting, so a vertical scrollbar appearing beside the
 * rows does not push the last day out of view and bring back a horizontal one.
 */
const FIT_GUTTER_PX = 16;

export function isWindowGanttScale(
  value: unknown
): value is WindowGanttScaleId {
  return (WINDOW_GANTT_SCALES as readonly unknown[]).includes(value);
}

export function isGanttScaleId(value: unknown): value is GanttScaleId {
  return (
    value === "fit" ||
    isWindowGanttScale(value) ||
    (FIXED_GANTT_SCALES as readonly unknown[]).includes(value)
  );
}

/** Months a window scale shows, e.g. 6 for `6m`. */
export function windowMonths(scale: WindowGanttScaleId): number {
  return Number(scale.slice(0, -1));
}

/** The width a day needs for `totalDays` to fill `availablePx` exactly. */
export function fitDayWidth(availablePx: number, totalDays: number): number {
  const room = availablePx - FIT_GUTTER_PX;
  if (room <= 0 || totalDays <= 0) return GANTT_DAY_WIDTHS.months;
  return Math.min(
    MAX_FIT_DAY_WIDTH,
    Math.max(MIN_FIT_DAY_WIDTH, room / totalDays)
  );
}

/**
 * Pixels per day for a scale. `availablePx` is the timeline's visible width
 * and `totalDays` the plan's span; only the window scales and `fit` use them.
 */
export function resolveDayWidth(
  scale: GanttScaleId,
  fit: { availablePx: number; totalDays: number }
): number {
  if (scale === "fit") return fitDayWidth(fit.availablePx, fit.totalDays);
  if (isWindowGanttScale(scale)) {
    return fitDayWidth(fit.availablePx, windowMonths(scale) * DAYS_PER_MONTH);
  }
  return GANTT_DAY_WIDTHS[scale];
}

export type TimeUnit = "day" | "week" | "month" | "quarter" | "year";

export interface HeaderLayout {
  /** The upper lane: one labelled band per period */
  band: Exclude<TimeUnit, "day" | "week">;
  /** The lower lane: one column per period */
  tick: Exclude<TimeUnit, "year">;
  /** Weekends are only worth shading while a day is wide enough to see */
  shadeWeekends: boolean;
}

/**
 * The header lanes for a day width. Picked by width rather than by scale so a
 * fitted chart gets whichever header suits the width it landed on.
 */
export function headerLayout(dayWidth: number): HeaderLayout {
  if (dayWidth >= 20) {
    return { band: "month", tick: "day", shadeWeekends: true };
  }
  if (dayWidth >= 3) {
    return { band: "month", tick: "week", shadeWeekends: false };
  }
  if (dayWidth >= 1.2) {
    return { band: "quarter", tick: "month", shadeWeekends: false };
  }
  return { band: "year", tick: "quarter", shadeWeekends: false };
}

/** The first day of the period `iso` falls in. */
export function periodStart(iso: string, unit: TimeUnit): string {
  switch (unit) {
    case "day":
      return iso;
    case "week":
      // Weeks run Monday to Sunday
      return addDays(iso, -((dayOfWeek(iso) + 6) % 7));
    case "month":
      return `${iso.slice(0, 7)}-01`;
    case "quarter": {
      const month = Number(iso.slice(5, 7));
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return `${iso.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
    }
    case "year":
      return `${iso.slice(0, 4)}-01-01`;
  }
}

/** One period on the timeline, cut to the part of it the timeline shows. */
export interface TimeSpan {
  /** First day of the span on the timeline, not of the whole period */
  iso: string;
  /** Days from the timeline's start */
  offset: number;
  days: number;
}

/** Splits the timeline into consecutive spans of one unit each. */
export function buildSpans(
  timelineStart: string,
  totalDays: number,
  unit: TimeUnit
): TimeSpan[] {
  const spans: TimeSpan[] = [];
  let current = "";

  for (let offset = 0; offset < totalDays; offset++) {
    const iso = addDays(timelineStart, offset);
    const period = periodStart(iso, unit);
    if (period !== current) {
      current = period;
      spans.push({ iso, offset, days: 0 });
    }
    spans[spans.length - 1].days += 1;
  }

  return spans;
}

/** Narrower than this, a column's label would spill into its neighbours. */
const MIN_LABEL_PX: Record<HeaderLayout["tick"], number> = {
  day: 16,
  week: 50,
  month: 22,
  quarter: 20,
};

export interface HeaderTick extends TimeSpan {
  /** Opens a new band, so it gets the stronger divider */
  major: boolean;
  weekend: boolean;
  labelled: boolean;
}

export function buildHeaderTicks(
  timelineStart: string,
  totalDays: number,
  dayWidth: number
): HeaderTick[] {
  const layout = headerLayout(dayWidth);

  return buildSpans(timelineStart, totalDays, layout.tick).map((span) => ({
    ...span,
    major: periodStart(span.iso, layout.band) === span.iso,
    weekend: layout.tick === "day" && isWeekend(span.iso),
    labelled: span.days * dayWidth >= MIN_LABEL_PX[layout.tick],
  }));
}

/** The quarter, 1 to 4, that `iso` falls in. */
export function quarterOf(iso: string): number {
  return Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
}
