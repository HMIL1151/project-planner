import { App, Modal, Setting, TFile } from "obsidian";
import {
  DEFAULT_EXPORT_OPTIONS,
  GANTT_EXPORT_PAPERS,
  GANTT_EXPORT_RATIOS,
  GanttExportImage,
  GanttExportPaper,
} from "src/lib/gantt-export";
import { t } from "../i18n";

export interface GanttExportDraft {
  /** The heading printed above the chart. */
  title: string;
  paper: GanttExportPaper;
  pixelRatio: number;
  showToday: boolean;
}

export const DEFAULT_EXPORT_DRAFT: Omit<GanttExportDraft, "title"> = {
  paper: DEFAULT_EXPORT_OPTIONS.paper,
  pixelRatio: DEFAULT_EXPORT_OPTIONS.pixelRatio,
  showToday: DEFAULT_EXPORT_OPTIONS.showToday,
};

function readPaper(value: string): GanttExportPaper {
  return GANTT_EXPORT_PAPERS.includes(value as GanttExportPaper)
    ? (value as GanttExportPaper)
    : DEFAULT_EXPORT_OPTIONS.paper;
}

function readRatio(value: string): number {
  const ratio = Number(value);
  return GANTT_EXPORT_RATIOS.includes(ratio)
    ? ratio
    : DEFAULT_EXPORT_OPTIONS.pixelRatio;
}

/**
 * Asks how the picture should come out.
 *
 * Four questions and no more. Everything else the export needs it already
 * knows, because it draws what is on screen: the rows, their order, the
 * grouping, the filters and the milestones are all decisions the user has
 * made in the chart itself, and asking them again here would turn a two-click
 * export into a form.
 */
export class GanttExportModal extends Modal {
  private draft: GanttExportDraft;
  private readonly resolve: (_draft: GanttExportDraft | null) => void;
  private resolved = false;

  constructor(
    app: App,
    initial: GanttExportDraft,
    resolve: (_draft: GanttExportDraft | null) => void
  ) {
    super(app);
    this.draft = { ...initial };
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("gantt.export_modal_title") });
    contentEl.createEl("p", {
      text: t("gantt.export_modal_desc"),
      cls: "project-planner-gantt-export-modal__desc",
    });

    new Setting(contentEl)
      .setName(t("gantt.export_modal_heading"))
      .addText((input) => {
        input.setValue(this.draft.title);
        input.setPlaceholder(t("gantt.export_modal_heading_placeholder"));
        input.onChange((value) => {
          this.draft.title = value;
        });
        input.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          this.submit();
        });
        window.setTimeout(() => input.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName(t("gantt.export_modal_paper"))
      .setDesc(t("gantt.export_modal_paper_desc"))
      .addDropdown((dropdown) => {
        GANTT_EXPORT_PAPERS.forEach((paper) => {
          dropdown.addOption(paper, t(`gantt.export_paper_${paper}`));
        });
        dropdown.setValue(this.draft.paper);
        dropdown.onChange((value) => {
          this.draft.paper = readPaper(value);
        });
      });

    new Setting(contentEl)
      .setName(t("gantt.export_modal_quality"))
      .setDesc(t("gantt.export_modal_quality_desc"))
      .addDropdown((dropdown) => {
        GANTT_EXPORT_RATIOS.forEach((ratio) => {
          dropdown.addOption(
            String(ratio),
            t("gantt.export_quality_option", { n: ratio })
          );
        });
        dropdown.setValue(String(this.draft.pixelRatio));
        dropdown.onChange((value) => {
          this.draft.pixelRatio = readRatio(value);
        });
      });

    new Setting(contentEl)
      .setName(t("gantt.export_modal_today"))
      .setDesc(t("gantt.export_modal_today_desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.draft.showToday);
        toggle.onChange((value) => {
          this.draft.showToday = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(t("gantt.export_modal_confirm"))
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) =>
        button
          .setButtonText(t("task_create.modal_cancel"))
          .onClick(() => this.close())
      );
  }

  private submit(): void {
    this.resolved = true;
    this.resolve({ ...this.draft, title: this.draft.title.trim() });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(null);
  }
}

export function promptForGanttExport(
  app: App,
  initial: GanttExportDraft
): Promise<GanttExportDraft | null> {
  return new Promise((resolve) => {
    new GanttExportModal(app, initial, resolve).open();
  });
}

/* -------------------------------------------------------------------------- */
/* Turning the drawing into a file                                            */
/* -------------------------------------------------------------------------- */

/** Loads an image element and waits for it, since drawing needs it decoded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = createEl("img");
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the chart image could not load"));
    image.src = src;
  });
}

/**
 * Rasterises the SVG at `pixelRatio` device pixels per layout pixel.
 *
 * The drawing is vector, so the canvas is simply made bigger and the whole
 * thing drawn into it — which is what makes the result sharp rather than a
 * scaled-up screenshot. A ratio of 3 puts an A4 landscape page at about
 * 288dpi, well past what any document viewer will ask for.
 */
async function rasterize(
  image: GanttExportImage,
  pixelRatio: number
): Promise<Blob> {
  const source = new Blob([image.svg], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(source);

  try {
    const element = await loadImage(url);
    const canvas = createEl("canvas");
    canvas.width = Math.round(image.width * pixelRatio);
    canvas.height = Math.round(image.height * pixelRatio);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas context is available");

    // White under everything: a PNG pasted into a document should never come
    // through with a transparent background that picks up the page behind it
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(element, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("the chart could not be encoded as a PNG"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Puts the image on the clipboard, reporting whether it got there. */
async function copyToClipboard(blob: Blob): Promise<boolean> {
  // Not every platform Obsidian runs on has the async clipboard, and a copy
  // that fails must not lose the export — the file has been written by now
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (error) {
    console.error("Could not copy the chart to the clipboard", error);
    return false;
  }
}

export interface GanttExportResult {
  file: TFile;
  /** Whether the image also made it onto the clipboard. */
  copied: boolean;
  width: number;
  height: number;
}

/**
 * Writes the chart into the vault and copies it to the clipboard.
 *
 * Both, deliberately. The clipboard is what the export is for — the next thing
 * anyone does with a chart like this is paste it into a document — but a
 * clipboard is not somewhere you can find something again, so the file is what
 * makes the export repeatable and linkable from a note.
 */
export async function exportGanttPng(
  app: App,
  image: GanttExportImage,
  fileName: string,
  pixelRatio: number
): Promise<GanttExportResult> {
  const blob = await rasterize(image, pixelRatio);
  const path = await app.fileManager.getAvailablePathForAttachment(fileName);
  const file = await app.vault.createBinary(path, await blob.arrayBuffer());
  const copied = await copyToClipboard(blob);

  return {
    file,
    copied,
    width: Math.round(image.width * pixelRatio),
    height: Math.round(image.height * pixelRatio),
  };
}
