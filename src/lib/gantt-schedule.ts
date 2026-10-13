import {
  addDays,
  addWorkingDays,
  diffDays,
  inclusiveDayCount,
  isWeekend,
  nextWorkingDay,
  toEpochDay,
  todayIso,
  workingDayCount,
} from "./date-utils";

/**
 * Turning tasks into timeline bars.
 *
 * Most tasks in a real vault have no dates at all, so a Gantt that only drew
 * dated tasks would be nearly empty. Every task therefore gets a bar: explicit
 * dates are used as-is, and anything missing is inferred from the task's
 * position in the dependency graph — a task starts the day after the last of
 * its blockers finishes, and lasts one day by default.
 *
 * Inference never touches the vault. A bar keeps `startInferred` /
 * `endInferred` flags so the view can render it as a proposal until the user
 * drags it or applies the inferred dates explicitly.
 */

export const DEFAULT_DURATION_DAYS = 1;

export interface GanttTaskInput {
  id: string;
  /** IDs of tasks that block this one; they must finish first. */
  incomingLinks: string[];
  start?: string | null;
  due?: string | null;
  /** Completion date, used as the bar end for finished work. */
  done?: string | null;
}

export interface ScheduledBar {
  id: string;
  start: string;
  end: string;
  startInferred: boolean;
  endInferred: boolean;
}

export interface ScheduleOptions {
  /** Anchor for tasks with neither dates nor dated blockers. */
  today?: string;
  defaultDurationDays?: number;
  /** Measure durations in working days and keep bars off weekends. */
  skipWeekends?: boolean;
}

/**
 * Adds a length to a start date, in working days or calendar days.
 * `length` counts the start day itself, so a length of 1 ends the same day.
 */
export function addDuration(
  start: string,
  length: number,
  skipWeekends: boolean
): string {
  const steps = Math.max(0, length - 1);
  return skipWeekends ? addWorkingDays(start, steps) : addDays(start, steps);
}

/** The length of a bar, in working days or calendar days. */
export function barLength(
  start: string,
  end: string,
  skipWeekends: boolean
): number {
  if (skipWeekends) return workingDayCount(start, end);
  return Math.max(1, diffDays(start, end) + 1);
}

/** Moves a date off a weekend, forwards, when weekends are being skipped. */
function alignStart(start: string, skipWeekends: boolean): string {
  return skipWeekends && isWeekend(start) ? nextWorkingDay(start) : start;
}

/** A bar is a proposal only when neither endpoint came from the task itself. */
export function isInferredBar(bar: ScheduledBar): boolean {
  return bar.startInferred && bar.endInferred;
}

function normalizeDate(value: string | null | undefined): string | null {
  return toEpochDay(value) === null ? null : (value as string);
}

/**
 * Schedules every task, resolving blockers first.
 *
 * Cycles are broken by ignoring the edge that closes them: a task already
 * being resolved higher up the stack does not constrain its own blocker, so a
 * mutually-blocking pair still gets bars instead of hanging.
 */
export function scheduleTasks(
  tasks: GanttTaskInput[],
  options: ScheduleOptions = {}
): Map<string, ScheduledBar> {
  const today = normalizeDate(options.today) ?? todayIso();
  const duration = Math.max(
    1,
    options.defaultDurationDays ?? DEFAULT_DURATION_DAYS
  );
  const skipWeekends = options.skipWeekends ?? false;

  const byId = new Map<string, GanttTaskInput>();
  tasks.forEach((task) => byId.set(task.id, task));

  const resolved = new Map<string, ScheduledBar>();
  const resolving = new Set<string>();

  function resolve(task: GanttTaskInput): ScheduledBar {
    const cached = resolved.get(task.id);
    if (cached) return cached;

    resolving.add(task.id);

    // The day work could start: the day after every blocker has finished
    let earliestStart: string | null = null;
    for (const blockerId of task.incomingLinks) {
      const blocker = byId.get(blockerId);
      if (!blocker || resolving.has(blockerId)) continue;

      const blockerBar = resolve(blocker);
      const candidate = alignStart(addDays(blockerBar.end, 1), skipWeekends);
      if (!earliestStart || diffDays(earliestStart, candidate) > 0) {
        earliestStart = candidate;
      }
    }

    const explicitStart = normalizeDate(task.start);
    const explicitEnd = normalizeDate(task.due) ?? normalizeDate(task.done);

    const bar = layOutBar({
      explicitStart,
      explicitEnd,
      earliestStart,
      fallbackStart: alignStart(today, skipWeekends),
      duration,
      skipWeekends,
      id: task.id,
    });

    resolving.delete(task.id);
    resolved.set(task.id, bar);
    return bar;
  }

  tasks.forEach((task) => resolve(task));

  return resolved;
}

