import { App, Modal, Setting } from "obsidian";
import {
  TaskAllocation,
  TaskExpense,
  TaskFinance,
  hasFinanceData,
} from "src/lib/task-finance";
import { RateBook, knownPeople, resolveRate } from "src/lib/rate-book";
import { resolveTaskHours } from "src/lib/task-cost";
import { t } from "../i18n";

/** Cancelling returns null; a task that already has finance can also clear it. */
export type TaskFinanceModalResult =
  { action: "save"; finance: TaskFinance } | { action: "clear" } | null;

export interface TaskFinanceModalOptions {
  initial: TaskFinance;
  summary: string;
  /** Length of the task's bar, in whichever day the Gantt is counting. */
  days: number;
  /** True when the bar's dates were suggested rather than read off the task. */
  inferred: boolean;
  defaultHoursPerDay: number;
  book: RateBook;
  currency: string;
  /** Inline tasks keep everything on one line, so long lists get a nudge. */
  inline: boolean;
}

/** Past this many rows an inline task's line stops being readable. */
const CROWDED_ROWS = 4;

/** The option value standing in for "somebody not in the rates note". */
const OTHER_PERSON = "__other__";

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // An unknown currency code should not take the modal down with it
    return `${Math.round(value)}`;
  }
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A number typed into a field, or null when the field is empty or nonsense. */
function readNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Asks for a task's hours, the people on it and anything it has to buy.
 *
 * The running totals along the bottom are the point of the thing: costing is
 * easy to get subtly wrong, and seeing the number move as the shares change is
 * what catches a 60/30 split before it reaches the dashboard.
 */
export class TaskFinanceModal extends Modal {
  private hoursPerDay: number | null;
  private totalHours: number | null;
  private allocations: TaskAllocation[];
  private expenses: TaskExpense[];

  private readonly options: TaskFinanceModalOptions;
  private readonly resolve: (_result: TaskFinanceModalResult) => void;
  private resolved = false;

  private hoursHintEl: HTMLElement | null = null;
  private shareChipEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private peopleRowsEl: HTMLElement | null = null;
  private expenseRowsEl: HTMLElement | null = null;

  constructor(
    app: App,
    options: TaskFinanceModalOptions,
    resolve: (_result: TaskFinanceModalResult) => void
  ) {
    super(app);
    this.options = options;
    this.hoursPerDay = options.initial.hoursPerDay;
    this.totalHours = options.initial.totalHours;
    this.allocations = options.initial.allocations.map((a) => ({ ...a }));
    this.expenses = options.initial.expenses.map((e) => ({ ...e }));
    this.resolve = resolve;
  }

  /* ---------------------------------------------------------------------- */

  private get draft(): TaskFinance {
    return {
      hoursPerDay: this.hoursPerDay,
      totalHours: this.totalHours,
      allocations: this.allocations.filter((a) => a.person.trim()),
      expenses: this.expenses.filter((e) => e.description.trim()),
    };
  }

  private get hours(): number {
    return resolveTaskHours(
      this.draft,
      this.options.days,
      this.options.defaultHoursPerDay
    ).hours;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("project-planner-finance-modal");

    contentEl.createEl("h3", { text: t("finance.modal_title") });
    contentEl.createEl("p", {
      cls: "project-planner-finance-modal__task",
      text: this.options.summary,
    });
    contentEl.createEl("p", {
      cls: "project-planner-finance-modal__schedule",
      text: this.options.inferred
        ? t("finance.modal_schedule_suggested", { days: this.options.days })
        : t("finance.modal_schedule", { days: this.options.days }),
    });

    this.renderHours(contentEl);
    this.renderPeople(contentEl);
    this.renderExpenses(contentEl);
    this.renderSummary(contentEl);
    this.renderButtons(contentEl);

    this.refresh();
  }

  /* ---------------------------------------------------------------------- */

  private renderHours(container: HTMLElement): void {
    new Setting(container)
      .setName(t("finance.modal_hours_per_day"))
      .setDesc(t("finance.modal_hours_per_day_desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setPlaceholder(String(this.options.defaultHoursPerDay));
        text.setValue(
          this.hoursPerDay === null ? "" : trimNumber(this.hoursPerDay)
        );
        text.onChange((value) => {
          this.hoursPerDay = readNumberInput(value);
          this.refresh();
        });
      });

    new Setting(container)
      .setName(t("finance.modal_total_hours"))
      .setDesc(t("finance.modal_total_hours_desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setPlaceholder(t("finance.modal_total_hours_placeholder"));
        text.setValue(
          this.totalHours === null ? "" : trimNumber(this.totalHours)
        );
        text.onChange((value) => {
          this.totalHours = readNumberInput(value);
          this.refresh();
        });
      });

    this.hoursHintEl = container.createEl("p", {
      cls: "project-planner-finance-modal__hint",
    });
  }

