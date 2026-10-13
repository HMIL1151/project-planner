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
import { TaskStatus } from "src/types/task";
import {
  addTagToTaskInVault,
  addSignToTaskInFile,
  appendTaskLineToFile,
  getAllTasks,
  getTasksApi,
  parseTaskLine,
  removeTagFromTaskInVault,
  resolveDefaultTaskFile,
} from "src/lib/utils";
import { todayIso } from "src/lib/date-utils";
import { moveRelativeTo, normalizeOrderIds } from "src/lib/gantt-order";
import {
  DateBucketKey,
  KanbanBucket,
  KanbanChange,
  KanbanGroupBy,
  assignSolePerson,
  bucketKeyFor,
  buildBuckets,
  orderTasksByDue,
  retagForBucket,
  taskDueDate,
  taskStartDate,
  taskTag,
} from "src/lib/kanban-buckets";
import { withTaskChanges } from "src/lib/task-write";
import { openTaskEditor } from "src/lib/open-task-editor";
import { plainTaskText } from "src/lib/task-text";
import { withCompanionNote } from "src/lib/companion-note";
import { useUndoHistory } from "src/hooks/use-undo-history";
import { promptForTaskLine } from "src/components/task-line-modal";
import { DropPlacement, CardCallbacks } from "src/components/kanban-card";
import { KanbanColumn } from "src/components/kanban-column";
import { KanbanToolbar } from "src/components/kanban-toolbar";
import { ProjectPlannerSettings } from "src/types/settings";
import ProjectPlannerPlugin from "../main";
import { t } from "../i18n";

interface KanbanViewProps {
  settings: ProjectPlannerSettings;
  plugin: ProjectPlannerPlugin;
}

/** What a card is doing while it is in the air. */
interface DragState {
  taskId: string;
  /** The column under the pointer, or null before it is over one. */
  columnKey: string | null;
  /** The card under the pointer, when the pointer is over one. */
  cardId: string | null;
  placement: DropPlacement | null;
}

const STATUS_CYCLE: TaskStatus[] = ["todo", "in_progress", "done"];

/** How a bucket is remembered between sessions: grouping first, so switching
 * grouping does not collapse a column that merely shares a name. */
function collapseKey(groupBy: KanbanGroupBy, bucketKey: string): string {
  return `${groupBy}:${bucketKey}`;
}

/** Whether a drag is already showing exactly this landing place. */
function sameLanding(
  drag: DragState | null,
  next: Partial<DragState>
): boolean {
  if (!drag) return false;
  return (
    drag.columnKey === (next.columnKey ?? null) &&
    drag.cardId === (next.cardId ?? null) &&
    drag.placement === (next.placement ?? null)
  );
}

