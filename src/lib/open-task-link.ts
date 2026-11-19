import { App, FileView, TFile, WorkspaceLeaf } from "obsidian";

/**
 * The tab already showing `filePath`, if the vault has one open.
 *
 * A tab Obsidian has not got round to loading yet has no view to ask, so its
 * file only shows up in the view state. Checking both is what stops a second
 * tab opening for a note the user already has in front of them.
 */
function findLeafWithFile(app: App, filePath: string): WorkspaceLeaf | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const fileView = leaf.view as FileView;
    if (fileView?.file && fileView.file.path === filePath) return leaf;

    const state = leaf.getViewState();
    if (state?.state?.file === filePath) return leaf;
  }

  return null;
}

/**
 * Opens the note a task lives in, reusing its tab when one is already open.
 *
 * Shared by the link button on a graph node, a board card and an open
 * question, and by the Gantt row's action menu, so all four land on the same
 * tab rather than each opening one of their own. Throws when the path no
 * longer resolves — a task whose note has been moved or deleted — which is
 * the caller's to report, since only it knows where to put the message.
 */
export async function openTaskLink(app: App, link: string): Promise<void> {
  const abstractFile = app.vault.getAbstractFileByPath(link);

  if (!(abstractFile instanceof TFile)) {
    throw new Error(`File not found: ${link}`);
  }

  const existingLeaf = findLeafWithFile(app, link);

  if (existingLeaf) {
    await app.workspace.revealLeaf(existingLeaf);
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
    return;
  }

  await app.workspace.openLinkText(link, link);
}