  /**
   * A compact row. The classes go on rather than styling Obsidian's own
   * `.setting-item`, which keeps the stylesheet to the plugin's own namespace
   * — the same trick the settings tab uses for its tag colour rows.
   */
  private rowSetting(container: HTMLElement): Setting {
    const setting = new Setting(container);
    setting.settingEl.addClass("project-planner-finance-modal__row");
    setting.infoEl.addClass("project-planner-finance-modal__row-info");
    setting.controlEl.addClass("project-planner-finance-modal__row-control");
    return setting;
  }

  private renderPeople(container: HTMLElement): void {
    container.createEl("h4", { text: t("finance.modal_people") });
    this.peopleRowsEl = container.createDiv({
      cls: "project-planner-finance-modal__rows",
    });

    const footer = new Setting(container).addButton((button) =>
      button.setButtonText(t("finance.modal_add_person")).onClick(() => {
        this.allocations.push({ person: "", share: 1 });
        this.drawPeopleRows();
        this.refresh();
      })
    );

    this.shareChipEl = footer.controlEl.createSpan({
      cls: "project-planner-finance-modal__chip",
    });

    this.drawPeopleRows();
  }

  private drawPeopleRows(): void {
    const rows = this.peopleRowsEl;
    if (!rows) return;
    rows.empty();

    const people = knownPeople(this.options.book);

    this.allocations.forEach((allocation, index) => {
      const setting = this.rowSetting(rows);
      const known = people.includes(allocation.person);

      // A dropdown covers the normal case; anyone not in the note still has to
      // be nameable, or the modal would refuse to show what the task already says
      if (people.length > 0 && (known || !allocation.person)) {
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", t("finance.modal_pick_person"));
          people.forEach((person) => {
            dropdown.addOption(person, person);
          });
          dropdown.addOption(OTHER_PERSON, t("finance.modal_other_person"));
          dropdown.setValue(allocation.person);
          dropdown.onChange((value) => {
            allocation.person = value === OTHER_PERSON ? " " : value;
            this.drawPeopleRows();
            this.refresh();
          });
        });
      } else {
        setting.addText((text) => {
          text.setPlaceholder(t("finance.modal_person_name"));
          text.setValue(allocation.person.trim());
          text.onChange((value) => {
            allocation.person = value;
            this.refresh();
          });
        });
      }

      setting.addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.addClass("project-planner-finance-modal__share");
        text.setPlaceholder("100");
        text.setValue(trimNumber(allocation.share * 100));
        text.onChange((value) => {
          const percent = readNumberInput(value);
          allocation.share = percent === null ? 0 : percent / 100;
          this.refresh();
        });
      });

      setting.controlEl.createSpan({
        cls: "project-planner-finance-modal__readout",
        text: this.readoutFor(allocation),
      });

      setting.addExtraButton((button) =>
        button
          .setIcon("trash-2")
          .setTooltip(t("finance.modal_remove"))
          .onClick(() => {
            this.allocations.splice(index, 1);
            this.drawPeopleRows();
            this.refresh();
          })
      );
    });
  }

  /** What this person's slice costs, or why it cannot be said. */
  private readoutFor(allocation: TaskAllocation): string {
    if (!allocation.person.trim()) return "";

    const { rate } = resolveRate(this.options.book, allocation.person);
    if (rate === null) return t("finance.modal_no_rate");

    const personHours = this.hours * allocation.share;
    return `${formatMoney(rate, this.options.currency)}/h · ${formatMoney(
      personHours * rate,
      this.options.currency
    )}`;
  }

  private renderExpenses(container: HTMLElement): void {
    container.createEl("h4", { text: t("finance.modal_costs") });
    this.expenseRowsEl = container.createDiv({
      cls: "project-planner-finance-modal__rows",
    });

    new Setting(container).addButton((button) =>
      button.setButtonText(t("finance.modal_add_cost")).onClick(() => {
        this.expenses.push({ description: "", amount: 0 });
        this.drawExpenseRows();
        this.refresh();
      })
    );

    this.drawExpenseRows();
  }

  private drawExpenseRows(): void {
    const rows = this.expenseRowsEl;
    if (!rows) return;
    rows.empty();

    this.expenses.forEach((expense, index) => {
      const setting = this.rowSetting(rows);

      setting.addText((text) => {
        text.setPlaceholder(t("finance.modal_cost_description"));
        text.setValue(expense.description);
        text.onChange((value) => {
          expense.description = value;
          this.refresh();
        });
      });

      setting.addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.addClass("project-planner-finance-modal__amount");
        text.setPlaceholder("0");
        text.setValue(trimNumber(expense.amount));
        text.onChange((value) => {
          expense.amount = readNumberInput(value) ?? 0;
          this.refresh();
        });
      });

      setting.addExtraButton((button) =>
        button
          .setIcon("trash-2")
          .setTooltip(t("finance.modal_remove"))
          .onClick(() => {
            this.expenses.splice(index, 1);
            this.drawExpenseRows();
            this.refresh();
          })
      );
    });

    if (this.options.inline && this.expenses.length > CROWDED_ROWS) {
      rows.createEl("p", {
        cls: "project-planner-finance-modal__hint",
        text: t("finance.modal_line_crowded"),
      });
    }
  }

  private renderSummary(container: HTMLElement): void {
    this.summaryEl = container.createEl("p", {
      cls: "project-planner-finance-modal__summary",
    });
  }

  private renderButtons(container: HTMLElement): void {
    const buttons = new Setting(container)
      .addButton((button) =>
        button
          .setButtonText(t("finance.modal_save"))
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) =>
        button
          .setButtonText(t("task_create.modal_cancel"))
          .onClick(() => this.close())
      );

    if (hasFinanceData(this.options.initial)) {
      buttons.addButton((button) =>
        button
          .setButtonText(t("finance.modal_clear"))
          .setDestructive()
          .onClick(() => {
            this.resolved = true;
            this.resolve({ action: "clear" });
            this.close();
          })
      );
    }
  }

  /* ---------------------------------------------------------------------- */

  /** Recomputes every derived number in place, without redrawing the rows. */
  private refresh(): void {
    const draft = this.draft;
    const { hours, source } = resolveTaskHours(
      draft,
      this.options.days,
      this.options.defaultHoursPerDay
    );

    if (this.hoursHintEl) {
      this.hoursHintEl.setText(
        source === "explicit"
          ? t("finance.modal_hours_explicit", { hours: trimNumber(hours) })
          : t("finance.modal_hours_calculated", {
              hours: trimNumber(hours),
              days: this.options.days,
              perDay: trimNumber(
                draft.hoursPerDay ?? this.options.defaultHoursPerDay
              ),
            })
      );
    }

    let labour = 0;
    let share = 0;
    for (const allocation of draft.allocations) {
      share += allocation.share;
      const { rate } = resolveRate(this.options.book, allocation.person);
      if (rate !== null) labour += hours * allocation.share * rate;
    }

    if (this.shareChipEl) {
      this.shareChipEl.setText(`${trimNumber(share * 100)}%`);
      this.shareChipEl.toggleClass(
        "project-planner-finance-modal__chip--warning",
        draft.allocations.length > 0 && Math.abs(share - 1) > 0.005
      );
    }

    // Redrawn rather than patched: the per-person readouts all move when the
    // hours do, and there are only ever a handful of rows
    for (const [index, row] of Array.from(
      this.peopleRowsEl?.querySelectorAll(
        ".project-planner-finance-modal__readout"
      ) ?? []
    ).entries()) {
      const allocation = this.allocations[index];
      if (allocation) row.setText(this.readoutFor(allocation));
    }

    const materials = draft.expenses.reduce((sum, e) => sum + e.amount, 0);
    const currency = this.options.currency;

    this.summaryEl?.setText(
      t("finance.modal_summary", {
        labour: formatMoney(labour, currency),
        materials: formatMoney(materials, currency),
        total: formatMoney(labour + materials, currency),
      })
    );
  }

  private submit(): void {
    const draft = this.draft;

    this.resolved = true;
    this.resolve(
      hasFinanceData(draft)
        ? { action: "save", finance: draft }
        : { action: "clear" }
    );
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(null);
  }
}

export function promptForTaskFinance(
  app: App,
  options: TaskFinanceModalOptions
): Promise<TaskFinanceModalResult> {
  return new Promise((resolve) => {
    new TaskFinanceModal(app, options, resolve).open();
  });
}
