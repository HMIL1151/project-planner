import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Events, Notice } from "obsidian";
import { useApp } from "src/hooks/hooks";
import { AppWithPlugins } from "src/types/obsidian-internals";
import { BaseTask } from "src/types/base-task";
import {
  addLinkSignsBetweenTasks,
  removeLinkSignsBetweenTasks,
  addSignToTaskInFile,
  addTagToTaskInVault,
  removeTagFromTaskInVault,
  addTaskLineToVault,
  appendTaskLineToFile,
  getAllTasks,
  getTasksApi,
  parseTaskLine,
  resolveDefaultTaskFile,
} from "src/lib/utils";
import { withTaskChanges } from "src/lib/task-write";
import { openTaskEditor } from "src/lib/open-task-editor";
import { promptForTaskLine } from "src/components/task-line-modal";
import { withCompanionNote } from "src/lib/companion-note";
import { diffDays, todayIso } from "src/lib/date-utils";
import { getTimelineRange, resizeBar, shiftBar } from "src/lib/gantt-schedule";
import { planCascade } from "src/lib/gantt-cascade";
import {
  GanttRow,
  buildGanttRows,
  getDependencies,
  getInferredRows,
} from "src/lib/gantt-rows";
import {
  GanttGroupBy,
  applyOrder,
  buildDateOrderedHierarchy,
  dateEntryForRow,
  groupRows,
  moveRelativeTo,
  moveWithinParent,
  normalizeOrderIds,
  orderEntriesByDate,
} from "src/lib/gantt-order";
import {
  HierarchyGroup,
  buildHierarchy,
  collectDescendantIds,
  parentTaskIds,
  resolveParentIds,
  toggleCollapsed,
} from "src/lib/task-hierarchy";
import { promptForParent } from "src/components/gantt-parent-modal";
import { plainTaskText } from "src/lib/task-text";
import {
  GANTT_SCALES,
  GanttChart,
  GanttScale,
  ROW_HEIGHT,
  RowReorder,
} from "src/components/gantt-chart";
import {
  GanttMilestone,
  addMilestone,
  findMilestone,
  laneMilestones,
  milestoneOrderKey,
  readMilestones,
  removeMilestone,
  rowMilestones,
  shiftMilestone,
  updateMilestone,
} from "src/lib/gantt-milestones";
import { buildLines } from "src/lib/gantt-lines";
import {
  GanttExportLine,
  buildGanttSvg,
  exportFileName,
  formatExportDate,
} from "src/lib/gantt-export";
import {
  DEFAULT_EXPORT_DRAFT,
  GanttExportDraft,
  exportGanttPng,
  promptForGanttExport,
} from "src/components/gantt-export-modal";
import { getConnectionHighlight } from "src/lib/connection-highlight";
import { findCriticalPath } from "src/lib/critical-path";
import { ScheduleRisk, findScheduleRisks } from "src/lib/schedule-risk";
import { GanttToolbar } from "src/components/gantt-toolbar";
import { BarDragResult } from "src/components/gantt-bar";
import { MilestoneDragResult } from "src/components/gantt-milestone";
import { promptForMilestone } from "src/components/gantt-milestone-modal";
import { ProjectPlannerSettings } from "src/types/settings";
import { GanttLegend } from "src/components/gantt-legend";
import { useUndoHistory } from "src/hooks/use-undo-history";
import { findTaskDate } from "src/lib/task-dates";
import { effectiveTaskStatus } from "src/lib/task-progress";
import ProjectPlannerPlugin from "../main";
import {
  FOCUS_TASK_EVENT,
  GANTT_VIEW_TYPE,
  focusTargetFor,
} from "src/lib/view-focus";
import { combineSources } from "src/lib/task-source";
import { t } from "../i18n";

interface GanttViewProps {
  settings: ProjectPlannerSettings;
  plugin: ProjectPlannerPlugin;
  /** Dataview source for this chart's project, narrowing the vault-wide one */
  source?: string;
}

/** Stable empty map, so switching the warnings off is not a new prop. */
const NO_RISKS: Map<string, ScheduleRisk[]> = new Map();

