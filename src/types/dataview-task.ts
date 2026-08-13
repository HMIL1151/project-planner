import { App, Vault } from "obsidian";
import { BaseTask } from "./base-task";
import { TaskStatus } from "./task";
import { TaskInsertPosition, TaskDateUpdate } from "./base-task";
import { findTaskDate, getTaskDateProperties } from "../lib/task-dates";
import {
  findTaskLineByIdOrText,
  statusSymbols,
  addDateToTask,
  removeDateFromTask,
  getTodayDate,
  addSignToTaskInFile,
  removeSignFromTaskInFile,
  parseTaskLine,
} from "../lib/utils";
import {
  EMOJI_ID_REMOVAL,
  DATAVIEW_BRACKET_ID_REMOVAL,
  DATAVIEW_PARENTHESES_ID_REMOVAL,
  TAG_REMOVAL,
  WHITESPACE_NORMALIZE,
} from "../lib/task-regex";
import { TaskFinance, writeFinanceToTaskLine } from "../lib/task-finance";
import { clampProgress, writeProgressToTaskLine } from "../lib/task-progress";
import { normalizeParentId, writeParentToTaskLine } from "../lib/task-parent";

/**
 * Dataview-style task that stores metadata inline in the task text
 */
export class DataviewTask extends BaseTask {
  readonly type = "dataview" as const;

