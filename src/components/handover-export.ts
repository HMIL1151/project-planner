/**
 * Turning a vault into a handover pack.
 *
 * Everything here is the impure half of the feature: reading the vault,
 * rendering Markdown through Obsidian's own renderer, and handing the finished
 * document to Chromium to print. The decisions about what the pack *says* live
 * in `src/lib/handover/`, which is testable; this file is the part that has to
 * touch the world.
 *
 * The PDF is produced by loading the generated HTML into an off-screen Electron
 * window and calling `printToPDF`. That is the whole trick, and it is what makes
 * the output searchable: Chromium lays out real text and emits real text, so
 * the recipient gets a document they can search, select and copy from, not a
 * stack of pictures of pages. It also means the PDF's bookmark outline is just
 * the document's heading tree, and that links between sections keep working.
 *
 * Three things are load-bearing about how this is written:
 *
 * - **Nothing imports a Node module.** The manifest says the plugin is not
 *   desktop-only, so a top-level `require("fs")` would take the plugin down on
 *   mobile at load time — before any of this could check where it is running.
 *   The temporary HTML therefore goes through Obsidian's own vault adapter, and
 *   Electron is reached through `window.require`, which is simply absent on
 *   mobile and on any desktop build that has locked it away.
 *
 * - **There is always a fallback.** If Electron cannot be reached, the HTML is
 *   written into the vault instead and the user is told to print it from a
 *   browser. That produces the same searchable PDF by hand, so a missing API
 *   costs a step rather than the feature.
 *
 * - **The off-screen window never runs scripts.** A vault's notes can contain
 *   arbitrary HTML, and this document is assembled from all of them at once.
 *   `javascript: false` means none of it executes.
 */

import {
  App,
  Component,
  FileSystemAdapter,
  MarkdownRenderer,
  Notice,
  TFile,
  arrayBufferToBase64,
  normalizePath,
} from "obsidian";
import { ProjectPlannerSettings } from "src/types/settings";
import { BaseTask } from "src/types/base-task";
import { getAllTasks } from "src/lib/utils";
import { buildGanttRows } from "src/lib/gantt-rows";
import { buildHierarchy } from "src/lib/task-hierarchy";
import { getTimelineRange } from "src/lib/gantt-schedule";
import { findCriticalPath } from "src/lib/critical-path";
import { laneMilestones, milestoneStatus } from "src/lib/gantt-milestones";
import { getAllOpenQuestions } from "src/lib/open-question-vault";
import { readRateBook } from "src/lib/rate-book-note";
import { buildCostReport, groupCosts } from "src/lib/finance-summary";
import { CostIssue } from "src/lib/task-cost";
import { todayIso } from "src/lib/date-utils";
import { plainTaskText } from "src/lib/task-text";
import {
  GanttExportLine,
  buildGanttSvg,
  formatExportDate,
} from "src/lib/gantt-export";
import {
  HandoverNote,
  HandoverPack,
  HandoverQuestion,
  buildFinance,
  buildSummary,
  buildTaskRows,
  noteAnchor,
  sortNotes,
} from "src/lib/handover/handover-model";
import {
  HandoverGraphEdge,
  HandoverGraphNode,
  buildDependencyGraphs,
} from "src/lib/handover/handover-graph";
import { buildHandoverHtml } from "src/lib/handover/handover-html";
import { HandoverDraft } from "./handover-export-modal";
import { handoverLabels } from "./handover-labels";
import { t } from "../i18n";

/* -------------------------------------------------------------------------- */
/* Electron, reached carefully                                                */
/* -------------------------------------------------------------------------- */

interface PrintToPdfOptions {
  printBackground: boolean;
  preferCSSPageSize: boolean;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  /** Electron 30+ builds the bookmark tree from the heading levels. */
  generateDocumentOutline?: boolean;
}

interface ElectronWebContents {
  printToPDF(_options: PrintToPdfOptions): Promise<Uint8Array>;
}

interface ElectronBrowserWindow {
  webContents: ElectronWebContents;
  loadFile(_path: string): Promise<void>;
  destroy(): void;
}

interface ElectronRemote {
  BrowserWindow: new (
    _options: Record<string, unknown>
  ) => ElectronBrowserWindow;
}

interface RequireWindow extends Window {
  require?: (_module: string) => unknown;
}

/**
 * Electron's remote module, or null when it cannot be had.
 *
 * Null on mobile, null when Obsidian has been built without it, and null if
 * reaching for it throws — all three are the same answer to the caller, which
 * is "print this yourself".
 */
