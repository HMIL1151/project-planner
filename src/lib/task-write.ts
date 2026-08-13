/**
 * Writing a whole task edit, and redrawing one without a reload.
 *
 * Both editing views — the timeline and the board — offer the same dialog and
 * have to write it back the same way, so the sequence lives here rather than
 * once in each view. What stays in the views is the part that is theirs: the
 * optimistic redraw, the rollback, and the undo entry.
 */

import { App } from "obsidian";
import { BaseTask, TaskDateUpdate } from "src/types/base-task";
import { TaskStatus } from "src/types/task";
import { TaskDateProperty } from "./task-dates";
import { TaskProgress } from "./task-progress";
import { setTaskTextInVault } from "./utils";

/** Fields a view can swap on a task without re-reading it from the vault. */
export interface TaskFieldChanges {
  summary?: string;
  status?: TaskStatus;
  tags?: string[];
  dates?: TaskDateProperty[];
  progress?: TaskProgress;
  incomingLinks?: string[];
}

/**
 * A copy of a task with a few fields swapped.
 *
 * An optimistic redraw needs a new object — React compares by identity — that
 * is still a real `DataviewTask` or `NoteTask` with all its methods, so the
 * prototype is carried over rather than spread away.
 */
export function withTaskChanges(
  task: BaseTask,
  changes: TaskFieldChanges
): BaseTask {
  return Object.assign(
    Object.create(Object.getPrototypeOf(task)),
    task,
    changes
  ) as BaseTask;
}

/**
 * Everything the task dialog can change. Structurally the modal's draft, named
 * here so a module under `lib` does not have to reach into a component for a
 * type.
 */
export interface TaskEditFields {
  /** The words on the task line, with its metadata already taken off. */
  text: string;
  status: TaskStatus;
  /** `null` clears the date. */
  start: string | null;
  due: string | null;
  /** Whole percent, or `null` for a task carrying no progress at all. */
  progress: number | null;
}

/** The dates a task carries, with start and due replaced by a draft's. */
export function datesFromDraft(
  dates: TaskDateProperty[],
  draft: TaskEditFields
): TaskDateProperty[] {
  const next = dates.filter(
    (entry) => entry.type !== "start" && entry.type !== "due"
  );
  if (draft.start) next.push({ type: "start", date: draft.start });
  if (draft.due) next.push({ type: "due", date: draft.due });
  return next;
}

/**
 * The dates a write has to lay down, given what the draft changed.
 *
 * The dialog shows the dates, so the dialog decides them: whatever its two
 * fields hold when it is saved is what the task ends up with, and an empty
 * field means no date. Nothing else in the write may add one.
 *
 * That rule is here because `updateStatus` stamps dates of its own — moving an
 * inline task to in progress sets its start to today. A stamp is right for the
 * quick toggles, where the status is all the user touched and nothing on
 * screen says otherwise. It is wrong here, because typing a percentage moves
 * the status by itself: a task due next month, with progress typed against it,
 * would come back scheduled to start this morning. So whenever the status
 * moved, both dates are written afterwards exactly as the dialog had them, and
 * the stamp is undone.
 *
 * The completion date `updateStatus` writes is untouched by this — it records
 * what happened rather than proposing a plan, and it is not a field the dialog
 * offers.
 */
export function datesForEdit(
  draft: TaskEditFields,
  previous: TaskEditFields
): TaskDateUpdate | null {
  const datesChanged =
    draft.start !== previous.start || draft.due !== previous.due;
  const statusChanged = draft.status !== previous.status;

  if (!datesChanged && !statusChanged) return null;

  return { start: draft.start, due: draft.due };
}

/**
 * Writes one task edit: the words, the state, the two dates and the progress,
 * in that order and only where something actually changed.
 *
 * The order matters. Setting a task in progress stamps a start date and
 * finishing one stamps a completion date, so the status goes first and the
 * dates go over the top — otherwise a status change would quietly overrule the
 * date beside it in the same dialog. `datesForEdit` decides which those are.
 *
 * Returns the task as the vault now has it, so the caller can show what the
 * file says rather than what the dialog hoped. A write that fails throws, and
 * the caller is left to put its optimistic redraw back.
 */
export async function applyTaskEdit(
  app: App,
  task: BaseTask,
  draft: TaskEditFields,
  previous: TaskEditFields
): Promise<BaseTask> {
  let current: BaseTask = task;

  if (draft.status !== previous.status) {
    await current.updateStatus(draft.status, app);
    current = withTaskChanges(current, { status: draft.status });
  }

  const dates = datesForEdit(draft, previous);
  if (dates) {
    const dated = await current.setDates(dates, app);
    if (!dated) throw new Error("dates could not be written");
    current = dated;
  }

  // Only an inline task's words live on a line this can rewrite
  if (task.type === "dataview" && draft.text !== previous.text) {
    const renamed = await setTaskTextInVault(current, draft.text, app);
    if (!renamed) throw new Error("task text could not be written");
    current = renamed;
  }

  if (draft.progress !== previous.progress) {
    const progressed = await current.setProgress(draft.progress, app);
    if (!progressed) throw new Error("progress could not be written");
    current = progressed;
  }

  return current;
}

/** Whether a draft asks for any change at all. */
export function taskEditChanged(
  draft: TaskEditFields,
  previous: TaskEditFields
): boolean {
  return (
    draft.text !== previous.text ||
    draft.status !== previous.status ||
    draft.start !== previous.start ||
    draft.due !== previous.due ||
    draft.progress !== previous.progress
  );
}