export default function KanbanView({ settings, plugin }: KanbanViewProps) {
  const app = useApp();
  const [tasks, setTasks] = useState<BaseTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

  // Undo runs long after its action, so it reads tasks through a ref
  const tasksRef = useRef<BaseTask[]>([]);

  // Recomputed per render so a long-open board rolls over at midnight
  const today = todayIso();
  const groupBy = settings.kanbanGroupBy;

  const loadTasks = useCallback(
    (options: { notify?: boolean } = {}) => {
      setIsLoading(true);
      window.setTimeout(() => {
        setTasks(getAllTasks(app, settings.taskSource));
        setIsLoading(false);
        if (options.notify) new Notice(t("kanban.reloaded"));
      }, 0);
    },
    [app, settings.taskSource]
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

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

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
        task.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        task.finance.allocations.some(({ person }) =>
          person.toLowerCase().includes(query)
        )
      );
    });
  }, [tasks, searchQuery, hideCompleted]);

  /**
   * The running order of every card, filtered ones included: a card hidden by
   * a search still has a place to come back to.
   */
  const cardOrder = useMemo(
    () =>
      normalizeOrderIds(
        tasks.map((task) => task.id),
        settings.kanbanCardOrder
      ),
    [settings.kanbanCardOrder, tasks]
  );

  const labels = useMemo(
    () => ({
      status: (status: TaskStatus) => t(`kanban.status_${status}`),
      due: (key: DateBucketKey) => t(`kanban.due_${key}`),
      start: (key: DateBucketKey) => t(`kanban.start_${key}`),
      priority: (value: string) => t("kanban.priority", { symbol: value }),
      noTag: t("kanban.no_tag"),
      noPerson: t("kanban.no_person"),
      noProject: t("kanban.no_project"),
      noPriority: t("kanban.no_priority"),
    }),
    []
  );

  const buckets = useMemo(
    () =>
      buildBuckets(visibleTasks, groupBy, {
        today,
        labels,
        order: cardOrder,
      }),
    [cardOrder, groupBy, labels, today, visibleTasks]
  );

  const collapsed = useMemo(
    () => new Set(settings.kanbanCollapsedBuckets),
    [settings.kanbanCollapsedBuckets]
  );

  const anyCollapsed = useMemo(
    () =>
      buckets.some((bucket) => collapsed.has(collapseKey(groupBy, bucket.key))),
    [buckets, collapsed, groupBy]
  );

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

  /** The task as it stands now: an undo runs long after the edit it reverses. */
  const currentTask = useCallback(
    (taskId: string, fallback: BaseTask) =>
      tasksRef.current.find((candidate) => candidate.id === taskId) ?? fallback,
    []
  );

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

  /**
   * Writes what a drop into a column means, and hands back the way to put it
   * back.
   *
   * Every grouping that takes drops writes one field, so this is the whole of
   * the board's vault interface: a card moved, a status cycled and a tag
   * removed all come through here and all land on the undo stack the same way.
   * A null return means nothing was written.
   */
  const writeChange = useCallback(
    async (
      task: BaseTask,
      change: KanbanChange
    ): Promise<(() => Promise<void>) | null> => {
      const taskId = task.id;

      // An inline task with no ID in its line is found by its text, which is
      // ambiguous when two tasks read the same
      await stampTaskId(task);

      switch (change.field) {
        case "status": {
          const previous = task.status;
          if (previous === change.status) return null;

          await task.updateStatus(change.status, app);
          applyTaskUpdate(
            taskId,
            withTaskChanges(task, { status: change.status })
          );

          return async () => {
            const current = currentTask(taskId, task);
            await current.updateStatus(previous, app);
            applyTaskUpdate(
              taskId,
              withTaskChanges(current, { status: previous })
            );
          };
        }

        case "due": {
          const previous = taskDueDate(task);
          if (previous === change.due) return null;

          const updated = await task.setDates({ due: change.due }, app);
          if (!updated) return null;
          applyTaskUpdate(taskId, updated);

          return async () => {
            const current = currentTask(taskId, updated);
            const reverted = await current.setDates({ due: previous }, app);
            if (reverted) applyTaskUpdate(taskId, reverted);
          };
        }

        case "start": {
          const previous = taskStartDate(task);
          if (previous === change.start) return null;

          const updated = await task.setDates({ start: change.start }, app);
          if (!updated) return null;
          applyTaskUpdate(taskId, updated);

          return async () => {
            const current = currentTask(taskId, updated);
            const reverted = await current.setDates({ start: previous }, app);
            if (reverted) applyTaskUpdate(taskId, reverted);
          };
        }

        case "person": {
          const previous = task.finance;
          const updated = await task.setFinance(
            assignSolePerson(previous, change.person),
            app
          );
          if (!updated) return null;
          applyTaskUpdate(taskId, updated);

          return async () => {
            const current = currentTask(taskId, updated);
            const reverted = await current.setFinance(previous, app);
            if (reverted) applyTaskUpdate(taskId, reverted);
          };
        }

        case "tag": {
          const from = taskTag(task);
          if (from === (change.tag ?? "")) return null;

          const previousTags = task.tags;
          const nextTags = retagForBucket(previousTags, from, change.tag);

          if (change.tag && !previousTags.includes(change.tag)) {
            await addTagToTaskInVault(task, change.tag, app);
          }
          if (from) await removeTagFromTaskInVault(task, from, app);
          applyTaskUpdate(taskId, withTaskChanges(task, { tags: nextTags }));

          return async () => {
            const current = currentTask(taskId, task);
            if (from) await addTagToTaskInVault(current, from, app);
            if (change.tag && !previousTags.includes(change.tag)) {
              await removeTagFromTaskInVault(current, change.tag, app);
            }
            applyTaskUpdate(
              taskId,
              withTaskChanges(current, { tags: previousTags })
            );
          };
        }
      }
    },
    [app, applyTaskUpdate, currentTask, stampTaskId]
  );

  const commitOrder = useCallback(
    (nextOrder: string[]) => {
      void plugin.setKanbanCardOrder(nextOrder);
    },
    [plugin]
  );

  /**
   * Moves a card: to another column, to another place in its own, or both at
   * once.
   *
   * One gesture is one entry on the undo stack even when it did two things, so
   * taking back a card dragged across the board puts its field and its place
   * in the column back together.
   */
  const moveCard = useCallback(
    async (
      taskId: string,
      bucket: KanbanBucket,
      targetId: string | null,
      placement: DropPlacement
    ) => {
      const task = tasksRef.current.find(
        (candidate) => candidate.id === taskId
      );
      if (!task || targetId === taskId) return;

      const previousOrder = cardOrder;
      const anchor =
        targetId ??
        // Dropped on the column rather than on a card: land at the bottom
        [...bucket.tasks].reverse().find((candidate) => candidate.id !== taskId)
          ?.id ??
        null;

      const nextOrder = anchor
        ? moveRelativeTo(
            cardOrder,
            taskId,
            anchor,
            targetId ? placement : "after"
          )
        : previousOrder;

      const moved = bucket.key !== bucketKeyFor(task, groupBy, today);
      if (!moved && nextOrder.join("\n") === previousOrder.join("\n")) return;

      commitOrder(nextOrder);

      if (!moved || !bucket.change) {
        plugin.undoHistory.push({
          label: t("kanban.undo_reorder"),
          undo: async () => {
            await plugin.setKanbanCardOrder(previousOrder);
          },
        });
        return;
      }

      markSaving(taskId, true);
      try {
        const revert = await writeChange(task, bucket.change);

        plugin.undoHistory.push({
          label: t("kanban.undo_move", {
            task: plainTaskText(task.summary),
            bucket: bucket.label,
          }),
          undo: async () => {
            await revert?.();
            await plugin.setKanbanCardOrder(previousOrder);
          },
        });
      } catch (error) {
        console.error("Could not move the card", error);
        new Notice(
          t("kanban.move_failed", { task: plainTaskText(task.summary) })
        );
        commitOrder(previousOrder);
      } finally {
        markSaving(taskId, false);
      }
    },
    [cardOrder, commitOrder, groupBy, markSaving, plugin, today, writeChange]
  );

  /** Cycles to do → in progress → done, the way the map's checkbox does. */
  const handleCycleStatus = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find(
        (candidate) => candidate.id === taskId
      );
      if (!task) return;

      const index = STATUS_CYCLE.indexOf(task.status);
      const next = STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];

      markSaving(taskId, true);
      try {
        const revert = await writeChange(task, {
          field: "status",
          status: next,
        });
        if (!revert) return;

        plugin.undoHistory.push({
          label: t("kanban.undo_status", {
            task: plainTaskText(task.summary),
          }),
          undo: revert,
        });
      } catch (error) {
        console.error("Could not change the task status", error);
        new Notice(t("kanban.status_failed"));
      } finally {
        markSaving(taskId, false);
      }
    },
    [markSaving, plugin, writeChange]
  );

  const handleRemoveTag = useCallback(
    async (taskId: string, tag: string) => {
      const task = tasksRef.current.find(
        (candidate) => candidate.id === taskId
      );
      if (!task) return;

      const previousTags = task.tags;

      // Optimistic: the vault write is slower than the eye
      applyTaskUpdate(
        taskId,
        withTaskChanges(task, {
          tags: previousTags.filter((existing) => existing !== tag),
        })
      );

      try {
        await removeTagFromTaskInVault(task, tag, app);

        plugin.undoHistory.push({
          label: t("kanban.undo_tag_removed", { tag }),
          undo: async () => {
            const current = currentTask(taskId, task);
            await addTagToTaskInVault(current, tag, app);
            applyTaskUpdate(
              taskId,
              withTaskChanges(current, { tags: previousTags })
            );
          },
        });
      } catch (error) {
        console.error("Could not remove the tag", error);
        new Notice(t("kanban.tag_failed"));
        applyTaskUpdate(taskId, withTaskChanges(task, { tags: previousTags }));
      }
    },
    [app, applyTaskUpdate, currentTask, plugin]
  );

  const handleOpenTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find(
        (candidate) => candidate.id === taskId
      );
      if (!task) return;

      markSaving(taskId, true);
      try {
        await openTaskEditor({
          app,
          task,
          tasks: tasksRef.current,
          settings,
          undoHistory: plugin.undoHistory,
          onTaskUpdated: (updated) => applyTaskUpdate(taskId, updated),
        });
      } finally {
        markSaving(taskId, false);
      }
    },
    [app, applyTaskUpdate, markSaving, plugin, settings]
  );

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

  /**
   * Adds a card. Asked for from a column header, the new task is given
   * whatever that column stands for, so a card added under "Tomorrow" is due
   * tomorrow without a second dialog.
   */
  const addTask = useCallback(
    async (bucketKey: string | null) => {
      const targetFile = resolveDefaultTaskFile(app, tasks);
      if (!targetFile) {
        new Notice(t("task_create.no_target_note"));
        return;
      }

      const taskLine = await askForTaskLine();
      if (!taskLine) return;

      const newTask = parseTaskLine(taskLine, targetFile.path);
      if (!newTask) {
        new Notice(t("task_create.could_not_read"));
        return;
      }

      try {
        await appendTaskLineToFile(targetFile, taskLine, app);
        await stampTaskId(newTask);
        setTasks((previous) => [...previous, newTask]);
        // The ref is written by hand as well as through state: the column's
        // change is applied in the same tick, and it looks the task up here
        tasksRef.current = [...tasksRef.current, newTask];

        const bucket = buckets.find((candidate) => candidate.key === bucketKey);
        if (bucket?.change) await writeChange(newTask, bucket.change);

        plugin.undoHistory.push({
          label: t("kanban.undo_create", {
            task: plainTaskText(newTask.summary),
          }),
          undo: async () => {
            await newTask.delete(app);
            setTasks((previous) =>
              previous.filter((candidate) => candidate.id !== newTask.id)
            );
          },
        });

        new Notice(t("kanban.task_added"));
      } catch (error) {
        console.error("Failed to add a task from the board", error);
        new Notice(t("task_create.failed"));
      }
    },
    [app, askForTaskLine, buckets, plugin, stampTaskId, tasks, writeChange]
  );

  const handleSortByDue = useCallback(() => {
    const previousOrder = cardOrder;
    commitOrder(orderTasksByDue(tasks));

    plugin.undoHistory.push({
      label: t("kanban.undo_sort"),
      undo: async () => {
        await plugin.setKanbanCardOrder(previousOrder);
      },
    });
  }, [cardOrder, commitOrder, plugin, tasks]);

  const handleToggleCollapse = useCallback(
    (bucketKey: string) => {
      const key = collapseKey(groupBy, bucketKey);
      const next = collapsed.has(key)
        ? settings.kanbanCollapsedBuckets.filter((entry) => entry !== key)
        : [...settings.kanbanCollapsedBuckets, key];
      void plugin.setKanbanCollapsedBuckets(next);
    },
    [collapsed, groupBy, plugin, settings.kanbanCollapsedBuckets]
  );

  const handleToggleAllColumns = useCallback(() => {
    const mine = buckets.map((bucket) => collapseKey(groupBy, bucket.key));
    const others = settings.kanbanCollapsedBuckets.filter(
      (key) => !mine.includes(key)
    );
    void plugin.setKanbanCollapsedBuckets(
      anyCollapsed ? others : [...others, ...mine]
    );
  }, [anyCollapsed, buckets, groupBy, plugin, settings.kanbanCollapsedBuckets]);

  const handleGroupByChange = useCallback(
    (next: KanbanGroupBy) => {
      void plugin.setKanbanGroupBy(next);
    },
    [plugin]
  );

  const {
    canUndo,
    label: undoLabel,
    undo,
  } = useUndoHistory(plugin.undoHistory);

  const handleUndo = useCallback(async () => {
    const undone = await undo();
    if (undone) new Notice(t("kanban.undone", { action: undone }));
  }, [undo]);

  /**
   * A drag reported through a ref as well as through state.
   *
   * `dragover` fires continuously, so the state is only touched when the
   * landing place actually changes — and the drop handlers read the ref, which
   * is current whether or not the last dragover was worth a render.
   */
  const dragRef = useRef<DragState | null>(null);

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const cardCallbacks: CardCallbacks = useMemo(
    () => ({
      onSelect: setSelectedTaskId,
      onOpen: (taskId) => void handleOpenTask(taskId),
      onCycleStatus: (taskId) => void handleCycleStatus(taskId),
      onDragStart: (taskId) =>
        updateDrag({ taskId, columnKey: null, cardId: null, placement: null }),
      onDragEnd: () => updateDrag(null),
      onDragOverCard: (taskId, placement) => {
        const current = dragRef.current;
        if (!current || sameLanding(current, { cardId: taskId, placement })) {
          return;
        }
        updateDrag({ ...current, cardId: taskId, placement, columnKey: null });
      },
      onDropOnCard: (taskId, placement) => {
        const current = dragRef.current;
        updateDrag(null);
        if (!current) return;

        const bucket = buckets.find((candidate) =>
          candidate.tasks.some((task) => task.id === taskId)
        );
        if (bucket) void moveCard(current.taskId, bucket, taskId, placement);
      },
      onRemoveTag: (taskId, tag) => void handleRemoveTag(taskId, tag),
    }),
    [
      buckets,
      handleCycleStatus,
      handleOpenTask,
      handleRemoveTag,
      moveCard,
      updateDrag,
    ]
  );

  const handleDragOverColumn = useCallback(
    (bucketKey: string) => {
      const current = dragRef.current;
      if (!current || sameLanding(current, { columnKey: bucketKey })) return;
      updateDrag({
        ...current,
        columnKey: bucketKey,
        cardId: null,
        placement: null,
      });
    },
    [updateDrag]
  );

  const handleDropOnColumn = useCallback(
    (bucketKey: string) => {
      const current = dragRef.current;
      updateDrag(null);
      if (!current) return;

      const bucket = buckets.find((candidate) => candidate.key === bucketKey);
      if (bucket) void moveCard(current.taskId, bucket, null, "after");
    },
    [buckets, moveCard, updateDrag]
  );

  if (isLoading) {
    return (
      <div className="project-planner-loading-container">
        <div className="project-planner-spinner" />
        <div className="project-planner-loading-text">
          {t("kanban.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="project-planner-kanban-container">
      <KanbanToolbar
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        hideCompleted={hideCompleted}
        onHideCompletedChange={setHideCompleted}
        onSortByDue={handleSortByDue}
        onAddTask={() => void addTask(null)}
        onReload={() => loadTasks({ notify: true })}
        onUndo={() => void handleUndo()}
        canUndo={canUndo}
        undoLabel={undoLabel}
        taskCount={visibleTasks.length}
        anyCollapsed={anyCollapsed}
        onToggleAllColumns={handleToggleAllColumns}
      />

      {/* Columns are only worth drawing once there is something to put in
          them: four empty status columns are a worse answer to an empty vault
          than saying so. */}
      {visibleTasks.length === 0 ? (
        <div className="project-planner-kanban-empty">
          {tasks.length === 0 ? t("kanban.empty") : t("kanban.empty_filtered")}
        </div>
      ) : (
        <div className="project-planner-kanban-board">
          {buckets.map((bucket) => (
            <KanbanColumn
              key={bucket.key}
              bucket={bucket}
              app={app}
              today={today}
              collapsed={collapsed.has(collapseKey(groupBy, bucket.key))}
              draggingTaskId={drag?.taskId ?? null}
              dropTargetId={drag?.cardId ?? null}
              dropPlacement={drag?.placement ?? null}
              dropAtEnd={drag?.columnKey === bucket.key}
              selectedTaskId={selectedTaskId}
              savingTaskIds={savingTaskIds}
              cardCallbacks={cardCallbacks}
              showTags={settings.showTags}
              palette={settings.tagColorPalette}
              colorOverrides={settings.tagColorOverrides}
              onToggleCollapse={handleToggleCollapse}
              onAddCard={(bucketKey) => void addTask(bucketKey)}
              onDragOverColumn={handleDragOverColumn}
              onDropOnColumn={handleDropOnColumn}
            />
          ))}
        </div>
      )}
    </div>
  );
}