function getElectronRemote(): ElectronRemote | null {
  try {
    const load = (window as RequireWindow).require;
    if (typeof load !== "function") return null;

    const electron = load("electron") as { remote?: ElectronRemote } | null;
    const remote = electron?.remote;

    return remote && typeof remote.BrowserWindow === "function" ? remote : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

/** Frontmatter is metadata, not prose; the register already carries it. */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * A vault image as a `data:` URI.
 *
 * The pack is one file that has to survive being emailed, so nothing may point
 * at anything outside itself. Anything that cannot be read is simply dropped —
 * a missing picture is not a reason to lose the note it was in.
 */
async function imageDataUri(app: App, file: TFile): Promise<string | null> {
  const mime = IMAGE_MIME[file.extension.toLowerCase()];
  if (!mime) return null;

  try {
    const bytes = await app.vault.readBinary(file);
    return `data:${mime};base64,${arrayBufferToBase64(bytes)}`;
  } catch {
    return null;
  }
}

/**
 * Rewrites a rendered note so it works with nothing but itself.
 *
 * Obsidian's renderer leaves behind links and embeds that mean something only
 * inside the app: `app://` image sources, embeds that fill in asynchronously,
 * and internal links pointing at vault paths. Each one is turned into
 * something a PDF can honour, or into plain text when it cannot be.
 */
async function inlineNoteHtml(
  app: App,
  root: HTMLElement,
  sourcePath: string,
  anchorByPath: Map<string, string>
): Promise<void> {
  // Embeds first: an image embed becomes a picture, and a note embed becomes a
  // cross-reference, because the note it points at is elsewhere in this pack
  const embeds = Array.from(
    root.querySelectorAll<HTMLElement>(".internal-embed")
  );
  for (const embed of embeds) {
    const src = embed.getAttribute("src");
    const target = src
      ? app.metadataCache.getFirstLinkpathDest(src, sourcePath)
      : null;

    if (!target) {
      embed.replaceWith(
        embed.ownerDocument.createTextNode(src ? `[${src}]` : "")
      );
      continue;
    }

    if (target.extension.toLowerCase() === "md") {
      const anchor = anchorByPath.get(target.path);
      // `ownerDocument.createElement`, not Obsidian's `createEl`, because this
      // node is about to replace `embed` inside the document that owns it.
      // `createEl` builds in the main document and would leave the insertion
      // relying on implicit adoption. Same reasoning as the createTextNode
      // calls either side of this.
      const link = embed.ownerDocument.createElement("a");
      link.textContent = target.basename;

      if (anchor) link.setAttribute("href", `#${anchor}`);
      else link.className = "internal-link hp-dead";

      embed.replaceWith(link);
      continue;
    }

    const uri = await imageDataUri(app, target);
    if (!uri) {
      embed.replaceWith(embed.ownerDocument.createTextNode(`[${target.name}]`));
      continue;
    }

    // Same document-ownership reasoning as the anchor above.
    const image = embed.ownerDocument.createElement("img");
    image.setAttribute("src", uri);
    image.setAttribute("alt", target.basename);
    embed.replaceWith(image);
  }

  // Images written the ordinary Markdown way, whose src is still a vault path
  const images = Array.from(root.querySelectorAll("img"));
  for (const image of images) {
    const src = image.getAttribute("src") ?? "";
    if (src.startsWith("data:")) continue;

    const cleaned = decodeURIComponent(
      src.replace(/^app:\/\/[^/]*\//, "").split("?")[0]
    );
    const target =
      app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath) ??
      app.vault.getFileByPath(normalizePath(cleaned));

    const uri = target ? await imageDataUri(app, target) : null;
    if (uri) image.setAttribute("src", uri);
    else image.remove();
  }

  // Internal links: to the appendix entry when the note is in the pack, and
  // to nothing at all when it is not — a dead link that still looks live is
  // the one outcome worse than plain text
  const links = Array.from(
    root.querySelectorAll<HTMLElement>("a.internal-link")
  );
  for (const link of links) {
    const href = link.getAttribute("data-href") ?? link.getAttribute("href");
    const target = href
      ? app.metadataCache.getFirstLinkpathDest(href, sourcePath)
      : null;
    const anchor = target ? anchorByPath.get(target.path) : undefined;

    link.removeAttribute("data-href");
    if (anchor) {
      link.setAttribute("href", `#${anchor}`);
      continue;
    }

    link.removeAttribute("href");
    link.addClass("hp-dead");
  }

  // Anything else that reaches outside the document
  root.querySelectorAll("script, iframe, object, embed").forEach((node) => {
    node.remove();
  });
}

/**
 * Every note in the vault, rendered.
 *
 * Obsidian's own renderer is used rather than a Markdown library of our own,
 * because the vault's callouts, tables, task lists and maths are what the
 * recipient is being handed and a second-best rendering of them would be a
 * different document. It needs a DOM and it is asynchronous, which is why this
 * lives here and not in `lib/`.
 */
async function renderVaultNotes(
  app: App,
  owner: Component,
  onProgress: (_done: number, _total: number) => void
): Promise<HandoverNote[]> {
  const files = app.vault.getMarkdownFiles();
  const anchorByPath = new Map(
    files.map((file) => [file.path, noteAnchor(file.path)])
  );

  const notes: HandoverNote[] = [];
  // Off-screen but still laid out: Obsidian's renderer expects to be in a
  // document, and a detached element makes some post-processors give up
  const host = activeDocument.body.createDiv({
    cls: "project-planner-handover-render",
  });
  // The user goes on working while this runs, so it is hidden from the
  // accessibility tree too rather than only from the eye
  host.setAttribute("aria-hidden", "true");

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      onProgress(index, files.length);

      const container = host.createDiv();

      try {
        const raw = await app.vault.cachedRead(file);
        await MarkdownRenderer.render(
          app,
          stripFrontmatter(raw),
          container,
          file.path,
          owner
        );
        await inlineNoteHtml(app, container, file.path, anchorByPath);

        notes.push({
          path: file.path,
          title: file.basename,
          folder: file.parent?.path === "/" ? "" : (file.parent?.path ?? ""),
          html: container.innerHTML,
          anchor: anchorByPath.get(file.path) ?? noteAnchor(file.path),
        });
      } catch (error) {
        console.error(`Could not render ${file.path} for the handover`, error);
      } finally {
        container.remove();
      }
    }
  } finally {
    host.remove();
  }

  onProgress(files.length, files.length);
  return sortNotes(notes);
}

