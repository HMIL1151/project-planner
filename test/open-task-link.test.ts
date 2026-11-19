import { App, WorkspaceLeaf } from "./mocks/obsidian";
import { openTaskLink } from "../src/lib/open-task-link";

const NOTE = "Tasks/Build the rig.md";

describe("openTaskLink", () => {
  let app: App;

  beforeEach(() => {
    app = new App();
    app.vault.setFileContent(NOTE, "# Build the rig");
  });

  it("opens the note when nothing is showing it yet", async () => {
    await openTaskLink(app, NOTE);

    expect(app.workspace.openedLinks).toEqual([NOTE]);
    expect(app.workspace.revealed).toBeNull();
  });

  it("reuses the tab already showing the note", async () => {
    const other = new WorkspaceLeaf("Tasks/Something else.md");
    const wanted = new WorkspaceLeaf(NOTE);
    app.workspace.leaves.push(other, wanted);

    await openTaskLink(app, NOTE);

    expect(app.workspace.revealed).toBe(wanted);
    expect(app.workspace.activated).toBe(wanted);
    // A second tab for a note already in front of the user is the bug here
    expect(app.workspace.openedLinks).toEqual([]);
  });

  it("reuses a tab Obsidian has not loaded yet", async () => {
    const deferred = new WorkspaceLeaf(NOTE, false);
    app.workspace.leaves.push(deferred);

    await openTaskLink(app, NOTE);

    expect(app.workspace.activated).toBe(deferred);
    expect(app.workspace.openedLinks).toEqual([]);
  });

  it("throws when the note has gone from the vault", async () => {
    await expect(openTaskLink(app, "Tasks/Deleted.md")).rejects.toThrow(
      "File not found: Tasks/Deleted.md"
    );
  });
});
