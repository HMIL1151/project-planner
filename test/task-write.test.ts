import { App } from "./mocks/obsidian";
import { DataviewTask } from "../src/types/dataview-task";
import {
  TaskEditFields,
  applyTaskEdit,
  datesForEdit,
  datesFromDraft,
  taskEditChanged,
} from "../src/lib/task-write";
import { TaskDateProperty } from "../src/lib/task-dates";
import { getTodayDate } from "../src/lib/utils";

function makeTask(text: string): DataviewTask {
  return new DataviewTask({
    id: "abc123",
    summary: "Ship the thing",
    text,
    tags: [],
    status: "todo",
    priority: "",
    link: "tasks/test.md",
    incomingLinks: [],
    starred: false,
  });
}

function fields(overrides: Partial<TaskEditFields> = {}): TaskEditFields {
  return {
    text: "Ship the thing",
    status: "todo",
    start: null,
    due: null,
    progress: null,
    ...overrides,
  };
}

describe("datesForEdit", () => {
  it("writes both dates as typed when the user edited them", () => {
    const previous = fields({ start: "2099-01-01", due: "2099-01-10" });
    const draft = fields({ start: "2099-02-01", due: "2099-02-10" });

    expect(datesForEdit(draft, previous)).toEqual({
      start: "2099-02-01",
      due: "2099-02-10",
    });
  });

  it("clears a date the user emptied", () => {
    const previous = fields({ start: "2099-01-01" });
    const draft = fields({ start: null });

    expect(datesForEdit(draft, previous)).toEqual({ start: null, due: null });
  });

  it("puts the start back when only the status moved", () => {
    const previous = fields({ start: "2099-01-01", due: "2099-01-10" });
    const draft = fields({
      start: "2099-01-01",
      due: "2099-01-10",
      status: "in_progress",
    });

    expect(datesForEdit(draft, previous)).toEqual({
      start: "2099-01-01",
      due: "2099-01-10",
    });
  });

  // The shape most tasks actually have: a deadline and no start date. The
  // status stamp has nothing to overwrite, so it has to be cleared instead.
  it("keeps a due-only task free of a start date", () => {
    const previous = fields({ due: "2099-01-10" });
    const draft = fields({ due: "2099-01-10", status: "in_progress" });

    expect(datesForEdit(draft, previous)).toEqual({
      start: null,
      due: "2099-01-10",
    });
  });

  it("writes nothing when neither the dates nor the status moved", () => {
    const previous = fields({ start: "2099-01-01" });
    const draft = fields({ start: "2099-01-01", progress: 40 });

    expect(datesForEdit(draft, previous)).toBeNull();
  });
});

describe("applyTaskEdit", () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  /**
   * The bug this guards: typing a percentage moves the status to in progress,
   * and an inline task moved to in progress is stamped with today's start
   * date. A task scheduled for next year must stay scheduled for next year.
   */
  it("keeps a future start date when only the progress was edited", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123 🛫 2099-01-01 📅 2099-01-10";
    app.vault.setFileContent("tasks/test.md", line);

    const previous = fields({ start: "2099-01-01", due: "2099-01-10" });
    const draft = { ...previous, status: "in_progress" as const, progress: 40 };

    await applyTaskEdit(app, makeTask(line), draft, previous);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).toContain("🛫 2099-01-01");
    expect(updated).not.toContain(getTodayDate());
    expect(updated).toContain("[/]");
    expect(updated).toContain("progress:: 40");
  });

  it("keeps a future start date when the task is put back to todo", async () => {
    const line = "- [/] Ship the thing 🆔 abc123 🛫 2099-01-01";
    app.vault.setFileContent("tasks/test.md", line);

    const previous = fields({ start: "2099-01-01", status: "in_progress" });
    const draft = { ...previous, status: "todo" as const, progress: null };

    await applyTaskEdit(app, makeTask(line), draft, previous);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).toContain("🛫 2099-01-01");
    expect(updated).toContain("[ ]");
  });

  /**
   * The shape most tasks have: a deadline, no start date. The status stamp has
   * no plan to overwrite here, so the dialog's empty start field clears it —
   * otherwise the bar would jump from its deadline back to today.
   */
  it("does not give a due-only task a start date", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123 📅 2099-01-10";
    app.vault.setFileContent("tasks/test.md", line);

    const previous = fields({ due: "2099-01-10" });
    const draft = fields({
      due: "2099-01-10",
      status: "in_progress",
      progress: 40,
    });

    await applyTaskEdit(app, makeTask(line), draft, previous);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).not.toContain("🛫");
    expect(updated).not.toContain(getTodayDate());
    expect(updated).toContain("📅 2099-01-10");
    expect(updated).toContain("progress:: 40");
  });

  it("writes the dates the user typed over the status stamp", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123 🛫 2099-01-01";
    app.vault.setFileContent("tasks/test.md", line);

    const previous = fields({ start: "2099-01-01" });
    const draft = fields({ start: "2099-03-01", status: "in_progress" });

    await applyTaskEdit(app, makeTask(line), draft, previous);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).toContain("🛫 2099-03-01");
    expect(updated).not.toContain("2099-01-01");
  });
});

/**
 * The same protection one level down, for the surfaces that change a status
 * without a dialog: the board's columns and the graph's status toggle.
 */
describe("DataviewTask.updateStatus", () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  it("keeps a planned start date when work begins", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123 🛫 2099-01-01";
    app.vault.setFileContent("tasks/test.md", line);

    await makeTask(line).updateStatus("in_progress", app);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).toContain("🛫 2099-01-01");
    expect(updated).not.toContain(getTodayDate());
    expect(updated).toContain("[/]");
  });

  it("keeps a planned start written in dataview form", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123 [start::2099-01-01]";
    app.vault.setFileContent("tasks/test.md", line);

    await makeTask(line).updateStatus("in_progress", app);

    const updated = app.vault.getFileContent("tasks/test.md");
    expect(updated).toContain("2099-01-01");
    expect(updated).not.toContain(getTodayDate());
  });

  it("still records a start for a task that had none", async () => {
    const line = "- [ ] Ship the thing 🆔 abc123";
    app.vault.setFileContent("tasks/test.md", line);

    await makeTask(line).updateStatus("in_progress", app);

    expect(app.vault.getFileContent("tasks/test.md")).toContain(
      `🛫 ${getTodayDate()}`
    );
  });
});

describe("taskEditChanged", () => {
  it("is false for a dialog opened and closed again", () => {
    const previous = fields({ start: "2099-01-01", progress: 40 });
    expect(taskEditChanged({ ...previous }, previous)).toBe(false);
  });

  it("is true when only the progress moved", () => {
    const previous = fields({ progress: 40 });
    expect(taskEditChanged(fields({ progress: 60 }), previous)).toBe(true);
  });
});

describe("datesFromDraft", () => {
  it("replaces start and due and leaves every other date alone", () => {
    const dates: TaskDateProperty[] = [
      { type: "start", date: "2099-01-01" },
      { type: "due", date: "2099-01-10" },
      { type: "done", date: "2098-12-31" },
    ];

    expect(
      datesFromDraft(dates, fields({ start: "2099-02-01", due: null }))
    ).toEqual([
      { type: "done", date: "2098-12-31" },
      { type: "start", date: "2099-02-01" },
    ]);
  });
});
