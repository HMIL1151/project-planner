import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { App } from "obsidian";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Coins,
  Focus,
  GripVertical,
  IndentIncrease,
  Link2,
  Network,
  Plus,
  TagIcon,
} from "lucide-react";
import {
  addDays,
  diffDays,
  inclusiveDayCount,
  isWeekend,
} from "src/lib/date-utils";
import { GanttDependency, GanttRow } from "src/lib/gantt-rows";
import {
  HeaderLayout,
  buildHeaderTicks,
  buildSpans,
  headerLayout,
  quarterOf,
} from "src/lib/gantt-scale";
import { planCascade } from "src/lib/gantt-cascade";
import { useSummaryRenderer } from "src/hooks/use-summary-renderer";
import { HierarchyGroup } from "src/lib/task-hierarchy";
import { buildLines, visibleRowsOf } from "src/lib/gantt-lines";
import {
  ConnectionHighlight,
  connectionKey,
  highlightDirection,
  isHighlightActive,
} from "src/lib/connection-highlight";
import {
  GanttMilestone,
  laneMilestones,
  milestoneStatus,
} from "src/lib/gantt-milestones";
import { ScheduleRisk } from "src/lib/schedule-risk";
import { plainTaskText } from "src/lib/task-text";
import { effectiveTaskStatus } from "src/lib/task-progress";
import { GanttBar, BarDragResult } from "./gantt-bar";
import { GanttRollup } from "./gantt-rollup";
import {
  GanttMilestoneMarker,
  GanttMilestoneRow,
  MilestoneDragResult,
} from "./gantt-milestone";
import { TagInput } from "./tag-input";
import { LinkButton } from "./link-button";
import { Tag } from "./tag";
import { TagColorOverrides, TagColorPalette } from "src/lib/tag-color-manager";
import { t } from "../i18n";

export const ROW_HEIGHT = 34;
/** Rows in compact density: room for the name, a slimmer bar and no more */
export const COMPACT_ROW_HEIGHT = 22;

/** Stable empty set, so switching the critical path off is not a new prop. */
const EMPTY_KEYS: Set<string> = new Set();

/** Header lanes above the rows: the month band and the day ticks. */
const BASE_HEADER_ROWS = 2;

export const MIN_LABEL_WIDTH = 140;
export const MAX_LABEL_WIDTH = 720;

export type RowPlacement = "before" | "after" | "inside";

/**
 * How much of a row's height reads as "drop it inside me" rather than as an
 * insertion above or below. The edges stay wide enough to hit comfortably —
 * reordering is the commoner move and must not become fiddly to pay for
 * nesting.
 */
const NEST_BAND = 0.4;

export interface RowReorder {
  movedId: string;
  targetId: string;
  placement: RowPlacement;
}

interface GanttChartProps {
  /** Headings and their rows, already nested and folded. */
  groups: HierarchyGroup[];
  rows: GanttRow[];
  dependencies: GanttDependency[];
  timelineStart: string;
  timelineEnd: string;
  today: string;
  /** Pixels per day, from the toolbar's scale */
  dayWidth: number;
  /** Slimmer rows, so more of a long plan fits on screen */
  compact: boolean;
  app: App;
  palette: TagColorPalette;
  colorOverrides: TagColorOverrides;
  showTags: boolean;
  /** Tasks with no slack, and the links joining them, from the analysis. */
  criticalIds: Set<string>;
  criticalEdgeKeys: Set<string>;
  floatByTaskId: Map<string, number>;
  /** Whether the user has asked to see the critical path at all. */
  showCriticalPath: boolean;
  /** Tasks whose dates do not add up, keyed by task ID. */
  risksByTaskId: Map<string, ScheduleRisk[]>;
  /** Every selected task; dragging one bar moves all of them. */
  selectedTaskIds: Set<string>;
  highlight: ConnectionHighlight;
  savingTaskIds: Set<string>;
  /** `toggle` clears the selection when the same task is picked again; a
      drag selects without toggling, so releasing keeps the task selected. */
  onSelect: (_taskId: string, _toggle?: boolean, _additive?: boolean) => void;
  onCommit: (_result: BarDragResult) => void;
  /** A click on a bar that moved nothing opens that task for editing. */
  onOpenTask: (_taskId: string) => void;
  onReorder: (_reorder: RowReorder) => void;
  /**
   * Whether the running order is the user's to arrange at all. False while the
   * chart sorts itself — a sorted list has no room for a dropped row — and it
   * takes dragging a row into another one with it, since that drop lands
   * through the same targets.
   */
  reorderable: boolean;
  /** Whether dropping one task into another would be a legal nesting. */
  canNestInto: (_movedId: string, _targetId: string) => boolean;
  /** A task dropped into the middle of another becomes its child. */
  onNestInto: (_movedId: string, _targetId: string) => void;
  onAddTaskAfter: (_taskId: string) => void;
  onStartLink: (_taskId: string) => void;
  onShowInMap: (_taskId: string) => void;
  /** Folds a parent's subtree away, or opens it again. */
  /** `branch` folds or opens everything beneath the task along with it */
  onToggleCollapse: (_taskId: string, _branch: boolean) => void;
  /** Opens the picker for which task this one should sit inside. */
  onSetParent: (_taskId: string) => void;
  /** Narrows the chart to this task's branch */
  onFocusBranch: (_taskId: string) => void;
  /** Absent when finance is switched off, which hides the button. */
  onEditFinance?: (_taskId: string) => void;
  onAddTag: (_taskId: string, _tag: string) => void;
  onRemoveTag: (_taskId: string, _tag: string) => void;
  /** Named days marked across the timeline, in the lane and in the list. */
  milestones: GanttMilestone[];
  /**
   * The running row order, which row milestones take a slot in alongside the
   * tasks. Already worked out by the view — the manual order, or the sorted
   * one while the chart is in date order — so every line on screen is in it.
   */
  order: string[];
  onMoveMilestone: (_result: MilestoneDragResult) => void;
  onEditMilestone: (_milestoneId: string) => void;
  /** Every tag in use, most common first, for the tag picker. */
  allTags: string[];
  /** Task a link is being drawn from, if any. */
  linkingFromId: string | null;
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
  labelWidth: number;
  onLabelWidthChange: (_width: number) => void;
}