export default function GanttView({
  settings,
  plugin,
  source = "",
}: GanttViewProps) {
  const app = useApp();
  const [tasks, setTasks] = useState<BaseTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState<GanttScale>(GANTT_SCALES[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Ctrl/Cmd-click builds a set; dragging any member moves them all together
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set()
  );
  const [groupBy, setGroupBy] = useState<GanttGroupBy>("none");
  // Task a dependency is being drawn from; the next row clicked receives it
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  // Task another view asked us to reveal, cleared once it is on screen
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Remembered for the session, so exporting the same plan twice does not mean
  // retyping its heading and picking its page size again
  const [exportDraft, setExportDraft] = useState<GanttExportDraft>({
    title: "",
    ...DEFAULT_EXPORT_DRAFT,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Undo runs long after its action, so it reads tasks through a ref
  const tasksRef = useRef<BaseTask[]>([]);
  const hasCenteredRef = useRef(false);

  // Recomputed per render so a long-open view rolls over at midnight
  const today = todayIso();

  const loadTasks = useCallback(
    (options: { notify?: boolean } = {}) => {
      setIsLoading(true);
      window.setTimeout(() => {
        setTasks(getAllTasks(app, combineSources(settings.taskSource, source)));
        setIsLoading(false);
        if (options.notify) new Notice(t("gantt.reloaded"));
      }, 0);
    },
    [app, settings.taskSource, source]
  );

  useEffect(() => {
    const dataviewPlugin = (app as AppWithPlugins).plugins?.plugins?.[
      "dataview"
    ];

    if (dataviewPlugin?.index?.initialized) {
      loadTasks();
      return;
    }

    // `dataview:index-ready` is a custom event, so it comes off the generic
    // Events base type rather than MetadataCache's typed overloads.
    const metadataCache: Events = app.metadataCache;
    const eventRef = metadataCache.on("dataview:index-ready", () => {
      loadTasks();
    });

    return () => {
      metadataCache.offref(eventRef);
    };
  }, [app, loadTasks]);

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return tasks.filter((task) => {
      if (
        hideCompleted &&
        (task.status === "done" || task.status === "canceled")
      ) {
        return false;
      }
      if (!query) return true;
      return (
        task.summary.toLowerCase().includes(query) ||
        task.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [tasks, searchQuery, hideCompleted]);

  const scheduledRows = useMemo(
    () =>
      buildGanttRows(visibleTasks, {
        today,
        skipWeekends: settings.ganttSkipWeekends,
      }),
    [visibleTasks, today, settings.ganttSkipWeekends]
  );

  // The chart never re-sorts on its own: rows follow the saved order, and new
  // tasks are appended rather than slotted in by date.
  const rows = useMemo(
    () => applyOrder(scheduledRows, settings.ganttTaskOrder),
    [scheduledRows, settings.ganttTaskOrder]
  );

  const groups = useMemo(
    () =>
      groupRows(rows, groupBy, {
        untagged: t("gantt.group_untagged"),
        noProject: t("gantt.group_no_project"),
        status: (status) => t(`gantt.legend_${status}`),
      }),
    [rows, groupBy]
  );

  const collapsedIds = useMemo(
    () => new Set(settings.ganttCollapsedTaskIds),
    [settings.ganttCollapsedTaskIds]
  );

  /**
   * Each group nested on its own, so a parent and a child that land under
   * different headings are each drawn where their own metadata puts them
   * rather than one dragging the other out of its group.
   *
   * In date order the nesting is dropped and the rows are laid out flat and
   * earliest first — within each group, since grouping is a split the user
   * asked for and sorting is not a reason to undo it.
   */
  const hierarchy = useMemo(
    () =>
      groups.map((group) => ({
        group,
        ...(settings.ganttDateOrder
          ? buildDateOrderedHierarchy(group.rows, collapsedIds)
          : buildHierarchy(group.rows, collapsedIds)),
      })),
    [collapsedIds, groups, settings.ganttDateOrder]
  );

  const hierarchyGroups: HierarchyGroup[] = useMemo(
    () =>
      hierarchy.map(({ group, lines }) => ({
        key: group.key,
        label: group.label,
        // The whole group, including rows folded away inside a collapsed
        // parent: the heading counts tasks, not visible lines
        count: group.rows.length,
        lines,
      })),
    [hierarchy]
  );

  /**
   * The nesting as drawn: within a group, and with loops and dangling parents
   * already broken. Row dragging reads this rather than the raw `parentId`, so
   * what a drag is allowed to do matches what is on screen.
   */
  const visibleParentById = useMemo(() => {
    const merged = new Map<string, string | null>();
    for (const { parentById } of hierarchy) {
      for (const [id, parentId] of parentById) merged.set(id, parentId);
    }
    return merged;
  }, [hierarchy]);

  /** Tasks drawn as a summary of the rows beneath them. */
  const summaryTaskIds = useMemo(
    () => parentTaskIds(visibleParentById),
    [visibleParentById]
  );

  const dependencies = useMemo(() => getDependencies(rows), [rows]);

  // Selecting a row lights up everything it depends on and everything waiting
  // on it, using the same chain the map draws
  const highlight = useMemo(
    () => getConnectionHighlight(selectedTaskId, visibleTasks),
    [selectedTaskId, visibleTasks]
  );
  // A summary row's bar comes from its children, so there is nothing on it to
  // apply: writing its own suggested dates would put dates in the note that
  // the chart then ignores.
  const inferredRows = useMemo(
    () =>
      getInferredRows(rows).filter((row) => !summaryTaskIds.has(row.task.id)),
    [rows, summaryTaskIds]
  );

  // Milestones belong to the chart rather than the vault, so they come from
  // settings — and the timeline has to stretch to reach them
  const milestones = useMemo(
    () => readMilestones(settings.ganttMilestones),
    [settings.ganttMilestones]
  );

  /**
   * Every slot the manual order has to account for.
   *
   * A milestone the user asked to see as a row needs a place among the tasks,
   * so it takes a slot under its own namespaced key (see
   * `MILESTONE_ORDER_PREFIX`). Keeping both kinds in the one flat list is what
   * lets a single drag handler, a single undo entry and a single settings key
   * cover them: nothing downstream has to know which slots are tasks.
   */
  const orderSlots = useMemo(
    () => [
      ...rows.map((row) => row.task.id),
      ...rowMilestones(milestones).map((milestone) =>
        milestoneOrderKey(milestone.id)
      ),
    ],
    [milestones, rows]
  );

  /** The saved order, trimmed to what is on screen and extended with the rest. */
  const order = useMemo(
    () => normalizeOrderIds(orderSlots, settings.ganttTaskOrder),
    [orderSlots, settings.ganttTaskOrder]
  );

  /**
   * The running order the chart draws its lines in.
   *
   * The saved one, unless the user asked for date order — in which case it is
   * read back off the rows on screen, rolled-up bars and all, so a milestone
   * drawn as a row lands on its own date among them instead of wherever it was
   * once dragged. Only the drawing uses this: everything that edits the order
   * still works on `order`, which is what keeps the manual arrangement intact
   * underneath the sorting.
   */
  const lineOrder = useMemo(() => {
    if (!settings.ganttDateOrder) return order;

    return orderEntriesByDate([
      ...hierarchy.flatMap(({ lines }) =>
        lines.map((line) => dateEntryForRow(line.row))
      ),
      ...rowMilestones(milestones).map((milestone) => ({
        id: milestoneOrderKey(milestone.id),
        start: milestone.date,
        end: milestone.date,
        label: milestone.label,
      })),
    ]);
  }, [hierarchy, milestones, order, settings.ganttDateOrder]);

  /**
   * The lines exactly as the chart draws them — headings, rows and the
   * milestones filed among them, nested, folded and in order.
   *
   * The chart works this out for itself from the same three inputs, so this is
   * the same list rather than a second opinion on it. The export reads it
   * because a picture of the chart has to be a picture of *this* chart: what
   * was filtered out, folded away or dragged into place is what the reader of
   * the exported page should see too.
   */
  const chartLines = useMemo(
    () => buildLines(hierarchyGroups, milestones, lineOrder),
    [hierarchyGroups, milestones, lineOrder]
  );

  /** Milestones marked across the chart rather than filed in the list. */
  const laneFlags = useMemo(() => laneMilestones(milestones), [milestones]);

  // Which tasks decide the finish date, and how much room the rest have. Run
  // over the rows on screen, so filtering the chart re-asks the question of the
  // plan you can actually see rather than of the whole vault.
  const criticalPath = useMemo(
    () =>
      findCriticalPath(
        rows.map((row) => ({
          id: row.task.id,
          incomingLinks: row.task.incomingLinks,
          start: row.bar.start,
          end: row.bar.end,
        })),
        { skipWeekends: settings.ganttSkipWeekends }
      ),
    [rows, settings.ganttSkipWeekends]
  );

  const risksByTaskId = useMemo(
    () =>
      findScheduleRisks(
        rows.map((row) => ({
          id: row.task.id,
          incomingLinks: row.task.incomingLinks,
          status: row.task.status,
          start: row.bar.start,
          end: row.bar.end,
          startInferred: row.bar.startInferred,
          endInferred: row.bar.endInferred,
        })),
        { today }
      ),
    [rows, today]
  );

  // Switching warnings off empties the map rather than threading a flag down:
  // the badge, the row tint, the bar's at-risk border and the count under the
  // chart all read from this one place, so they go quiet together.
  const visibleRisks = settings.ganttShowWarnings ? risksByTaskId : NO_RISKS;

  const timeline = useMemo(
    () =>
      getTimelineRange(
        rows.map((row) => row.bar),
        { today, anchors: milestones.map((milestone) => milestone.date) }
      ),
    [milestones, rows, today]
  );

  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offset = diffDays(timeline.start, today) * scale.dayWidth;
    el.scrollTo({ left: Math.max(0, offset - el.clientWidth / 3) });
  }, [scale.dayWidth, timeline.start, today]);

  // Centre on today the first time rows arrive, not on every reload
  useEffect(() => {
    if (hasCenteredRef.current || rows.length === 0) return;
    hasCenteredRef.current = true;
    scrollToToday();
  }, [rows.length, scrollToToday]);

  // Another view asking us to show a task: select it and scroll it into view
  useEffect(() => {
    const onFocusTask = (event: Event) => {
      const taskId = focusTargetFor(event, GANTT_VIEW_TYPE);
      if (!taskId) return;

      setSelectedTaskId(taskId);
      setSelectedTaskIds(new Set([taskId]));
      setPendingScrollId(taskId);
    };

    window.addEventListener(FOCUS_TASK_EVENT, onFocusTask);
    return () => window.removeEventListener(FOCUS_TASK_EVENT, onFocusTask);
  }, []);

  // Scroll once the row for the focused task exists
  useEffect(() => {
    if (!pendingScrollId) return;
    const row = rows.find((candidate) => candidate.task.id === pendingScrollId);
    if (!row) return;

    setPendingScrollId(null);
    const el = scrollRef.current;
    if (!el) return;

    const offset = diffDays(timeline.start, row.bar.start) * scale.dayWidth;
    el.scrollTo({ left: Math.max(0, offset - el.clientWidth / 3) });
  }, [pendingScrollId, rows, scale.dayWidth, timeline.start]);

  useEffect(() => {
    if (!linkingFromId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLinkingFromId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [linkingFromId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const applyTaskUpdate = useCallback((taskId: string, updated: BaseTask) => {
    setTasks((previous) =>
      previous.map((task) => (task.id === taskId ? updated : task))
    );
  }, []);

  const markSaving = useCallback((taskId: string, saving: boolean) => {
    setSavingTaskIds((previous) => {
      const next = new Set(previous);
      if (saving) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const writeRowDates = useCallback(
    async (row: GanttRow, start: string, end: string): Promise<boolean> => {
      const updated = await row.task.setDates({ start, due: end }, app);
      if (!updated) return false;
      applyTaskUpdate(row.task.id, updated);
      return true;
    },
    [app, applyTaskUpdate]
  );

  /** The dates a task carries now, so an undo can put them back. */
  const capturePreviousDates = useCallback((row: GanttRow) => {
    return {
      taskId: row.task.id,
      start: findTaskDate(row.task.dates, "start"),
      due: findTaskDate(row.task.dates, "due"),
    };
  }, []);

  /** Restores the dates a set of tasks had before an edit. */
  const restoreDates = useCallback(
    async (
      snapshots: Array<{
        taskId: string;
        start: string | null;
        due: string | null;
      }>
    ) => {
      for (const snapshot of snapshots) {
        const task = tasksRef.current.find(
          (candidate) => candidate.id === snapshot.taskId
        );
        if (!task) continue;

        const updated = await task.setDates(
          { start: snapshot.start, due: snapshot.due },
          app
        );
        if (updated) applyTaskUpdate(snapshot.taskId, updated);
      }
    },
    [app, applyTaskUpdate]
  );

  /** Applies one bar edit and writes it, reporting failure to the user. */
  const commitRowDates = useCallback(
    async (row: GanttRow, mode: BarDragResult["mode"], days: number) => {
      const skipWeekends = settings.ganttSkipWeekends;
      const next =
        mode === "move"
          ? shiftBar(row.bar, days, skipWeekends)
          : resizeBar(
              row.bar,
              mode === "resize-start" ? "start" : "end",
              days,
              skipWeekends
            );

      markSaving(row.task.id, true);
      try {
        const ok = await writeRowDates(row, next.start, next.end);
        if (!ok) {
          new Notice(t("gantt.write_failed", { task: row.task.summary }));
        }
      } catch (error) {
        console.error("Failed to write task dates", error);
        new Notice(t("gantt.write_failed", { task: row.task.summary }));
      } finally {
        markSaving(row.task.id, false);
      }
    },
    [markSaving, settings.ganttSkipWeekends, writeRowDates]
  );

  const handleCommit = useCallback(
    async ({ taskId, mode, days, cascade }: BarDragResult) => {
      const row = rows.find((candidate) => candidate.task.id === taskId);
      if (!row) return;

      // Shift-dragging pushes the slip through the rest of the plan, which is
      // the whole point of the gesture — so it wins over the selection, which
      // is a different and more deliberate way of saying which bars move.
      const plan =
        cascade && mode === "move" ? planCascade(taskId, rows, days) : null;

      // Nothing travelled anywhere, so there is nothing to write or undo
      if (plan && plan.movingIds.length === 0) return;

      // Moving one of several selected bars carries the rest along, which is
      // another way to push a slipped date through the tasks that follow it
      const movingTogether =
        !plan &&
        mode === "move" &&
        selectedTaskIds.size > 1 &&
        selectedTaskIds.has(taskId);

      const moving = plan
        ? rows.filter((candidate) => plan.movingIds.includes(candidate.task.id))
        : movingTogether
          ? rows.filter((candidate) => selectedTaskIds.has(candidate.task.id))
          : [row];

      const snapshots = moving.map(capturePreviousDates);

      for (const target of moving) {
        // Each row in a cascade travels its own distance: one held back by a
        // blocker must not drag the tasks waiting on it any further than it got
        const targetDays = plan
          ? (plan.shiftById.get(target.task.id) ?? plan.days)
          : days;
        await commitRowDates(target, mode, targetDays);
      }

      plugin.undoHistory.push({
        label: plan
          ? t("gantt.undo_cascade", { n: moving.length })
          : moving.length > 1
            ? t("gantt.undo_move_many", { n: moving.length })
            : t("gantt.undo_move_one", { task: row.task.summary }),
        undo: () => restoreDates(snapshots),
      });

      if (plan) {
        // One line, however many ways the plan had to give: a drag that was
        // held back *and* left work behind should not stack up notices
        const left = [
          plan.heldIds.length > 0
            ? t("gantt.cascade_held", { n: plan.heldIds.length })
            : null,
          plan.skippedInferredIds.length > 0
            ? t("gantt.cascade_skipped", { n: plan.skippedInferredIds.length })
            : null,
          plan.skippedCompletedIds.length > 0
            ? t("gantt.cascade_skipped_done", {
                n: plan.skippedCompletedIds.length,
              })
            : null,
        ];

        new Notice(
          [t("gantt.cascade_moved", { n: moving.length }), ...left]
            .filter(Boolean)
            .join(" — ")
        );
        return;
      }

      if (moving.length > 1) {
        new Notice(t("gantt.moved_together", { n: moving.length }));
      }
    },
    [
      capturePreviousDates,
      commitRowDates,
      plugin,
      restoreDates,
      rows,
      selectedTaskIds,
    ]
  );

  const handleLabelWidthChange = useCallback(
    (width: number) => {
      void plugin.setGanttLabelWidth(width);
    },
    [plugin]
  );

  const commitOrder = useCallback(
    (nextOrder: string[], label: string) => {
      const previousOrder = order;
      plugin.undoHistory.push({
        label,
        undo: async () => {
          await plugin.setGanttTaskOrder(previousOrder);
        },
      });
      void plugin.setGanttTaskOrder(nextOrder);
    },
    [order, plugin]
  );

  /**
   * Moves a line, task or milestone, to where it was dropped.
   *
   * `visibleParentById` knows nothing about milestones, so a milestone's slot
   * resolves to a parent of `null` — it is a root, it can only land beside
   * other roots, and it can never be dropped inside a parent task's subtree.
   * That is exactly right: a milestone is not a child of anything.
   */
  const handleReorder = useCallback(
    ({ movedId, targetId, placement }: RowReorder) => {
      // Nesting is a change of parent, not of order, and the chart routes it
      // to `onNestInto` instead. Guarded rather than assumed, so the ordering
      // code is never handed a placement it has no meaning for.
      if (placement === "inside") return;

      const next = moveWithinParent(
        order,
        movedId,
        targetId,
        placement,
        visibleParentById
      );

      // A drop outside the row's own parent is refused, and a refused drop is
      // not an edit worth pushing onto the undo stack
      if (next.join("\n") === order.join("\n")) return;

      commitOrder(next, t("gantt.undo_reorder"));
    },
    [commitOrder, order, visibleParentById]
  );

  const handleToggleCollapse = useCallback(
    (taskId: string) => {
      void plugin.setGanttCollapsedTaskIds(
        toggleCollapsed(settings.ganttCollapsedTaskIds, taskId)
      );
    },
    [plugin, settings.ganttCollapsedTaskIds]
  );

  /**
   * Turns date order on or off.
   *
   * On, every line is drawn flat and earliest first — tasks, their children
   * and the milestones among them alike. It has to be flat: nesting decides
   * the order of siblings only, so an indented chart cannot put a child next
   * to an unrelated task that starts the same day, which is the whole of what
   * "sorted by date" means.
   *
   * It stays sorted while it is on, so a date edited on the chart moves its
   * row where it now belongs rather than leaving a list that was sorted once.
   * The manual order is not touched, and turning this off restores it.
   */
  const handleToggleDateOrder = useCallback(() => {
    const next = !settings.ganttDateOrder;

    plugin.undoHistory.push({
      label: next ? t("gantt.undo_sort") : t("gantt.undo_sort_off"),
      undo: async () => {
        await plugin.setGanttDateOrder(!next);
      },
    });
    void plugin.setGanttDateOrder(next);
  }, [plugin, settings.ganttDateOrder]);

  /** Saves a milestone edit, keeping the previous list for undo. */
  const commitMilestones = useCallback(
    (next: GanttMilestone[], label: string) => {
      const previous = milestones;
      plugin.undoHistory.push({
        label,
        undo: async () => {
          await plugin.setGanttMilestones(previous);
        },
      });
      void plugin.setGanttMilestones(next);
    },
    [milestones, plugin]
  );

  const handleAddMilestone = useCallback(async () => {
    const result = await promptForMilestone(app, { defaultDate: today });
    if (result?.action !== "save") return;

    const milestone: GanttMilestone = {
      id: crypto.randomUUID(),
      label: result.draft.label,
      date: result.draft.date,
      display: result.draft.display,
    };

    commitMilestones(
      addMilestone(milestones, milestone),
      t("gantt.undo_milestone_added", { label: milestone.label })
    );
    new Notice(t("gantt.milestone_added", { label: milestone.label }));
  }, [app, commitMilestones, milestones, today]);

  /** Clicking a flag reopens it, for a rename, a new date, or a delete. */
  const handleEditMilestone = useCallback(
    async (milestoneId: string) => {
      const milestone = findMilestone(milestones, milestoneId);
      if (!milestone) return;

      const result = await promptForMilestone(app, {
        initial: {
          label: milestone.label,
          date: milestone.date,
          display: milestone.display,
        },
        defaultDate: today,
      });
      if (!result) return;

      if (result.action === "delete") {
        commitMilestones(
          removeMilestone(milestones, milestoneId),
          t("gantt.undo_milestone_removed", { label: milestone.label })
        );
        new Notice(t("gantt.milestone_removed", { label: milestone.label }));
        return;
      }

      commitMilestones(
        updateMilestone(milestones, milestoneId, result.draft),
        t("gantt.undo_milestone_edited", { label: result.draft.label })
      );
    },
    [app, commitMilestones, milestones, today]
  );

  const handleMoveMilestone = useCallback(
    ({ milestoneId, days }: MilestoneDragResult) => {
      const milestone = findMilestone(milestones, milestoneId);
      if (!milestone) return;

      commitMilestones(
        shiftMilestone(milestones, milestoneId, days),
        t("gantt.undo_milestone_moved", { label: milestone.label })
      );
    },
    [commitMilestones, milestones]
  );

  const {
    canUndo,
    label: undoLabel,
    undo,
  } = useUndoHistory(plugin.undoHistory);

  const handleUndo = useCallback(async () => {
    const undone = await undo();
    if (undone) new Notice(t("gantt.undone", { action: undone }));
  }, [undo]);

  const askForTaskLine = useCallback(async (): Promise<string | null> => {
    const tasksApi = getTasksApi(app);
    const rawLine = await promptForTaskLine(
      app,
      tasksApi ? () => tasksApi.createTaskLineModal() : null
    );
    if (!rawLine) return null;

    const draft = parseTaskLine(rawLine, "");
    if (!draft) {
      new Notice(t("task_create.could_not_read"));
      return null;
    }

    try {
      return await withCompanionNote(
        app,
        {
          enabled: settings.createCompanionNotes,
          folder: settings.companionNoteFolder,
        },
        rawLine,
        draft.summary
      );
    } catch (error) {
      console.error("Could not create companion note", error);
      return rawLine;
    }
  }, [app, settings.companionNoteFolder, settings.createCompanionNotes]);

  /** Writes the ID into the task line so links and ordering survive a reload. */
  const stampTaskId = useCallback(
    async (task: BaseTask) => {
      if (task.type !== "dataview") return;
      await addSignToTaskInFile(
        app.vault,
        task,
        "id",
        task.id,
        settings.linkingStyle
      );
    },
    [app.vault, settings.linkingStyle]
  );

  /* Costing is part of the one task editor now; the row menu opens that. */

  /**
   * Opens the editor for a row.
   *
   * A summary row gets the same dialog with its date fields locked, matching
   * the drag and the resize its bar already refuses: a parent's span is its
   * children's, so a date written here would be one the chart then ignores.
   * Its words, its state and its progress are still its own, so everything
   * else stays editable — a parent task is a task.
   */
  const handleOpenTask = useCallback(
    async (taskId: string) => {
      const row = rows.find((candidate) => candidate.task.id === taskId);
      if (!row) return;

      const summary = summaryTaskIds.has(taskId);

      await openTaskEditor({
        app,
        task: row.task,
        tasks: tasksRef.current,
        settings,
        undoHistory: plugin.undoHistory,
        // What a click on a suggested bar used to write straight to the note.
        // It fills the empty date fields instead, so accepting the schedule
        // the chart proposed is still a click and a save.
        suggested:
          row.inferred && !summary
            ? { start: row.bar.start, due: row.bar.end }
            : null,
        summary,
        onTaskUpdated: (updated) => applyTaskUpdate(taskId, updated),
      });
    },
    [app, applyTaskUpdate, plugin, rows, settings, summaryTaskIds]
  );

  /**
   * Writes a task's parent and reports it, whichever way it was asked for.
   *
   * Shared by the picker and by dragging a row into another, so a nesting made
   * either way lands in the vault the same and undoes the same.
   */
  const applyParentChange = useCallback(
    async (taskId: string, parentId: string | null) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      const previous = task.parentId;
      if (parentId === previous) return;

      const parentRow =
        parentId === null ? null : rows.find((row) => row.task.id === parentId);

      let updated: BaseTask | null;
      try {
        // An inline task with no ID in its line is found by its text, which is
        // ambiguous when two tasks read the same
        await stampTaskId(task);

        // And the parent needs its ID written down too: without one in the
        // file its ID was minted at parse time, so the child would be naming
        // an ID that no longer exists after the next reload
        if (parentRow) await stampTaskId(parentRow.task);

        updated = await task.setParent(parentId, app);
      } catch (error) {
        // Stamping an ID touches two files before the parent is even written,
        // so there is more here than the write itself that can fail. Without
        // this the whole thing failed mutely and the button looked broken.
        console.error("Failed to set the task's parent", error);
        new Notice(t("gantt.parent_failed"));
        return;
      }

      if (!updated) {
        new Notice(t("gantt.parent_failed"));
        return;
      }

      applyTaskUpdate(taskId, updated);

      plugin.undoHistory.push({
        label: t("gantt.undo_set_parent", {
          task: plainTaskText(task.summary),
        }),
        undo: async () => {
          // Read the task afresh: the line has moved on since the edit
          const current =
            tasksRef.current.find((candidate) => candidate.id === taskId) ??
            updated;
          const reverted = await current.setParent(previous, app);
          if (reverted) applyTaskUpdate(taskId, reverted);
        },
      });

      new Notice(
        parentRow
          ? t("gantt.parent_set", {
              task: plainTaskText(task.summary),
              parent: plainTaskText(parentRow.task.summary),
            })
          : t("gantt.parent_cleared", { task: plainTaskText(task.summary) })
      );
    },
    [app, applyTaskUpdate, plugin, rows, stampTaskId, tasks]
  );

  /**
   * Asks which task this one should sit inside, and writes it.
   *
   * The candidate list leaves out the task itself and everything already
   * nested under it — both would make a loop, and while the chart survives one
   * (see `task-hierarchy`) it is not worth letting the user write one from the
   * UI. Descendants are worked out over every row rather than over the current
   * group, because a child filed under a different heading is still a child.
   */
  const handleSetParent = useCallback(
    async (taskId: string) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      const descendants = collectDescendantIds(resolveParentIds(rows), taskId);

      const choices = rows
        .filter(
          (row) => row.task.id !== taskId && !descendants.has(row.task.id)
        )
        .map((row) => ({
          id: row.task.id,
          label: plainTaskText(row.task.summary),
        }));

      const result = await promptForParent(app, {
        taskLabel: plainTaskText(task.summary),
        choices,
      });
      if (!result) return;

      await applyParentChange(taskId, result.parentId);
    },
    [app, applyParentChange, rows, tasks]
  );

  /**
   * Whether one task could be dropped inside another.
   *
   * Asked while a drag is in flight, so it has to be cheap and it has to
   * answer for the structure on screen: a milestone holds nothing, a task
   * cannot go inside itself or inside its own descendants, and a drop that
   * would only restate the parent it already has is not worth offering.
   */
  const canNestInto = useCallback(
    (movedId: string, targetId: string) => {
      if (movedId === targetId) return false;

      const moved = rows.find((row) => row.task.id === movedId);
      const target = rows.find((row) => row.task.id === targetId);
      if (!moved || !target) return false;
      if (moved.task.parentId === targetId) return false;

      return !collectDescendantIds(resolveParentIds(rows), movedId).has(
        targetId
      );
    },
    [rows]
  );

  const handleNestInto = useCallback(
    (movedId: string, targetId: string) => {
      if (!canNestInto(movedId, targetId)) return;
      void applyParentChange(movedId, targetId);
    },
    [applyParentChange, canNestInto]
  );

  /**
   * Adds a task to the chart. With an anchor the line is written just below
   * it and the new row takes the next position; without one the task goes to
   * the end of the list.
   */
  const addTask = useCallback(
    async (anchorId: string | null) => {
      const anchorRow = anchorId
        ? rows.find((row) => row.task.id === anchorId)
        : undefined;

      const targetFile = anchorRow
        ? null
        : resolveDefaultTaskFile(app, visibleTasks);
      if (!anchorRow && !targetFile) {
        new Notice(t("task_create.no_target_note"));
        return;
      }

      const taskLine = await askForTaskLine();
      if (!taskLine) return;

      const linkPath = anchorRow ? anchorRow.task.link : targetFile!.path;
      const newTask = parseTaskLine(taskLine, linkPath);
      if (!newTask) {
        new Notice(t("task_create.could_not_read"));
        return;
      }

      try {
        if (anchorRow) {
          await addTaskLineToVault(anchorRow.task, taskLine, app, "after");
        } else {
          await appendTaskLineToFile(targetFile!, taskLine, app);
        }
        await stampTaskId(newTask);

        setTasks((previous) => [...previous, newTask]);

        // Slot the row in where the user asked for it rather than at the end
        const appended = [...order, newTask.id];
        void plugin.setGanttTaskOrder(
          anchorRow
            ? moveRelativeTo(appended, newTask.id, anchorRow.task.id, "after")
            : appended
        );

        plugin.undoHistory.push({
          label: t("gantt.undo_create", { task: newTask.summary }),
          undo: async () => {
            await newTask.delete(app);
            setTasks((previous) =>
              previous.filter((candidate) => candidate.id !== newTask.id)
            );
          },
        });

        new Notice(t("gantt.task_added"));
      } catch (error) {
        console.error("Failed to add task from the Gantt", error);
        new Notice(t("task_create.failed"));
      }
    },
    [app, askForTaskLine, order, plugin, rows, stampTaskId, visibleTasks]
  );

  /** Tags in use, most common first, so the picker suggests the usual ones. */
  const allTags = useMemo(() => {
    const frequency = new Map<string, number>();
    tasks.forEach((task) =>
      task.tags.forEach((tag) =>
        frequency.set(tag, (frequency.get(tag) ?? 0) + 1)
      )
    );
    return Array.from(frequency.keys()).sort((a, b) => {
      const byCount = (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0);
      if (byCount !== 0) return byCount;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  }, [tasks]);

  /** Adds or removes a tag, updating the row without a full reload. */
  const changeTag = useCallback(
    async (taskId: string, tag: string, add: boolean) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      if (add && task.tags.includes(tag)) return;

      const nextTags = add
        ? [...task.tags, tag]
        : task.tags.filter((existing) => existing !== tag);

      // Optimistic: the vault write is slower than the eye
      setTasks((previous) =>
        previous.map((candidate) =>
          candidate.id === taskId
            ? withTaskChanges(candidate, { tags: nextTags })
            : candidate
        )
      );

      try {
        if (add) {
          await addTagToTaskInVault(task, tag, app);
        } else {
          await removeTagFromTaskInVault(task, tag, app);
        }

        plugin.undoHistory.push({
          label: add
            ? t("gantt.undo_tag_added", { tag })
            : t("gantt.undo_tag_removed", { tag }),
          undo: async () => {
            const current = tasksRef.current.find(
              (candidate) => candidate.id === taskId
            );
            if (!current) return;

            if (add) {
              await removeTagFromTaskInVault(current, tag, app);
            } else {
              await addTagToTaskInVault(current, tag, app);
            }

            setTasks((previous) =>
              previous.map((candidate) =>
                candidate.id === taskId
                  ? withTaskChanges(candidate, { tags: task.tags })
                  : candidate
              )
            );
          },
        });
      } catch (error) {
        console.error("Could not change the task's tags", error);
        new Notice(t("gantt.tag_failed"));
        setTasks((previous) =>
          previous.map((candidate) =>
            candidate.id === taskId
              ? withTaskChanges(candidate, { tags: task.tags })
              : candidate
          )
        );
      }
    },
    [app, plugin, tasks]
  );

  const handleStartLink = useCallback((taskId: string) => {
    setLinkingFromId((previous) => (previous === taskId ? null : taskId));
  }, []);

  /**
   * Completes a dependency: the source must finish before the target starts.
   * Written with the same ⛔/🆔 metadata the map uses, so the link shows up
   * there too on its next reload.
   */
  const completeLink = useCallback(
    async (targetId: string) => {
      const fromId = linkingFromId;
      setLinkingFromId(null);
      if (!fromId || fromId === targetId) return;

      const fromTask = tasks.find((task) => task.id === fromId);
      const toTask = tasks.find((task) => task.id === targetId);
      if (!fromTask || !toTask) return;

      if (toTask.incomingLinks.includes(fromId)) {
        new Notice(t("gantt.link_exists"));
        return;
      }

      try {
        await addLinkSignsBetweenTasks(
          app.vault,
          fromTask,
          toTask,
          settings.linkingStyle
        );

        setTasks((previous) =>
          previous.map((task) =>
            task.id === targetId
              ? withTaskChanges(task, {
                  incomingLinks: [...task.incomingLinks, fromId],
                })
              : task
          )
        );

        plugin.undoHistory.push({
          label: t("gantt.undo_link", {
            from: fromTask.summary,
            to: toTask.summary,
          }),
          undo: async () => {
            await removeLinkSignsBetweenTasks(app.vault, toTask, fromId);
            setTasks((previous) =>
              previous.map((task) =>
                task.id === targetId
                  ? withTaskChanges(task, {
                      incomingLinks: task.incomingLinks.filter(
                        (id) => id !== fromId
                      ),
                    })
                  : task
              )
            );
          },
        });

        new Notice(
          t("gantt.link_created", {
            from: fromTask.summary,
            to: toTask.summary,
          })
        );
      } catch (error) {
        console.error("Failed to link tasks", error);
        new Notice(t("gantt.link_failed"));
      }
    },
    [app.vault, linkingFromId, plugin, settings.linkingStyle, tasks]
  );

  const handleSelect = useCallback(
    (taskId: string, toggle = false, additive = false) => {
      if (linkingFromId) {
        void completeLink(taskId);
        return;
      }

      if (additive) {
        setSelectedTaskIds((previous) => {
          const next = new Set(previous);
          if (next.has(taskId)) {
            next.delete(taskId);
          } else {
            next.add(taskId);
          }
          return next;
        });
        setSelectedTaskId(taskId);
        return;
      }

      setSelectedTaskId((previous) => {
        const cleared = toggle && previous === taskId;
        setSelectedTaskIds(cleared ? new Set() : new Set([taskId]));
        return cleared ? null : taskId;
      });
    },
    [completeLink, linkingFromId]
  );

  const handleApplyInferred = useCallback(async () => {
    if (inferredRows.length === 0 || applying) return;

    setApplying(true);
    let written = 0;
    let failed = 0;

    for (const row of inferredRows) {
      try {
        const ok = await writeRowDates(row, row.bar.start, row.bar.end);
        if (ok) {
          written += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        console.error("Failed to write inferred dates", error);
        failed += 1;
      }
    }

    setApplying(false);
    new Notice(
      failed === 0
        ? t("gantt.applied_inferred", { n: written })
        : t("gantt.applied_inferred_partial", { n: written, failed })
    );
  }, [applying, inferredRows, writeRowDates]);

  /**
   * The chart as a picture, for a document.
   *
   * The drawing is built from scratch rather than captured off the screen, so
   * it can be plainer than the view it comes from: no hover controls, no
   * selection, no theme colours, and the whole timeline fitted to the page
   * instead of a slice of it. What it keeps is what a reader needs — the
   * order, the nesting, the states, today, the milestones and a key.
   */
  const handleExport = useCallback(async () => {
    if (exporting) return;
    if (chartLines.length === 0) {
      new Notice(t("gantt.export_empty"));
      return;
    }

    const vaultName = app.vault.getName();
    const draft = await promptForGanttExport(app, {
      ...exportDraft,
      title: exportDraft.title || vaultName,
    });
    if (!draft) return;

    setExportDraft(draft);
    setExporting(true);

    const title = draft.title || vaultName;

    try {
      const lines: GanttExportLine[] = chartLines.map((line) => {
        if (line.kind === "header") {
          return { kind: "heading", label: line.label, count: line.count };
        }
        if (line.kind === "milestone") {
          return {
            kind: "milestone",
            label: line.milestone.label,
            date: line.milestone.date,
          };
        }

        const { task, bar, inferred } = line.row;
        return {
          kind: "task",
          id: task.id,
          label: plainTaskText(task.summary),
          depth: line.depth,
          start: bar.start,
          end: bar.end,
          // The reading the chart shows, so a task carrying progress but still
          // ticked off as to-do exports as underway, the way it looks on screen
          status: effectiveTaskStatus(task.status, task.progress),
          percent: task.progress.percent,
          inferred,
          rollup: line.hasChildren,
          critical:
            settings.showCriticalPath && criticalPath.criticalIds.has(task.id),
        };
      });

      // The span the plan actually covers, rather than the padded range the
      // chart is drawn over: the subtitle is a claim about the work
      const dates = [
        ...lines.flatMap((line) =>
          line.kind === "task"
            ? [line.start, line.end]
            : line.kind === "milestone"
              ? [line.date]
              : []
        ),
        ...laneFlags.map((milestone) => milestone.date),
      ];
      const first = dates.reduce(
        (earliest, date) => (diffDays(earliest, date) < 0 ? date : earliest),
        dates[0] ?? timeline.start
      );
      const last = dates.reduce(
        (latest, date) => (diffDays(latest, date) > 0 ? date : latest),
        dates[0] ?? timeline.end
      );

      const image = buildGanttSvg({
        title,
        subtitle: t("gantt.export_subtitle", {
          n: rows.length,
          start: formatExportDate(first),
          end: formatExportDate(last),
        }),
        footer: t("gantt.export_footer", {
          vault: vaultName,
          date: formatExportDate(today),
        }),
        lines,
        laneMilestones: laneFlags.map((milestone) => ({
          label: milestone.label,
          date: milestone.date,
        })),
        timelineStart: timeline.start,
        timelineEnd: timeline.end,
        today,
        labels: {
          today: t("gantt.legend_today"),
          statuses: {
            todo: t("gantt.legend_todo"),
            in_progress: t("gantt.legend_in_progress"),
            done: t("gantt.legend_done"),
            canceled: t("gantt.legend_canceled"),
          },
          suggested: t("gantt.legend_suggested"),
          summary: t("gantt.legend_summary"),
          milestone: t("gantt.legend_milestone"),
          critical: t("gantt.legend_critical"),
        },
        options: {
          paper: draft.paper,
          pixelRatio: draft.pixelRatio,
          showToday: draft.showToday,
        },
      });

      const result = await exportGanttPng(
        app,
        image,
        exportFileName(title, today),
        draft.pixelRatio
      );

      new Notice(
        result.copied
          ? t("gantt.export_done_copied", {
              file: result.file.name,
              width: result.width,
              height: result.height,
            })
          : t("gantt.export_done", {
              file: result.file.name,
              width: result.width,
              height: result.height,
            })
      );
    } catch (error) {
      console.error("Could not export the Gantt chart", error);
      new Notice(t("gantt.export_failed"));
    } finally {
      setExporting(false);
    }
  }, [
    app,
    chartLines,
    criticalPath.criticalIds,
    exportDraft,
    exporting,
    laneFlags,
    rows.length,
    settings.showCriticalPath,
    timeline.end,
    timeline.start,
    today,
  ]);

  if (isLoading) {
    return (
      <div className="project-planner-loading-container">
        <div className="project-planner-spinner" />
        <div className="project-planner-loading-text">{t("gantt.loading")}</div>
      </div>
    );
  }

  return (
    <div className="project-planner-gantt-container">
      <GanttToolbar
        scale={scale}
        onScaleChange={setScale}
        onScrollToToday={scrollToToday}
        onReload={() => loadTasks({ notify: true })}
        onApplyInferred={() => void handleApplyInferred()}
        inferredCount={inferredRows.length}
        applying={applying}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        hideCompleted={hideCompleted}
        onHideCompletedChange={setHideCompleted}
        skipWeekends={settings.ganttSkipWeekends}
        onSkipWeekendsChange={(skip) => void plugin.setGanttSkipWeekends(skip)}
        showCriticalPath={settings.showCriticalPath}
        onShowCriticalPathChange={(show) =>
          void plugin.setShowCriticalPath(show)
        }
        taskCount={rows.length}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        dateOrder={settings.ganttDateOrder}
        onToggleDateOrder={handleToggleDateOrder}
        onAddTask={() => void addTask(null)}
        onAddMilestone={() => void handleAddMilestone()}
        onExport={() => void handleExport()}
        exporting={exporting}
        onUndoOrder={() => void handleUndo()}
        canUndoOrder={canUndo}
        undoLabel={undoLabel}
      />

      {linkingFromId && (
        <div className="project-planner-gantt-linking">
          {t("gantt.linking_hint", {
            task:
              rows.find((row) => row.task.id === linkingFromId)?.task.summary ??
              "",
          })}
          <button
            className="project-planner-gantt-linking__cancel"
            onClick={() => setLinkingFromId(null)}
          >
            {t("gantt.linking_cancel")}
          </button>
        </div>
      )}

      {/* A milestone is reason enough to draw the chart: a plan can be a set
          of dates to hit before any task has been written down, and hiding
          them behind "no tasks" would lose work the user can see no other
          way. */}
      {rows.length === 0 && rowMilestones(milestones).length === 0 ? (
        <div className="project-planner-gantt-empty">
          {tasks.length === 0 ? t("gantt.empty") : t("gantt.empty_filtered")}
        </div>
      ) : (
        <GanttChart
          groups={hierarchyGroups}
          rows={rows}
          dependencies={dependencies}
          timelineStart={timeline.start}
          timelineEnd={timeline.end}
          today={today}
          scale={scale}
          app={app}
          palette={settings.tagColorPalette}
          colorOverrides={settings.tagColorOverrides}
          showTags={settings.showTags}
          criticalIds={criticalPath.criticalIds}
          criticalEdgeKeys={criticalPath.criticalEdgeKeys}
          floatByTaskId={criticalPath.floatByTaskId}
          showCriticalPath={settings.showCriticalPath}
          risksByTaskId={visibleRisks}
          selectedTaskIds={selectedTaskIds}
          highlight={highlight}
          savingTaskIds={savingTaskIds}
          onSelect={handleSelect}
          onCommit={(result) => void handleCommit(result)}
          onOpenTask={(taskId) => void handleOpenTask(taskId)}
          onReorder={handleReorder}
          /* Date order decides the running order, so a row dropped somewhere
             else would snap straight back: the handles go quiet rather than
             promise a move that cannot hold. */
          reorderable={!settings.ganttDateOrder}
          canNestInto={canNestInto}
          onNestInto={handleNestInto}
          onAddTaskAfter={(taskId) => void addTask(taskId)}
          onStartLink={handleStartLink}
          onShowInMap={(taskId) => void plugin.focusTaskInMap(taskId)}
          onToggleCollapse={handleToggleCollapse}
          onSetParent={(taskId) => void handleSetParent(taskId)}
          onEditFinance={
            settings.financeEnabled
              ? (taskId) => void handleOpenTask(taskId)
              : undefined
          }
          onAddTag={(taskId, tag) => void changeTag(taskId, tag, true)}
          onRemoveTag={(taskId, tag) => void changeTag(taskId, tag, false)}
          milestones={milestones}
          order={lineOrder}
          onMoveMilestone={handleMoveMilestone}
          onEditMilestone={(milestoneId) =>
            void handleEditMilestone(milestoneId)
          }
          allTags={allTags}
          linkingFromId={linkingFromId}
          scrollRef={scrollRef}
          labelWidth={settings.ganttLabelWidth}
          onLabelWidthChange={handleLabelWidthChange}
        />
      )}

      <div className="project-planner-gantt-footer">
        <GanttLegend showCriticalPath={settings.showCriticalPath} />
        {settings.showCriticalPath && criticalPath.projectFinish && (
          <div className="project-planner-gantt-hint">
            {t("gantt.critical_path_hint", {
              finish: criticalPath.projectFinish,
              n: criticalPath.criticalIds.size,
            })}
          </div>
        )}
        {visibleRisks.size > 0 && (
          <div className="project-planner-gantt-hint project-planner-gantt-hint--warning">
            {t("gantt.at_risk_hint", { n: visibleRisks.size })}
          </div>
        )}
        {selectedTaskIds.size > 1 && (
          <div className="project-planner-gantt-hint">
            {t("gantt.moved_together_hint", { n: selectedTaskIds.size })}
          </div>
        )}
        {inferredRows.length > 0 && (
          <div className="project-planner-gantt-hint">
            {t("gantt.inferred_hint", { n: inferredRows.length })}
          </div>
        )}
      </div>
    </div>
  );
}

export { ROW_HEIGHT };
