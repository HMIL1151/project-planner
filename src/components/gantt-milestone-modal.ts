import { App, Modal, Setting } from "obsidian";
import { toEpochDay } from "src/lib/date-utils";
import {
  MILESTONE_DISPLAYS,
  MilestoneDisplay,
  readMilestoneDisplay,
} from "src/lib/gantt-milestones";
import { t } from "../i18n";

export interface MilestoneDraft {
  label: string;
  date: string;
  /** Flag in the lane above the chart, or a row among the tasks. */
  display: MilestoneDisplay;
}

/** Cancelling returns null; editing can also ask for the milestone to go. */
export type MilestoneModalResult =
  { action: "save"; draft: MilestoneDraft } | { action: "delete" } | null;

/**
 * Asks for a milestone's name, its date, and where it is drawn.
 *
 * The same modal creates and edits: an existing milestone pre-fills the
 * fields and gains a delete button, so there is one place to learn rather
 * than two that look alike.
 */
export class GanttMilestoneModal extends Modal {
  private label: string;
  private date: string;
  private display: MilestoneDisplay;
  private readonly existing: boolean;
  private readonly resolve: (_result: MilestoneModalResult) => void;
  private resolved = false;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    options: { initial?: MilestoneDraft; defaultDate: string },
    resolve: (_result: MilestoneModalResult) => void
  ) {
    super(app);
    this.existing = Boolean(options.initial);
    this.label = options.initial?.label ?? "";
    this.date = options.initial?.date ?? options.defaultDate;
    // Pre-filled from the milestone being edited, so moving one between the
    // lane and the list is a change of dropdown rather than a delete and a
    // retype. A new milestone starts in the lane, which is where every
    // milestone written before this choice existed still is.
    this.display = readMilestoneDisplay(options.initial?.display);
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: this.existing
        ? t("gantt.milestone_modal_edit_title")
        : t("gantt.milestone_modal_title"),
    });

    new Setting(contentEl)
      .setName(t("gantt.milestone_modal_name"))
      .addText((text) => {
        text.setPlaceholder(t("gantt.milestone_modal_name_placeholder"));
        text.setValue(this.label);
        text.onChange((value) => {
          this.label = value;
        });
        text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          this.submit();
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName(t("gantt.milestone_modal_date"))
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.date);
        text.onChange((value) => {
          this.date = value;
        });
      });

    new Setting(contentEl)
      .setName(t("gantt.milestone_modal_display"))
      .setDesc(t("gantt.milestone_modal_display_desc"))
      .addDropdown((dropdown) => {
        MILESTONE_DISPLAYS.forEach((display) => {
          dropdown.addOption(
            display,
            t(`gantt.milestone_modal_display_${display}`)
          );
        });
        dropdown.setValue(this.display);
        dropdown.onChange((value) => {
          this.display = readMilestoneDisplay(value);
        });
      });

    this.errorEl = contentEl.createEl("p", {
      cls: "project-planner-gantt-milestone-modal__error",
    });
    this.errorEl.hide();

    const buttons = new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(t("gantt.milestone_modal_save"))
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) =>
        button
          .setButtonText(t("task_create.modal_cancel"))
          .onClick(() => this.close())
      );

    if (this.existing) {
      buttons.addButton((button) =>
        button
          .setButtonText(t("gantt.milestone_modal_delete"))
          .setDestructive()
          .onClick(() => {
            this.resolved = true;
            this.resolve({ action: "delete" });
            this.close();
          })
      );
    }
  }

  private submit(): void {
    const label = this.label.trim();
    const date = this.date.trim();

    if (!label) {
      this.showError(t("gantt.milestone_modal_name_required"));
      return;
    }
    if (toEpochDay(date) === null) {
      this.showError(t("gantt.milestone_modal_date_invalid"));
      return;
    }

    this.resolved = true;
    this.resolve({
      action: "save",
      draft: { label, date, display: this.display },
    });
    this.close();
  }

  private showError(message: string): void {
    if (!this.errorEl) return;
    this.errorEl.setText(message);
    this.errorEl.show();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(null);
  }
}

export function promptForMilestone(
  app: App,
  options: { initial?: MilestoneDraft; defaultDate: string }
): Promise<MilestoneModalResult> {
  return new Promise((resolve) => {
    new GanttMilestoneModal(app, options, resolve).open();
  });
}