function layOutBar({
  id,
  explicitStart,
  explicitEnd,
  earliestStart,
  fallbackStart,
  duration,
  skipWeekends,
}: {
  id: string;
  explicitStart: string | null;
  explicitEnd: string | null;
  earliestStart: string | null;
  fallbackStart: string;
  duration: number;
  skipWeekends: boolean;
}): ScheduledBar {
  // Both dates given: honour them, collapsing an end that precedes the start
  if (explicitStart && explicitEnd) {
    const end =
      diffDays(explicitStart, explicitEnd) < 0 ? explicitStart : explicitEnd;
    return {
      id,
      start: explicitStart,
      end,
      startInferred: false,
      endInferred: false,
    };
  }

  // Start only: run for the default duration
  if (explicitStart) {
    return {
      id,
      start: explicitStart,
      end: addDuration(explicitStart, duration, skipWeekends),
      startInferred: false,
      endInferred: true,
    };
  }

  // End only: show the window from when work could begin up to the deadline,
  // falling back to a default-length bar finishing on the due date
  if (explicitEnd) {
    const windowStart =
      earliestStart && diffDays(earliestStart, explicitEnd) >= 0
        ? earliestStart
        : addDays(explicitEnd, -(duration - 1));
    return {
      id,
      start: windowStart,
      end: explicitEnd,
      startInferred: true,
      endInferred: false,
    };
  }

  // Nothing given: flow on from the blockers, or sit at today
  const start = earliestStart ?? fallbackStart;
  return {
    id,
    start,
    end: addDuration(start, duration, skipWeekends),
    startInferred: true,
    endInferred: true,
  };
}

/**
 * Inclusive span covering every bar, padded so the chart never starts flush.
 *
 * `anchors` are extra days the range must reach — milestones, which have no
 * bar of their own and would otherwise be marked off the end of the chart.
 */
export function getTimelineRange(
  bars: ScheduledBar[],
  options: { today?: string; padDays?: number; anchors?: string[] } = {}
): { start: string; end: string } {
  const today = normalizeDate(options.today) ?? todayIso();
  const pad = options.padDays ?? 3;
  const anchors = (options.anchors ?? [])
    .map(normalizeDate)
    .filter((date): date is string => date !== null);

  if (bars.length === 0 && anchors.length === 0) {
    return { start: addDays(today, -pad), end: addDays(today, pad) };
  }

  let min = bars[0]?.start ?? anchors[0];
  let max = bars[0]?.end ?? anchors[0];

  for (const bar of bars) {
    if (diffDays(min, bar.start) < 0) min = bar.start;
    if (diffDays(max, bar.end) > 0) max = bar.end;
  }

  for (const anchor of anchors) {
    if (diffDays(min, anchor) < 0) min = anchor;
    if (diffDays(max, anchor) > 0) max = anchor;
  }

  // Keep today in view so the marker is never off-screen
  if (diffDays(min, today) < 0) min = today;
  if (diffDays(max, today) > 0) max = today;

  return { start: addDays(min, -pad), end: addDays(max, pad) };
}

/**
 * Stretches a timeline to at least `minDays`, adding the days at the end.
 *
 * A plan that spans a few weeks draws only a few weeks of grid, which on a
 * wide window leaves the right-hand side bare — rows striped all the way
 * across, months and ticks stopping short. Running the days on to the edge
 * fills it with dates the bars can be dragged onto.
 */
export function fillTimeline(
  range: { start: string; end: string },
  minDays: number
): { start: string; end: string } {
  if (inclusiveDayCount(range.start, range.end) >= minDays) return range;
  return { start: range.start, end: addDays(range.start, minDays - 1) };
}

/**
 * Moves a bar by whole days, keeping its length.
 *
 * With weekends skipped the bar keeps its length in *working* days, and a
 * start that lands on a weekend slides forward to the Monday — so dragging
 * never parks work on a Saturday or silently changes how long it takes.
 */
export function shiftBar(
  bar: { start: string; end: string },
  days: number,
  skipWeekends = false
): { start: string; end: string } {
  if (days === 0 && !skipWeekends) return { start: bar.start, end: bar.end };

  if (!skipWeekends) {
    return { start: addDays(bar.start, days), end: addDays(bar.end, days) };
  }

  const length = barLength(bar.start, bar.end, true);
  const start = alignStart(addDays(bar.start, days), true);
  return { start, end: addDuration(start, length, true) };
}

/** Drags one edge, never letting a bar collapse below a single day. */
export function resizeBar(
  bar: { start: string; end: string },
  edge: "start" | "end",
  days: number,
  skipWeekends = false
): { start: string; end: string } {
  if (days === 0) return { start: bar.start, end: bar.end };

  if (edge === "start") {
    const moved = addDays(bar.start, days);
    const start = diffDays(moved, bar.end) < 0 ? bar.end : moved;
    const aligned = alignStart(start, skipWeekends);
    return {
      start: diffDays(aligned, bar.end) < 0 ? bar.end : aligned,
      end: bar.end,
    };
  }

  const moved = addDays(bar.end, days);
  if (diffDays(bar.start, moved) < 0) {
    return { start: bar.start, end: bar.start };
  }

  // The pointer can land on a weekend; the bar should end on the working day
  // it was dragged towards, never inside the weekend itself
  const end = skipWeekends && isWeekend(moved) ? nextWorkingDay(moved) : moved;
  return { start: bar.start, end };
}