/* -------------------------------------------------------------------------- */
/* The pack                                                                   */
/* -------------------------------------------------------------------------- */

function describeIssue(issue: CostIssue): string {
  switch (issue.kind) {
    case "unknown-person":
      return t("handover.issue_unknown_person", { person: issue.person });
    case "no-rate":
      return t("handover.issue_no_rate", {
        person: issue.person,
        grade: issue.grade ?? t("finance.no_person"),
      });
    case "allocations-off":
      return t("handover.issue_allocations_off", {
        total: Math.round(issue.total * 100),
      });
    case "no-allocations":
      return t("handover.issue_no_allocations");
    default:
      return t("handover.issue_inferred_schedule");
  }
}

interface PackInput {
  app: App;
  settings: ProjectPlannerSettings;
  draft: HandoverDraft;
  tasks: BaseTask[];
  notes: HandoverNote[];
  today: string;
}

async function buildPack(input: PackInput): Promise<HandoverPack> {
  const { app, settings, draft, tasks, notes, today } = input;

  const skipWeekends = settings.ganttSkipWeekends;
  const rows = buildGanttRows(tasks, { today, skipWeekends });

  // The same hierarchy the chart draws, so the register's indenting and the
  // Gantt's rolled-up parents tell the reader the same story
  const hierarchy = buildHierarchy(
    rows,
    new Set(settings.ganttCollapsedTaskIds)
  );
  const lines = hierarchy.lines;
  const depthById = new Map(
    lines.map((line) => [line.row.task.id, line.depth])
  );

  const critical = findCriticalPath(
    lines.map((line) => ({
      id: line.row.task.id,
      incomingLinks: line.row.task.incomingLinks,
      start: line.row.bar.start,
      end: line.row.bar.end,
    })),
    { skipWeekends }
  );

  /* Finance ------------------------------------------------------------- */

  const wantsFinance = settings.financeEnabled && draft.includeFinance;
  const reportOptions = {
    defaultHoursPerDay: settings.financeDefaultHoursPerDay,
    skipWeekends,
    includeInferred: settings.financeIncludeInferred,
  };

  const report = wantsFinance
    ? buildCostReport(
        lines.map((line) => line.row),
        (await readRateBook(app, settings.financeRateNotePath)).book,
        reportOptions
      )
    : null;

  /* Tasks --------------------------------------------------------------- */

  const taskRows = buildTaskRows({
    rows: lines.map((line) => line.row),
    depthById,
    critical,
    costs: report ? report.costs : null,
    today,
  });

  /* The chart ------------------------------------------------------------ */

  const milestones = settings.ganttMilestones;
  const lanes = laneMilestones(milestones);
  const timeline = getTimelineRange(
    lines.map((line) => line.row.bar),
    { today, anchors: milestones.map((milestone) => milestone.date) }
  );

  const exportLines: GanttExportLine[] = lines.map((line) => ({
    kind: "task" as const,
    id: line.row.task.id,
    // Brackets and all is what the raw summary holds; the chart has nothing
    // to click, so it shows the words. Same reasoning as the register's
    label: plainTaskText(line.row.task.summary),
    depth: line.depth,
    start: line.row.bar.start,
    end: line.row.bar.end,
    status: line.row.task.status,
    percent: line.row.task.progress.percent,
    inferred: line.row.inferred,
    rollup: line.hasChildren,
    critical: critical.criticalIds.has(line.row.task.id),
  }));

  const ganttSvg =
    exportLines.length > 0
      ? buildGanttSvg({
          // No title and no footer inside the drawing. Standing alone as a PNG
          // the chart has to name itself and say where it came from; on page
          // four of a pack whose cover, running header and page footer all say
          // exactly that, it would be the third answer to a question nobody
          // asked. The span line stays, because that is about the plan
          title: "",
          subtitle: t("gantt.export_subtitle", {
            n: exportLines.length,
            start: formatExportDate(timeline.start),
            end: formatExportDate(timeline.end),
          }),
          footer: "",
          lines: exportLines,
          laneMilestones: lanes.map((milestone) => ({
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
          // A3 rather than A4: the pack prints this page landscape, and the
          // extra height is what stops a long plan squeezing its rows flat
          options: { paper: "a3", pixelRatio: 1, showToday: draft.markToday },
        }).svg
      : null;

  /* The graph ------------------------------------------------------------ */

  const graphNodes: HandoverGraphNode[] = taskRows.map((task) => ({
    id: task.id,
    label: task.summary,
    status: task.status,
    critical: task.critical,
  }));

  const graphEdges: HandoverGraphEdge[] = taskRows.flatMap((task) =>
    task.dependsOn.map((fromId) => ({
      fromId,
      toId: task.id,
      critical: critical.criticalEdgeKeys.has(`${fromId}->${task.id}`),
    }))
  );

  const graphs = buildDependencyGraphs(graphNodes, graphEdges);

  /* Questions ------------------------------------------------------------ */

  const anchorByPath = new Map(notes.map((note) => [note.path, note.anchor]));
  const rawQuestions = await getAllOpenQuestions(app);
  const questions: HandoverQuestion[] = rawQuestions.map((question) => ({
    question: question.question,
    answer: question.answer,
    resolved: question.resolved,
    resolvedOn: question.resolvedOn,
    noteName: question.noteName,
    notePath: question.notePath,
    noteAnchor: anchorByPath.get(question.notePath) ?? null,
  }));

  return {
    title: draft.title,
    vaultName: app.vault.getName(),
    generatedOn: today,
    summary: buildSummary({
      tasks: taskRows,
      milestones,
      questions: rawQuestions,
      noteCount: notes.length,
    }),
    ganttSvg,
    graphs: graphs.drawings.map((drawing) => ({
      svg: drawing.svg,
      nodeCount: drawing.nodeCount,
    })),
    isolatedTaskIds: graphs.isolatedIds,
    tasks: taskRows,
    milestones: milestones.map((milestone) => ({
      label: milestone.label,
      date: milestone.date,
      past: milestoneStatus(milestone, today) === "past",
    })),
    finance: report
      ? buildFinance({
          report,
          byPerson: groupCosts(
            report,
            lines.map((line) => line.row),
            "person",
            reportOptions
          ),
          byProject: groupCosts(
            report,
            lines.map((line) => line.row),
            "project",
            reportOptions
          ),
          tasks: taskRows,
          currency: settings.financeCurrency,
          includeInferred: settings.financeIncludeInferred,
          driverLimit: 15,
          describeIssue,
        })
      : null,
    questions,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Printing                                                                   */
/* -------------------------------------------------------------------------- */

/** A file name that sorts by date and cannot collide with a note. */
export function handoverFileName(
  title: string,
  today: string,
  extension: string
): string {
  const stem =
    title
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Handover";
  return `${stem} ${today}.${extension}`;
}

/** The first name in the vault root that is not taken. */
function availablePath(app: App, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = fileName.slice(0, dot);
  const extension = fileName.slice(dot);

  let candidate = normalizePath(fileName);
  let counter = 1;

  while (app.vault.getAbstractFileByPath(candidate)) {
    counter += 1;
    candidate = normalizePath(`${stem} ${counter}${extension}`);
  }

  return candidate;
}

const HEADER_TEMPLATE =
  `<div style="font-size:7pt;color:#6b7280;width:100%;padding:0 12mm;` +
  `font-family:sans-serif;"><span class="title"></span></div>`;

const FOOTER_TEMPLATE =
  `<div style="font-size:7pt;color:#6b7280;width:100%;padding:0 12mm;` +
  `font-family:sans-serif;display:flex;justify-content:space-between;">` +
  `<span class="date"></span>` +
  `<span><span class="pageNumber"></span> / <span class="totalPages"></span>` +
  `</span></div>`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Prints the document, via an off-screen Electron window.
 *
 * The HTML goes through a real file rather than a `data:` URL because a whole
 * vault easily runs to several megabytes and navigation to a data URL that size
 * is not something Chromium promises to do. The file is written through the
 * vault adapter — see the note at the top of this file about Node modules —
 * and removed again whatever happens.
 */
async function printToPdf(
  app: App,
  remote: ElectronRemote,
  html: string
): Promise<ArrayBuffer> {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("the vault is not on a file system this can print from");
  }

  const tempPath = normalizePath(
    `.project-planner-handover-${Date.now()}.html`
  );
  await adapter.write(tempPath, html);

  let printWindow: ElectronBrowserWindow | null = null;

  try {
    printWindow = new remote.BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // The document is assembled out of every note in the vault; none of it
        // needs to run, and none of it is going to
        javascript: false,
        webSecurity: true,
      },
    });

    await printWindow.loadFile(`${adapter.getBasePath()}/${tempPath}`);
    // Layout of a document this size is not finished the instant the load
    // event fires, and a chart printed mid-layout comes out blank
    await sleep(600);

    const data = await printWindow.webContents.printToPDF({
      printBackground: true,
      // The stylesheet owns the page size, because the pack mixes portrait
      // prose with landscape tables and only `@page` can say so
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      generateDocumentOutline: true,
    });

    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return bytes.buffer;
  } finally {
    printWindow?.destroy();
    try {
      await adapter.remove(tempPath);
    } catch {
      // A leftover temp file is untidy, not a failure worth reporting over a
      // pack that was produced successfully
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

export interface HandoverResult {
  file: TFile;
  /** False when Electron was unavailable and the HTML was written instead. */
  isPdf: boolean;
  taskCount: number;
  noteCount: number;
}

/**
 * Builds the pack and writes it into the vault.
 *
 * Progress is reported through a sticky notice rather than a modal, because
 * rendering every note in a large vault takes long enough that the user should
 * be free to go and look at something else while it happens.
 */
export async function exportHandoverPack(
  app: App,
  settings: ProjectPlannerSettings,
  draft: HandoverDraft,
  producer: string
): Promise<HandoverResult> {
  const notice = new Notice(t("handover.working"), 0);
  const owner = new Component();
  owner.load();

  try {
    const today = todayIso();
    // Honour the configured task source: a handover pack that ignored it
    // would ship the folders the user deliberately excluded.
    const tasks = getAllTasks(app, settings.taskSource, settings.taskTags);

    const notes = draft.includeNotes
      ? await renderVaultNotes(app, owner, (done, total) => {
          notice.setMessage(t("handover.working_notes", { done, total }));
        })
      : [];

    notice.setMessage(t("handover.working_pack"));

    const pack = await buildPack({
      app,
      settings,
      draft,
      tasks,
      notes,
      today,
    });

    const money = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: settings.financeCurrency || "USD",
      maximumFractionDigits: 0,
    });

    const html = buildHandoverHtml({
      pack,
      labels: handoverLabels(),
      formatMoney: (value) => money.format(value),
      formatDate: (iso) => formatExportDate(iso),
      producer,
    });

    const remote = getElectronRemote();

    if (!remote) {
      // No Electron: hand over the document itself, which prints to the same
      // searchable PDF from any browser
      const path = availablePath(
        app,
        handoverFileName(pack.title, today, "html")
      );
      const file = await app.vault.create(path, html);

      notice.hide();
      return {
        file,
        isPdf: false,
        taskCount: pack.tasks.length,
        noteCount: notes.length,
      };
    }

    notice.setMessage(t("handover.working_pdf"));
    const pdf = await printToPdf(app, remote, html);

    const path = availablePath(app, handoverFileName(pack.title, today, "pdf"));
    const file = await app.vault.createBinary(path, pdf);

    notice.hide();
    return {
      file,
      isPdf: true,
      taskCount: pack.tasks.length,
      noteCount: notes.length,
    };
  } finally {
    owner.unload();
    // A notice left open after a throw is a spinner that never stops
    notice.hide();
  }
}