/**
 * Task text rendered through the shared summary renderer, so `[[wikilinks]]`
 * become real links into the vault. Lives in its own component because the
 * hook cannot be called inside the row loop.
 */
function GanttLabelText({ summary, app }: { summary: string; app: App }) {
  const ref = useSummaryRenderer(summary, app);
  return (
    <span
      className="project-planner-gantt__label-text"
      title={summary}
      ref={ref}
    />
  );
}

/**
 * One line per problem, naming the blocker a conflict is with so the message
 * says which of several links is the broken one.
 */
function describeRisks(
  risks: ScheduleRisk[],
  nameById: Map<string, string>
): string[] {
  return risks.map((risk) => {
    if (risk.kind !== "conflict") return t(`gantt.risk_${risk.kind}`);
    return t("gantt.risk_conflict", {
      blocker: (risk.blockerId && nameById.get(risk.blockerId)) ?? "",
    });
  });
}

/** The warning marker on a row whose dates do not add up. */
function RiskBadge({ messages }: { messages: string[] }) {
  const title = messages.join("\n");
  return (
    <span
      className="project-planner-gantt__risk"
      title={title}
      aria-label={title}
      role="img"
    >
      <AlertTriangle size={12} />
    </span>
  );
}

/** The contents of a task row in the left column. */
function RowLabel({
  row,
  app,
  palette,
  colorOverrides,
  showTags,
  riskMessages,
  onRemoveTag,
}: {
  row: GanttRow;
  app: App;
  palette: TagColorPalette;
  colorOverrides: TagColorOverrides;
  showTags: boolean;
  riskMessages: string[];
  onRemoveTag: (_taskId: string, _tag: string) => void;
}) {
  return (
    <>
      <span
        className={`project-planner-gantt__status project-planner-gantt__status--${effectiveTaskStatus(
          row.task.status,
          row.task.progress
        )}`}
      />
      {riskMessages.length > 0 && <RiskBadge messages={riskMessages} />}
      <GanttLabelText summary={row.task.summary} app={app} />
      {showTags && row.task.tags.length > 0 && (
        <span className="project-planner-gantt__label-tags">
          {row.task.tags.slice(0, 2).map((tag) => (
            <Tag
              key={tag}
              tag={tag}
              palette={palette}
              colorOverrides={colorOverrides}
              onRemove={() => onRemoveTag(row.task.id, tag)}
            />
          ))}
        </span>
      )}
      <LinkButton link={row.task.link} app={app} taskStatus={row.task.status} />
    </>
  );
}

const MONTH_LABEL_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  year: "numeric",
};

const MONTH_TICK_OPTIONS: Intl.DateTimeFormatOptions = { month: "short" };