  async updateStatus(newStatus: TaskStatus, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // TODO: Verify if the escape is really useless here (or change this parsing completely). It was added by the linter, but it seems necessary for correct regex.
      lines[taskLineIdx] = lines[taskLineIdx].replace(
        /\[([ x/\-])\]/, // eslint-disable-line no-useless-escape -- escape required for correct character class behavior
        statusSymbols[newStatus]
      );

      // Add done timestamp
      if (newStatus === "done") {
        lines[taskLineIdx] = addDateToTask(
          lines[taskLineIdx],
          "done",
          getTodayDate()
        );
      }
      // Delete done timestamp, and record when work began — but only for a
      // task that has not already been given a start date. A task planned to
      // start next month has been answered that question already, and the
      // answer is the plan; overwriting it with today would quietly pull the
      // task forward on every chart that draws it.
      else if (newStatus === "in_progress") {
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "done");
        const planned = findTaskDate(
          getTaskDateProperties(lines[taskLineIdx]),
          "start"
        );
        if (!planned) {
          lines[taskLineIdx] = addDateToTask(
            lines[taskLineIdx],
            "start",
            getTodayDate()
          );
        }
      }
      // Delete canceled and done timestamp
      else if (newStatus === "todo") {
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "canceled");
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "done");
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "start");
      }

      return lines.join("\n");
    });
  }

  async setDates(dates: TaskDateUpdate, app: App): Promise<BaseTask | null> {
    if (!this.link || !this.text) return null;
    const vault = app?.vault;
    if (!vault) return null;
    const file = vault.getFileByPath(this.link);
    if (!file) return null;

    // Held in an object so the assignment inside the callback survives
    // TypeScript's control-flow narrowing
    const written: { line: string | null } = { line: null };

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      let line = lines[taskLineIdx];
      for (const [type, date] of Object.entries(dates)) {
        if (date === undefined) continue;
        line =
          date === null
            ? removeDateFromTask(line, type)
            : addDateToTask(line, type, date);
      }

      lines[taskLineIdx] = line;
      written.line = line;
      return lines.join("\n");
    });

    const updatedLine = written.line;
    if (!updatedLine) return null;

    const updatedTask = parseTaskLine(updatedLine, this.link);
    if (!updatedTask) return null;

    // The line keeps its ID, but re-parsing a line without one would mint a
    // random replacement and orphan the task's dependencies.
    if (!updatedLine.includes(updatedTask.id)) {
      updatedTask.id = this.id;
    }
    updatedTask.projects = this.projects;
    return updatedTask;
  }

  async setFinance(finance: TaskFinance, app: App): Promise<BaseTask | null> {
    if (!this.link || !this.text) return null;
    const vault = app?.vault;
    if (!vault) return null;
    const file = vault.getFileByPath(this.link);
    if (!file) return null;

    // Held in an object so the assignment inside the callback survives
    // TypeScript's control-flow narrowing
    const written: { line: string | null } = { line: null };

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      const line = writeFinanceToTaskLine(lines[taskLineIdx], finance);
      lines[taskLineIdx] = line;
      written.line = line;
      return lines.join("\n");
    });

    const updatedLine = written.line;
    if (!updatedLine) return null;

    const updatedTask = parseTaskLine(updatedLine, this.link);
    if (!updatedTask) return null;

    // The line keeps its ID, but re-parsing a line without one would mint a
    // random replacement and orphan the task's dependencies.
    if (!updatedLine.includes(updatedTask.id)) {
      updatedTask.id = this.id;
    }
    updatedTask.projects = this.projects;
    return updatedTask;
  }

  async setProgress(
    progress: number | null,
    app: App
  ): Promise<BaseTask | null> {
    if (!this.link || !this.text) return null;
    const vault = app?.vault;
    if (!vault) return null;
    const file = vault.getFileByPath(this.link);
    if (!file) return null;

    const percent = clampProgress(progress);

    // Held in an object so the assignment inside the callback survives
    // TypeScript's control-flow narrowing
    const written: { line: string | null } = { line: null };

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      const line = writeProgressToTaskLine(lines[taskLineIdx], { percent });
      lines[taskLineIdx] = line;
      written.line = line;
      return lines.join("\n");
    });

    const updatedLine = written.line;
    if (!updatedLine) return null;

    const updatedTask = parseTaskLine(updatedLine, this.link);
    if (!updatedTask) return null;

    // The line keeps its ID, but re-parsing a line without one would mint a
    // random replacement and orphan the task's dependencies.
    if (!updatedLine.includes(updatedTask.id)) {
      updatedTask.id = this.id;
    }
    updatedTask.projects = this.projects;
    return updatedTask;
  }

  async setParent(parentId: string | null, app: App): Promise<BaseTask | null> {
    if (!this.link || !this.text) return null;
    const vault = app?.vault;
    if (!vault) return null;
    const file = vault.getFileByPath(this.link);
    if (!file) return null;

    const id = normalizeParentId(parentId);

    // Held in an object so the assignment inside the callback survives
    // TypeScript's control-flow narrowing
    const written: { line: string | null } = { line: null };

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      const line = writeParentToTaskLine(lines[taskLineIdx], id);
      lines[taskLineIdx] = line;
      written.line = line;
      return lines.join("\n");
    });

    const updatedLine = written.line;
    if (!updatedLine) return null;

    const updatedTask = parseTaskLine(updatedLine, this.link);
    if (!updatedTask) return null;

    // The line keeps its ID, but re-parsing a line without one would mint a
    // random replacement and orphan the task's dependencies.
    if (!updatedLine.includes(updatedTask.id)) {
      updatedTask.id = this.id;
    }
    updatedTask.projects = this.projects;
    return updatedTask;
  }

  async addTaskLine(
    newTaskLine: string,
    app: App,
    position: TaskInsertPosition = "after"
  ): Promise<void> {
    if (!this.link) {
      console.log("!task.link: ", newTaskLine);
      return;
    }
    const vault = app?.vault;
    if (!vault) {
      console.log("!vault: ", newTaskLine);
      return;
    }
    const file = vault.getFileByPath(this.link);
    if (!file) {
      console.log("!file: ", newTaskLine);
      return;
    }

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        console.log("taskLineIdx === -1: ", newTaskLine);
        return fileContent;
      }

      const insertIdx =
        position === "before"
          ? taskLineIdx
          : Math.min(taskLineIdx + 1, lines.length);
      lines.splice(insertIdx, 0, newTaskLine);

      return lines.join("\n");
    });
  }

  async delete(app: App): Promise<void> {
    if (!this.link) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Remove the task line
      lines.splice(taskLineIdx, 1);
      return lines.join("\n");
    });
  }

  async addStar(app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Add star emoji if not present
      if (!lines[taskLineIdx].includes("⭐")) {
        lines[taskLineIdx] = lines[taskLineIdx] + " ⭐";
      }
      return lines.join("\n");
    });
  }

  async removeStar(app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Remove star emoji
      lines[taskLineIdx] = lines[taskLineIdx].replace(/\s*⭐\s*/g, " ").trim();
      return lines.join("\n");
    });
  }

  async addTag(tagToAdd: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      let taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        // Fallback: try to find by matching core task text
        const coreTaskText = this.text
          .replace(EMOJI_ID_REMOVAL, "")
          .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
          .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
          .replace(TAG_REMOVAL, "")
          .replace(WHITESPACE_NORMALIZE, " ")
          .trim();

        taskLineIdx = lines.findIndex((line: string) => {
          const coreLineText = line
            .replace(EMOJI_ID_REMOVAL, "")
            .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
            .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
            .replace(TAG_REMOVAL, "")
            .replace(WHITESPACE_NORMALIZE, " ")
            .trim();
          return (
            coreLineText.includes(coreTaskText) ||
            coreTaskText.includes(coreLineText)
          );
        });

        if (taskLineIdx === -1) return fileContent;
      }

      const currentLine = lines[taskLineIdx];

      // Check if tag already exists (check for #tag or #tag/subtag)
      const tagPattern = new RegExp(
        `(^|\\s)#${tagToAdd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|\\s|$)`
      );
      if (tagPattern.test(currentLine)) {
        // Tag already exists, don't add it again
        return fileContent;
      }

      // Add the tag at the end
      lines[taskLineIdx] = currentLine + " #" + tagToAdd;

      return lines.join("\n");
    });
  }

  async removeTag(tagToRemove: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);

      let taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        // Fallback: try to find by matching core task text
        const coreTaskText = this.text
          .replace(EMOJI_ID_REMOVAL, "")
          .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
          .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
          .replace(TAG_REMOVAL, "")
          .replace(WHITESPACE_NORMALIZE, " ")
          .trim();

        taskLineIdx = lines.findIndex((line: string) => {
          const coreLineText = line
            .replace(EMOJI_ID_REMOVAL, "")
            .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
            .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
            .replace(TAG_REMOVAL, "")
            .replace(WHITESPACE_NORMALIZE, " ")
            .trim();
          return (
            coreLineText.includes(coreTaskText) ||
            coreTaskText.includes(coreLineText)
          );
        });

        if (taskLineIdx === -1) return fileContent;
      }

      const currentLine = lines[taskLineIdx];
      const tagPattern = new RegExp(
        `\\s*#${tagToRemove.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/\\S*)?(?=\\s|$)`,
        "g"
      );

      const newLine = currentLine
        .replace(tagPattern, "")
        .replace(/\s+/g, " ")
        .trim();

      lines[taskLineIdx] = newLine;

      return lines.join("\n");
    });
  }

  async addLinkMetadata(
    vault: Vault,
    fromTask: BaseTask,
    linkingStyle: "individual" | "csv" | "dataview" = "individual"
  ): Promise<void> {
    const id = fromTask.id;
    await addSignToTaskInFile(vault, fromTask, "id", id, linkingStyle);
    await addSignToTaskInFile(vault, this, "stop", id, linkingStyle);
  }

  async removeLinkMetadata(vault: Vault, hash: string): Promise<void> {
    await removeSignFromTaskInFile(vault, this, "stop", hash);
  }
}