function formatMonth(
  iso: string,
  options: Intl.DateTimeFormatOptions = MONTH_LABEL_OPTIONS
): string {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

/** The label of a header band: a month, a quarter or a year. */
function bandLabel(iso: string, unit: HeaderLayout["band"]): string {
  if (unit === "month") return formatMonth(iso);
  if (unit === "quarter") {
    return t("gantt.quarter_band", {
      quarter: quarterOf(iso),
      year: iso.slice(0, 4),
    });
  }
  return iso.slice(0, 4);
}

/** The label of a header column, whose span starts on `iso`. */
function tickLabel(iso: string, unit: HeaderLayout["tick"]): string {
  if (unit === "day") return iso.slice(8);
  if (unit === "week") return iso.slice(5);
  if (unit === "month") return formatMonth(iso, MONTH_TICK_OPTIONS);
  return t("gantt.quarter_tick", { quarter: quarterOf(iso) });
}

export function GanttChart({
  groups,
  rows,
  dependencies,
  timelineStart,
  timelineEnd,
  today,
  dayWidth,
  compact,
  app,
  palette,
  colorOverrides,
  showTags,
  criticalIds,
  criticalEdgeKeys,
  floatByTaskId,
  showCriticalPath,
  risksByTaskId,
  selectedTaskIds,
  highlight,
  savingTaskIds,
  onSelect,
  onCommit,
  onOpenTask,
  onReorder,
  reorderable,
  canNestInto,
  onNestInto,
  onAddTaskAfter,
  onStartLink,
  onShowInMap,
  onToggleCollapse,
  onFocusBranch,
  onSetParent,
  onEditFinance,
  onAddTag,
  onRemoveTag,
  milestones,
  order,
  onMoveMilestone,
  onEditMilestone,
  allTags,
  linkingFromId,
  scrollRef,
  labelWidth,
  onLabelWidthChange,
}: GanttChartProps) {
  const rowHeight = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ movedId: string; pointerId: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placement: RowPlacement;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);

  /** Every bar on screen, so a shift-drag can move the ones it carries. */
  const barElements = useRef(new Map<string, HTMLDivElement>());
  /** Bars currently shifted by a preview, so they can be put back. */
  const cascadingIds = useRef<string[]>([]);

  const registerBar = useCallback(
    (taskId: string, element: HTMLDivElement | null) => {
      if (element) barElements.current.set(taskId, element);
      else barElements.current.delete(taskId);
    },
    []
  );

  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.task.id, row])),
    [rows]
  );

  /**
   * Moves the bars a shift-drag is carrying along, and puts them back.
   *
   * These bars are not the ones being dragged, so they have no drag state to
   * read it from: the chart nudges their offsets directly, exactly the way each
   * bar drives its own. Nothing re-renders — a preview is undone by the next
   * call, and by the one `endDrag` always makes. If a carried bar does happen
   * to re-render mid-drag it simply snaps back to its real dates, and the next
   * pointer move picks it up again.
   */
  const previewCascade = useCallback(
    (seedId: string, days: number | null) => {
      const offsetOf = (row: GanttRow) =>
        diffDays(timelineStart, row.bar.start);

      for (const id of cascadingIds.current) {
        const element = barElements.current.get(id);
        const row = rowById.get(id);
        if (!element || !row) continue;
        element.style.setProperty("--bar-offset", String(offsetOf(row)));
        element.classList.remove("project-planner-gantt-bar--cascading");
      }
      cascadingIds.current = [];

      if (days === null) return;

      const plan = planCascade(seedId, rows, days);
      // The seed is already moving itself; the rest follow by however far each
      // of them got, so what is on screen is what a release would write
      const carried = plan.movingIds.filter((id) => id !== seedId);

      for (const id of carried) {
        const element = barElements.current.get(id);
        const row = rowById.get(id);
        if (!element || !row) continue;
        element.style.setProperty(
          "--bar-offset",
          String(offsetOf(row) + (plan.shiftById.get(id) ?? plan.days))
        );
        element.classList.add("project-planner-gantt-bar--cascading");
      }
      cascadingIds.current = carried;
    },
    [rowById, rows, timelineStart]
  );

  const lines = useMemo(
    () => buildLines(groups, milestones, order),
    [groups, milestones, order]
  );

  /** Rows the arrow layer can reach: the ones actually on screen. */
  const visibleRows = useMemo(() => visibleRowsOf(lines), [lines]);

  /** Only the flag milestones need the band above the chart. */
  const laneFlags = useMemo(() => laneMilestones(milestones), [milestones]);

  // Milestone flags get a lane of their own, but only once there is one to
  // draw — an empty band above every chart would be a strange default
  const headerRows =
    laneFlags.length > 0 ? BASE_HEADER_ROWS + 1 : BASE_HEADER_ROWS;

  /**
   * Which line the pointer is over, and what dropping there would mean.
   *
   * The middle of a task row nests the dragged task inside it; the edges keep
   * their old meaning of an insertion above or below. `movedId` is needed
   * because whether nesting is even offered depends on what is being dragged —
   * nothing can go inside itself or inside its own descendants.
   */
  const resolveDropTarget = useCallback(
    (
      clientY: number,
      movedId: string
    ): { id: string; placement: RowPlacement } | null => {
      // Nowhere to drop while the chart owns its own order, which also stops
      // the drop indicator following a drag that could not be honoured
      if (!reorderable) return null;

      const container = labelsRef.current;
      if (!container) return null;

      // The label header spans the timeline header lanes plus its border
      const headerHeight = rowHeight * headerRows + 1;
      const offset =
        clientY - container.getBoundingClientRect().top - headerHeight;
      const index = Math.floor(offset / rowHeight);
      if (index < 0) {
        const first = lines.find((line) => line.orderId !== null);
        return first?.orderId
          ? { id: first.orderId, placement: "before" }
          : null;
      }

      const clamped = Math.min(index, lines.length - 1);
      // Headers hold no slot in the order, so they are not drop targets; fall
      // back to whichever line above them does
      let line = lines[clamped];
      for (let i = clamped; i >= 0 && line?.orderId == null; i--) {
        line = lines[i];
      }
      if (!line?.orderId) return null;

      const withinRow = offset - clamped * rowHeight;
      const edge = (rowHeight * (1 - NEST_BAND)) / 2;

      // Only a task can hold another task. A milestone marks a date and owns
      // nothing, so its middle goes on meaning "drop after this one".
      const nestable =
        line.kind === "row" &&
        line.orderId !== movedId &&
        canNestInto(movedId, line.orderId);

      if (nestable && withinRow >= edge && withinRow <= rowHeight - edge) {
        return { id: line.orderId, placement: "inside" };
      }

      return {
        id: line.orderId,
        placement: withinRow < rowHeight / 2 ? "before" : "after",
      };
    },
    [canNestInto, headerRows, lines, reorderable, rowHeight]
  );

  /** A bar dragged up or down shows the same drop indicator as a row drag. */
  const handleVerticalPreview = useCallback(
    (clientY: number | null, movedId: string) => {
      setDropTarget(
        clientY === null ? null : resolveDropTarget(clientY, movedId)
      );
    },
    [resolveDropTarget]
  );

  const handleVerticalDrop = useCallback(
    (movedId: string, clientY: number) => {
      setDropTarget(null);
      const target = resolveDropTarget(clientY, movedId);
      if (!target || target.id === movedId) return;

      if (target.placement === "inside") {
        onNestInto(movedId, target.id);
        return;
      }

      onReorder({ movedId, targetId: target.id, placement: target.placement });
    },
    [onNestInto, onReorder, resolveDropTarget]
  );

  const handleReorderDown = useCallback(
    (movedId: string) => (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { movedId, pointerId: event.pointerId };
      setDraggingId(movedId);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handleReorderMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDropTarget(resolveDropTarget(event.clientY, drag.movedId));
    },
    [resolveDropTarget]
  );

  const handleReorderUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDraggingId(null);

      const target = resolveDropTarget(event.clientY, drag.movedId);
      setDropTarget(null);
      if (!target || target.id === drag.movedId) return;

      if (target.placement === "inside") {
        onNestInto(drag.movedId, target.id);
        return;
      }

      onReorder({
        movedId: drag.movedId,
        targetId: target.id,
        placement: target.placement,
      });
    },
    [onNestInto, onReorder, resolveDropTarget]
  );

  const totalDays = inclusiveDayCount(timelineStart, timelineEnd);
  const todayOffset = diffDays(timelineStart, today);
  const todayVisible = todayOffset >= 0 && todayOffset < totalDays;

  const layout = headerLayout(dayWidth);
  const ticks = useMemo(
    () => buildHeaderTicks(timelineStart, totalDays, dayWidth),
    [timelineStart, totalDays, dayWidth]
  );
  const bands = useMemo(
    () => buildSpans(timelineStart, totalDays, layout.band),
    [timelineStart, totalDays, layout.band]
  );

  // Geometry the whole chart shares, as CSS variables on the scrolling grid
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.style.setProperty("--gantt-day-width", `${dayWidth}px`);
    el.style.setProperty("--gantt-total-days", String(totalDays));
    el.style.setProperty("--gantt-row-height", `${rowHeight}px`);
    el.style.setProperty("--gantt-today-offset", String(todayOffset));
    el.style.setProperty("--gantt-header-rows", String(headerRows));
  }, [headerRows, dayWidth, rowHeight, totalDays, todayOffset]);

  // Written separately from the geometry above so a resize drag can update it
  // without disturbing anything else
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || resizeRef.current) return;
    el.style.setProperty("--gantt-label-width", `${labelWidth}px`);
  }, [labelWidth]);

  const clampLabelWidth = (width: number) =>
    Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, Math.round(width)));

  const handleResizeDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizeRef.current = { startX: event.clientX, startWidth: labelWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [labelWidth]
  );

  const handleResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const next = clampLabelWidth(
        resize.startWidth + (event.clientX - resize.startX)
      );
      gridRef.current?.style.setProperty("--gantt-label-width", `${next}px`);
    },
    []
  );

  const handleResizeUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize) return;
      resizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);

      const next = clampLabelWidth(
        resize.startWidth + (event.clientX - resize.startX)
      );
      if (next !== labelWidth) onLabelWidthChange(next);
    },
    [labelWidth, onLabelWidthChange]
  );

  const setRowRef = useCallback(
    (offset: number, span: number) => (el: HTMLDivElement | null) => {
      if (!el) return;
      el.style.setProperty("--bar-offset", String(offset));
      el.style.setProperty("--bar-span", String(span));
    },
    []
  );

  // How far a child's name sits in from the column's edge. A custom property
  // set through a ref, because inline `style` props are an ESLint error and a
  // class per depth would cap the nesting at however many were written.
  const setDepthRef = useCallback(
    (depth: number) => (el: HTMLDivElement | null) => {
      if (!el) return;
      el.style.setProperty("--gantt-depth", String(depth));
    },
    []
  );

  // Arrows are positioned by rendered line, so group headings push them down
  const lineIndexById = useMemo(() => {
    const index = new Map<string, number>();
    lines.forEach((line, position) => {
      if (line.kind === "row") index.set(line.row.task.id, position);
    });
    return index;
  }, [lines]);

  /**
   * Built from the rendered lines rather than from every row, for two reasons:
   * a summary row's bar is the rolled-up one, and a row folded away inside a
   * collapsed parent is not here at all. The second is what keeps the arrow
   * layer honest — a link to a hidden row is dropped rather than drawn to
   * whichever row happens to have taken its place, the same way a link to a
   * filtered-out task is already dropped in `getDependencies`.
   */
  const rowByTaskId = useMemo(() => {
    const map = new Map<string, GanttRow>();
    visibleRows.forEach((row) => map.set(row.task.id, row));
    return map;
  }, [visibleRows]);

  // Blocker names for the conflict messages, without the metadata a task line
  // carries around with it
  const nameByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) =>
      map.set(row.task.id, plainTaskText(row.task.summary))
    );
    return map;
  }, [rows]);

  const riskMessagesByTaskId = useMemo(() => {
    const map = new Map<string, string[]>();
    risksByTaskId.forEach((risks, taskId) =>
      map.set(taskId, describeRisks(risks, nameByTaskId))
    );
    return map;
  }, [risksByTaskId, nameByTaskId]);

  const arrowPaths = useMemo(
    () =>
      buildArrowPaths(
        rowByTaskId,
        lineIndexById,
        dependencies,
        timelineStart,
        dayWidth,
        rowHeight,
        highlight,
        showCriticalPath ? criticalEdgeKeys : EMPTY_KEYS
      ),
    [
      rowByTaskId,
      lineIndexById,
      dependencies,
      timelineStart,
      dayWidth,
      rowHeight,
      highlight,
      showCriticalPath,
      criticalEdgeKeys,
    ]
  );

  /** What the analysis says about one row, for the bar to draw. */
  const isAtRisk = useCallback(
    (taskId: string) => risksByTaskId.has(taskId),
    [risksByTaskId]
  );

  const analysisFor = useCallback(
    (taskId: string) => ({
      critical: showCriticalPath && criticalIds.has(taskId),
      slackDays: showCriticalPath ? (floatByTaskId.get(taskId) ?? null) : null,
      atRisk: risksByTaskId.has(taskId),
    }),
    [showCriticalPath, criticalIds, floatByTaskId, risksByTaskId]
  );

  const highlighting = isHighlightActive(highlight);

  const rowClassName = (row: GanttRow, base: string, extra = "") =>
    [
      base,
      extra,
      selectedTaskIds.has(row.task.id) ? `${base}--selected` : "",
      draggingId === row.task.id ? `${base}--dragging` : "",
      dropTarget?.id === row.task.id
        ? `${base}--drop-${dropTarget.placement}`
        : "",
      highlighting && highlight.taskIds.has(row.task.id)
        ? `${base}--connected`
        : "",
      highlighting && highlight.upstreamIds.has(row.task.id)
        ? `${base}--upstream`
        : "",
      highlighting && highlight.downstreamIds.has(row.task.id)
        ? `${base}--downstream`
        : "",
      highlighting && !highlight.taskIds.has(row.task.id)
        ? `${base}--dimmed`
        : "",
      linkingFromId === row.task.id ? `${base}--linking` : "",
      linkingFromId && linkingFromId !== row.task.id
        ? `${base}--link-target`
        : "",
      showCriticalPath && criticalIds.has(row.task.id)
        ? `${base}--critical`
        : "",
      risksByTaskId.has(row.task.id) ? `${base}--at-risk` : "",
    ]
      .filter(Boolean)
      .join(" ");

  /**
   * The drag handle for a line, or a spent one while the chart owns its own
   * order. The handle keeps its place either way: rows that lost a grip would
   * shuffle every name in the column sideways when the mode is turned on.
   */
  const gripProps = (orderId: string) =>
    reorderable
      ? {
          className: "project-planner-gantt__grip",
          title: t("gantt.reorder_hint"),
          onPointerDown: handleReorderDown(orderId),
          onPointerMove: handleReorderMove,
          onPointerUp: handleReorderUp,
          onPointerCancel: handleReorderUp,
        }
      : {
          className:
            "project-planner-gantt__grip project-planner-gantt__grip--locked",
          title: t("gantt.reorder_locked"),
        };

  /**
   * A milestone line carries only the states a milestone can be in. It is not
   * a task, so it is never selected, never on the critical path, never at
   * risk and never a link target — the only thing it shares with a row is
   * that it can be dragged up and down the list.
   */
  const milestoneLineClassName = (orderId: string, base: string) =>
    [
      base,
      `${base}--milestone`,
      draggingId === orderId ? `${base}--dragging` : "",
      dropTarget?.id === orderId ? `${base}--drop-${dropTarget.placement}` : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className={`project-planner-gantt${
        compact ? " project-planner-gantt--compact" : ""
      }`}
      ref={gridRef}
    >
      {/* One scroll container for both panes: vertical scrolling keeps the
          labels aligned with their rows, and the label column stays pinned
          during horizontal scrolling via `position: sticky`. */}
      <div className="project-planner-gantt__scroll" ref={scrollRef}>
        <div className="project-planner-gantt__labels" ref={labelsRef}>
          <div className="project-planner-gantt__labels-header">
            {t("gantt.column_task")}
          </div>
          {lines.map((line) =>
            line.kind === "header" ? (
              <div
                key={line.key}
                className="project-planner-gantt__group-header"
              >
                <span className="project-planner-gantt__group-label">
                  {line.label}
                </span>
                <span className="project-planner-gantt__group-count">
                  {line.count}
                </span>
              </div>
            ) : line.kind === "milestone" ? (
              /* A milestone filed among the tasks. No status dot, no tags, no
                 row actions and no twisty with anything behind it — it is a
                 date the plan is measured against, not a task, and offering
                 it a task's controls would say otherwise. */
              <div
                key={line.key}
                className={milestoneLineClassName(
                  line.orderId,
                  "project-planner-gantt__label"
                )}
                onClick={() => onEditMilestone(line.milestone.id)}
              >
                <span
                  {...gripProps(line.orderId)}
                  /* The row opens the milestone when clicked, and a drag that
                     ends on the grip still counts as a click on it */
                  onClick={(event) => event.stopPropagation()}
                >
                  <GripVertical size={12} />
                </span>
                <span
                  className="project-planner-gantt__twisty project-planner-gantt__twisty--empty"
                  aria-hidden="true"
                />
                <span
                  className="project-planner-gantt__milestone-dot"
                  aria-hidden="true"
                />
                <span
                  className="project-planner-gantt__label-text"
                  title={t("gantt.milestone_tooltip", {
                    label: line.milestone.label,
                    date: line.milestone.date,
                  })}
                >
                  {line.milestone.label}
                </span>
                <span className="project-planner-gantt__milestone-date">
                  {line.milestone.date}
                </span>
              </div>
            ) : (
              <div
                key={line.key}
                ref={setDepthRef(line.depth)}
                className={rowClassName(
                  line.row,
                  "project-planner-gantt__label",
                  line.hasChildren
                    ? "project-planner-gantt__label--summary"
                    : ""
                )}
                onClick={(event) =>
                  onSelect(
                    line.row.task.id,
                    true,
                    event.ctrlKey || event.metaKey
                  )
                }
              >
                <span {...gripProps(line.row.task.id)}>
                  <GripVertical size={12} />
                </span>
                {/* A fixed-width slot either way, so the names of a parent and
                    of a childless task at the same depth still line up */}
                {line.hasChildren ? (
                  <button
                    className="project-planner-gantt__twisty"
                    title={
                      line.collapsed
                        ? t("gantt.expand_hint")
                        : t("gantt.collapse_hint")
                    }
                    aria-label={
                      line.collapsed ? t("gantt.expand") : t("gantt.collapse")
                    }
                    aria-expanded={!line.collapsed}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleCollapse(line.row.task.id, event.altKey);
                    }}
                  >
                    {line.collapsed ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>
                ) : (
                  <span
                    className="project-planner-gantt__twisty project-planner-gantt__twisty--empty"
                    aria-hidden="true"
                  />
                )}
                {taggingId === line.row.task.id ? (
                  <span
                    className="project-planner-gantt__tag-input"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <TagInput
                      allTags={allTags}
                      existingTags={line.row.task.tags}
                      onAddTag={(tag) => {
                        setTaggingId(null);
                        onAddTag(line.row.task.id, tag);
                      }}
                      onCancel={() => setTaggingId(null)}
                    />
                  </span>
                ) : (
                  <RowLabel
                    row={line.row}
                    app={app}
                    palette={palette}
                    colorOverrides={colorOverrides}
                    showTags={showTags}
                    riskMessages={
                      riskMessagesByTaskId.get(line.row.task.id) ?? []
                    }
                    onRemoveTag={onRemoveTag}
                  />
                )}
                {/* Always rendered, so the buttons stay in the tab order and
                    in the accessibility tree; CSS floats them over the right
                    of the row and reveals them on hover or focus. */}
                <span
                  className={`project-planner-gantt__row-actions${
                    taggingId === line.row.task.id
                      ? " project-planner-gantt__row-actions--hidden"
                      : ""
                  }`}
                >
                  {line.hasChildren && (
                    <button
                      className="project-planner-gantt__row-action"
                      title={t("gantt.focus_branch")}
                      aria-label={t("gantt.focus_branch")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocusBranch(line.row.task.id);
                      }}
                    >
                      <Focus size={12} />
                    </button>
                  )}
                  <button
                    className="project-planner-gantt__row-action"
                    title={t("gantt.add_tag")}
                    aria-label={t("gantt.add_tag")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setTaggingId((previous) =>
                        previous === line.row.task.id ? null : line.row.task.id
                      );
                    }}
                  >
                    <TagIcon size={12} />
                  </button>
                  <button
                    className="project-planner-gantt__row-action"
                    title={t("gantt.show_in_map")}
                    aria-label={t("gantt.show_in_map")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onShowInMap(line.row.task.id);
                    }}
                  >
                    <Network size={12} />
                  </button>
                  <button
                    className="project-planner-gantt__row-action"
                    title={t("gantt.link_from")}
                    aria-label={t("gantt.link_from")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartLink(line.row.task.id);
                    }}
                  >
                    <Link2 size={12} />
                  </button>
                  <button
                    className="project-planner-gantt__row-action"
                    title={t("gantt.set_parent")}
                    aria-label={t("gantt.set_parent")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetParent(line.row.task.id);
                    }}
                  >
                    <IndentIncrease size={12} />
                  </button>
                  {onEditFinance && (
                    <button
                      className="project-planner-gantt__row-action"
                      title={t("finance.menu_item")}
                      aria-label={t("finance.menu_item")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEditFinance(line.row.task.id);
                      }}
                    >
                      <Coins size={12} />
                    </button>
                  )}
                  <button
                    className="project-planner-gantt__row-action"
                    title={t("gantt.add_task_after")}
                    aria-label={t("gantt.add_task_after")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddTaskAfter(line.row.task.id);
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </span>
              </div>
            )
          )}
          <div
            className="project-planner-gantt__resizer"
            onPointerDown={handleResizeDown}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            onPointerCancel={handleResizeUp}
            title={t("gantt.resize_columns")}
          />
        </div>

        <div className="project-planner-gantt__timeline">
          <div className="project-planner-gantt__header">
            <div className="project-planner-gantt__months">
              {bands.map((band) => (
                <div
                  key={band.iso}
                  className="project-planner-gantt__month"
                  ref={setRowRef(band.offset, band.days)}
                >
                  <span className="project-planner-gantt__month-label">
                    {bandLabel(band.iso, layout.band)}
                  </span>
                </div>
              ))}
            </div>
            <div className="project-planner-gantt__ticks">
              {ticks.map((tick) => (
                <div
                  key={tick.iso}
                  className={`project-planner-gantt__tick ${
                    tick.major ? "project-planner-gantt__tick--major" : ""
                  } ${tick.weekend ? "project-planner-gantt__tick--weekend" : ""}`}
                  ref={setRowRef(tick.offset, tick.days)}
                >
                  {tick.labelled ? tickLabel(tick.iso, layout.tick) : ""}
                </div>
              ))}
            </div>
            {laneFlags.length > 0 && (
              <div
                className="project-planner-gantt__milestone-lane"
                aria-hidden="true"
              />
            )}
          </div>

          <div className="project-planner-gantt__body">
            {layout.shadeWeekends &&
              Array.from({ length: totalDays }, (_, offset) => {
                const iso = addDays(timelineStart, offset);
                if (!isWeekend(iso)) return null;
                return (
                  <div
                    key={iso}
                    className="project-planner-gantt__weekend"
                    ref={setRowRef(offset, 1)}
                  />
                );
              })}

            {todayVisible && <div className="project-planner-gantt__today" />}

            <svg
              className="project-planner-gantt__arrows"
              width={totalDays * dayWidth}
              height={Math.max(lines.length, 1) * rowHeight}
            >
              {arrowPaths.map((path) => (
                <path
                  key={path.key}
                  d={path.d}
                  className={`project-planner-gantt__arrow ${path.className}`}
                  markerEnd="url(#project-planner-gantt-arrowhead)"
                />
              ))}
              <defs>
                <marker
                  id="project-planner-gantt-arrowhead"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path
                    d="M0,0 L6,3 L0,6 z"
                    className="project-planner-gantt__arrowhead"
                  />
                </marker>
              </defs>
            </svg>

            {lines.map((line) =>
              line.kind === "header" ? (
                <div
                  key={line.key}
                  className="project-planner-gantt__group-spacer"
                  aria-hidden="true"
                />
              ) : line.kind === "milestone" ? (
                <div
                  key={line.key}
                  className={milestoneLineClassName(
                    line.orderId,
                    "project-planner-gantt__row"
                  )}
                >
                  <GanttMilestoneRow
                    milestone={line.milestone}
                    status={milestoneStatus(line.milestone, today)}
                    offsetDays={diffDays(timelineStart, line.milestone.date)}
                    dayWidth={dayWidth}
                    onMove={onMoveMilestone}
                    onEdit={onEditMilestone}
                  />
                </div>
              ) : (
                <div
                  key={line.key}
                  className={rowClassName(
                    line.row,
                    "project-planner-gantt__row"
                  )}
                >
                  {line.rollup && (
                    <GanttRollup
                      rows={line.rollup}
                      timelineStart={timelineStart}
                      isAtRisk={isAtRisk}
                    />
                  )}
                  <GanttBar
                    task={line.row.task}
                    bar={line.row.bar}
                    inferred={line.row.inferred}
                    summary={line.hasChildren}
                    analysis={analysisFor(line.row.task.id)}
                    timelineStart={timelineStart}
                    dayWidth={dayWidth}
                    onCommit={onCommit}
                    onCascadePreview={previewCascade}
                    onRegister={registerBar}
                    onOpen={onOpenTask}
                    onVerticalPreview={handleVerticalPreview}
                    onVerticalDrop={handleVerticalDrop}
                    selected={selectedTaskIds.has(line.row.task.id)}
                    saving={savingTaskIds.has(line.row.task.id)}
                  />
                </div>
              )
            )}
          </div>

          {/* Above both the header and the rows, so a milestone's flag stays
              in its lane while its guide line runs the length of the chart. */}
          {laneFlags.length > 0 && (
            <div className="project-planner-gantt__milestones">
              {laneFlags.map((milestone) => (
                <GanttMilestoneMarker
                  key={milestone.id}
                  milestone={milestone}
                  status={milestoneStatus(milestone, today)}
                  offsetDays={diffDays(timelineStart, milestone.date)}
                  dayWidth={dayWidth}
                  onMove={onMoveMilestone}
                  onEdit={onEditMilestone}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ArrowPath {
  key: string;
  d: string;
  className: string;
}

/**
 * Elbow connectors from the end of a blocker to the start of the task it
 * blocks, routed around the rows in between.
 */
function buildArrowPaths(
  rowByTaskId: Map<string, GanttRow>,
  lineIndexById: Map<string, number>,
  dependencies: GanttDependency[],
  timelineStart: string,
  dayWidth: number,
  rowHeight: number,
  highlight: ConnectionHighlight,
  criticalEdgeKeys: Set<string>
): ArrowPath[] {
  const highlighting = isHighlightActive(highlight);
  return dependencies.flatMap((dependency) => {
    const from = rowByTaskId.get(dependency.fromId);
    const to = rowByTaskId.get(dependency.toId);
    const fromLine = lineIndexById.get(dependency.fromId);
    const toLine = lineIndexById.get(dependency.toId);
    if (!from || !to || fromLine === undefined || toLine === undefined) {
      return [];
    }

    const fromX = (diffDays(timelineStart, from.bar.end) + 1) * dayWidth;
    const fromY = fromLine * rowHeight + rowHeight / 2;
    const toX = diffDays(timelineStart, to.bar.start) * dayWidth;
    const toY = toLine * rowHeight + rowHeight / 2;

    const gutter = Math.max(8, dayWidth / 2);
    const midX = toX - gutter > fromX ? toX - gutter : fromX + gutter;

    const d = `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`;

    const key = connectionKey(dependency.fromId, dependency.toId);
    const direction = highlightDirection(
      highlight,
      dependency.fromId,
      dependency.toId
    );
    const highlightClass = !highlighting
      ? ""
      : direction
        ? `project-planner-gantt__arrow--${direction}`
        : highlight.edgeKeys.has(key)
          ? "project-planner-gantt__arrow--connected"
          : "project-planner-gantt__arrow--dimmed";

    // The critical marking survives a selection dimming the rest of the chart:
    // it is the one thing worth seeing whatever else is going on
    const className = [
      highlightClass,
      criticalEdgeKeys.has(key) ? "project-planner-gantt__arrow--critical" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return [{ key, d, className }];
  });
}
