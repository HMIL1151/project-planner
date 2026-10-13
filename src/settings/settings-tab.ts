import { App, PluginSettingTab, Setting } from "obsidian";
import ProjectPlannerPlugin from "../main";
import {
  TagColorName,
  TagColorPalette,
  TAG_COLOR_DEFAULT,
  TAG_COLOR_NAMES,
  getTagColorClass,
  setTagColorOverride,
} from "../lib/tag-color-manager";
import { getAllTasks } from "../lib/utils";
import { DEFAULT_COMPANION_FOLDER } from "../lib/companion-note";
import {
  DEFAULT_RATE_NOTE_PATH,
  ensureRateNote,
  readRateBook,
} from "../lib/rate-book-note";
import { t } from "../i18n";
import { SUPPORTED_LANGUAGES } from "../i18n";

/** Offered in the currency picker; any other code can still be set by hand. */
const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "DKK",
  "INR",
  "JPY",
  "NOK",
  "NZD",
  "SEK",
  "SGD",
  "ZAR",
];

export class ProjectPlannerSettingTab extends PluginSettingTab {
  plugin: ProjectPlannerPlugin;

  constructor(app: App, plugin: ProjectPlannerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private createTagPreview(
    container: HTMLElement,
    tags: string[],
    palette: TagColorPalette
  ): void {
    container.empty();

    const previewDiv = container.createDiv({
      cls: "project-planner-tag-preview-container",
    });

    tags.forEach((tag) => {
      previewDiv.createSpan({
        cls: `project-planner-tag ${getTagColorClass(tag, palette)}`,
        text: tag,
      });
    });
  }

  /**
   * The finance rows, shown only while finance is switched on.
   *
   * The status line at the bottom is what makes the rate note's format
   * teachable: it reports what was actually read back, so a mistyped table
   * header shows up here rather than as a silently empty dashboard.
   */
  private displayFinanceSettings(containerEl: HTMLElement): void {
    const rateNoteStatus = containerEl.createDiv({
      cls: "project-planner-setting-status",
    });

    new Setting(containerEl)
      .setName(t("settings.finance_rate_note"))
      .setDesc(t("settings.finance_rate_note_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_RATE_NOTE_PATH)
          .setValue(this.plugin.settings.financeRateNotePath)
          .onChange(async (value) => {
            this.plugin.settings.financeRateNotePath =
              value.trim() || DEFAULT_RATE_NOTE_PATH;
            await this.plugin.saveSettings();
            void this.showRateNoteStatus(rateNoteStatus);
          })
      )
      .addExtraButton((button) =>
        button
          .setIcon("file-plus")
          .setTooltip(t("settings.finance_rate_note_create"))
          .onClick(async () => {
            const file = await ensureRateNote(
              this.app,
              this.plugin.settings.financeRateNotePath
            );
            if (file) await this.app.workspace.getLeaf(true).openFile(file);
            void this.showRateNoteStatus(rateNoteStatus);
          })
      );

    new Setting(containerEl)
      .setName(t("settings.finance_default_hours"))
      .setDesc(t("settings.finance_default_hours_desc"))
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(this.plugin.settings.financeDefaultHoursPerDay.toString())
          .onChange(async (value) => {
            const hours = parseFloat(value);
            this.plugin.settings.financeDefaultHoursPerDay =
              Number.isFinite(hours) && hours >= 0 ? hours : 8;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.finance_currency"))
      .setDesc(t("settings.finance_currency_desc"))
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.financeCurrency;
        const codes = [...CURRENCY_CODES];
        if (!codes.includes(current)) codes.push(current);

        codes.forEach((code) => {
          dropdown.addOption(code, code);
        });
        dropdown.setValue(current).onChange(async (value) => {
          this.plugin.settings.financeCurrency = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.finance_include_inferred"))
      .setDesc(t("settings.finance_include_inferred_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.financeIncludeInferred)
          .onChange(async (value) => {
            this.plugin.settings.financeIncludeInferred = value;
            await this.plugin.saveSettings();
          })
      );

    void this.showRateNoteStatus(rateNoteStatus);
  }

  /** Reports what the rate note actually yielded, or that there isn't one. */
  private async showRateNoteStatus(container: HTMLElement): Promise<void> {
    const { book, found } = await readRateBook(
      this.app,
      this.plugin.settings.financeRateNotePath
    );

    container.empty();

    if (!found) {
      container.setText(t("settings.finance_rate_note_missing"));
      container.addClass("project-planner-setting-status--warning");
      return;
    }

    container.removeClass("project-planner-setting-status--warning");
    container.setText(
      t("settings.finance_rate_note_status", {
        grades: book.grades.length,
        people: book.people.length,
        problems: book.problems.length,
      })
    );
  }

  /**
   * Every tag currently used by a task, plus any tag that still has a manual
   * color assigned (so an override can be cleared after the tag disappears).
   */
  private getKnownTags(): string[] {
    const tags = new Set<string>();
    try {
      getAllTasks(this.app).forEach((task) => {
        task.tags.forEach((tag) => tags.add(tag));
      });
    } catch {
      // Dataview may not be ready yet; overrides below still render
    }
    Object.keys(this.plugin.settings.tagColorOverrides).forEach((tag) =>
      tags.add(tag)
    );
    return Array.from(tags).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  /**
   * Renders one row per tag: a live chip preview plus a color dropdown that
   * defaults to the palette color.
   */
  private createTagColorRows(
    container: HTMLElement,
    tags: string[],
    query: string
  ): void {
    container.empty();

    const normalizedQuery = query.trim().toLowerCase();
    const visibleTags = normalizedQuery
      ? tags.filter((tag) => tag.toLowerCase().includes(normalizedQuery))
      : tags;

    if (visibleTags.length === 0) {
      container.createDiv({
        cls: "project-planner-tag-color-empty",
        text:
          tags.length === 0
            ? t("settings.no_tags_found")
            : t("settings.no_tags_match"),
      });
      return;
    }

    visibleTags.forEach((tag) => {
      const setting = new Setting(container);
      setting.settingEl.addClass("project-planner-tag-color-row");
      const chip = setting.nameEl.createSpan({
        cls: `project-planner-tag ${getTagColorClass(
          tag,
          this.plugin.settings.tagColorPalette,
          this.plugin.settings.tagColorOverrides
        )}`,
        text: tag,
      });

      setting.addDropdown((dropdown) => {
        dropdown.addOption(TAG_COLOR_DEFAULT, t("settings.tag_color_theme"));
        TAG_COLOR_NAMES.forEach((color) => {
          dropdown.addOption(color, t(`settings.tag_color_${color}`));
        });
        dropdown
          .setValue(
            this.plugin.settings.tagColorOverrides[tag] ?? TAG_COLOR_DEFAULT
          )
          .onChange(async (value) => {
            this.plugin.settings.tagColorOverrides = setTagColorOverride(
              this.plugin.settings.tagColorOverrides,
              tag,
              value as TagColorName | typeof TAG_COLOR_DEFAULT
            );
            await this.plugin.saveSettings();
            chip.className = `project-planner-tag ${getTagColorClass(
              tag,
              this.plugin.settings.tagColorPalette,
              this.plugin.settings.tagColorOverrides
            )}`;
          });
      });
    });
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.language_desc"))
      .addDropdown((dropdown) => {
        SUPPORTED_LANGUAGES.forEach((lang) => {
          dropdown.addOption(lang.value, lang.label);
        });
        dropdown
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as "en" | "nl" | "zh-CN";
            await this.plugin.saveSettings();
            // Redraw the settings tab with new language
            this.display();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.task_source"))
      .setDesc(t("settings.task_source_desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.task_source_placeholder"))
          .setValue(this.plugin.settings.taskSource);
        // Saved on blur or Enter, not per keystroke: every save reloads the
        // views, and a half-typed source is one Dataview cannot read
        text.inputEl.addEventListener("change", () => {
          this.plugin.settings.taskSource = text.getValue().trim();
          void this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.display_options"));

    new Setting(containerEl)
      .setName(t("settings.show_task_priorities"))
      .setDesc(t("settings.show_task_priorities_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPriorities)
          .onChange(async (value) => {
            this.plugin.settings.showPriorities = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.show_task_tags"))
      .setDesc(t("settings.show_task_tags_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTags)
          .onChange(async (value) => {
            this.plugin.settings.showTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.show_status_counts"))
      .setDesc(t("settings.show_status_counts_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusCounts)
          .onChange(async (value) => {
            this.plugin.settings.showStatusCounts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.gantt_show_warnings"))
      .setDesc(t("settings.gantt_show_warnings_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ganttShowWarnings)
          .onChange(async (value) => {
            this.plugin.settings.ganttShowWarnings = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName(t("settings.layout"));

    new Setting(containerEl)
      .setName(t("settings.layout_direction"))
      .setDesc(t("settings.layout_direction_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Horizontal", t("settings.layout_horizontal"))
          .addOption("Vertical", t("settings.layout_vertical"))
          .setValue(this.plugin.settings.layoutDirection)
          .onChange(async (value) => {
            this.plugin.settings.layoutDirection = value as
              "Horizontal" | "Vertical";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.edge_style"))
      .setDesc(t("settings.edge_style_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Bezier", t("settings.edge_style_bezier"))
          .addOption("Straight", t("settings.edge_style_straight"))
          .addOption("SmoothStep", t("settings.edge_style_smoothstep"))
          .setValue(this.plugin.settings.edgeStyle)
          .onChange(async (value) => {
            this.plugin.settings.edgeStyle = value as
              "Bezier" | "Straight" | "SmoothStep";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.edgeStyle === "SmoothStep") {
      new Setting(containerEl)
        .setName(t("settings.smooth_step_radius"))
        .setDesc(t("settings.smooth_step_radius_desc"))
        .addText((text) =>
          text
            .setPlaceholder("5")
            .setValue(this.plugin.settings.smoothStepRadius.toString())
            .onChange(async (value) => {
              const radius = Math.max(0, parseInt(value) || 0);
              this.plugin.settings.smoothStepRadius = radius;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl).setHeading().setName(t("settings.tag_appearance"));

    new Setting(containerEl)
      .setName(t("settings.tag_color_palette"))
      .setDesc(t("settings.tag_color_palette_desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("rainbow", t("settings.palette_rainbow"))
          .addOption("ocean", t("settings.palette_ocean"))
          .addOption("forest", t("settings.palette_forest"))
          .addOption("sunset", t("settings.palette_sunset"))
          .addOption("mono", t("settings.palette_mono"))
          .setValue(this.plugin.settings.tagColorPalette)
          .onChange(async (value) => {
            this.plugin.settings.tagColorPalette = value as TagColorPalette;
            await this.plugin.saveSettings();
            this.createTagPreview(
              tagPreviewContainer,
              ["priority", "bug", "feature", "docs", "blocked"],
              value as TagColorPalette
            );
            this.createTagColorRows(tagColorList, knownTags, tagColorQuery);
          });
      });

    const tagPreviewContainer = containerEl.createDiv();
    this.createTagPreview(
      tagPreviewContainer,
      ["priority", "bug", "feature", "docs", "blocked"],
      this.plugin.settings.tagColorPalette
    );

    const knownTags = this.getKnownTags();
    let tagColorQuery = "";

    const tagColorsSetting = new Setting(containerEl)
      .setName(t("settings.tag_colors"))
      .setDesc(t("settings.tag_colors_desc"))
      .addSearch((search) => {
        search
          .setPlaceholder(t("settings.tag_colors_search_placeholder"))
          .onChange((value) => {
            tagColorQuery = value;
            this.createTagColorRows(tagColorList, knownTags, tagColorQuery);
          });
      });

    tagColorsSetting.addButton((button) => {
      button
        .setButtonText(t("settings.tag_colors_reset"))
        .setTooltip(t("settings.tag_colors_reset_desc"))
        .onClick(async () => {
          this.plugin.settings.tagColorOverrides = {};
          await this.plugin.saveSettings();
          this.createTagColorRows(tagColorList, knownTags, tagColorQuery);
        });
    });

    const tagColorList = containerEl.createDiv({
      cls: "project-planner-tag-color-list",
    });
    this.createTagColorRows(tagColorList, knownTags, tagColorQuery);

    new Setting(containerEl).setHeading().setName(t("settings.task_creation"));

    new Setting(containerEl)
      .setName(t("settings.companion_notes"))
      .setDesc(t("settings.companion_notes_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createCompanionNotes)
          .onChange(async (value) => {
            this.plugin.settings.createCompanionNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.companion_note_folder"))
      .setDesc(t("settings.companion_note_folder_desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_COMPANION_FOLDER)
          .setValue(this.plugin.settings.companionNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.companionNoteFolder =
              value.trim() || DEFAULT_COMPANION_FOLDER;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName(t("settings.finance"));

    new Setting(containerEl)
      .setName(t("settings.finance_enabled"))
      .setDesc(t("settings.finance_enabled_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.financeEnabled)
          .onChange(async (value) => {
            this.plugin.settings.financeEnabled = value;
            await this.plugin.saveSettings();
            // The rest of the section only makes sense when it is on
            this.display();
          })
      );

    if (this.plugin.settings.financeEnabled) {
      this.displayFinanceSettings(containerEl);
    }

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.simple_task_relations"));

    new Setting(containerEl)
      .setName(t("settings.linking_style"))
      .setDesc(t("settings.linking_style_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("csv", t("settings.linking_csv"))
          .addOption("individual", t("settings.linking_individual"))
          .addOption("dataview", t("settings.linking_dataview"))
          .setValue(this.plugin.settings.linkingStyle)
          .onChange(async (value) => {
            this.plugin.settings.linkingStyle = value as
              "individual" | "csv" | "dataview";
            await this.plugin.saveSettings();
            updatePreview(value as "individual" | "csv" | "dataview");
          })
      );

    // Create preview container
    const previewContainer = containerEl.createDiv();
    previewContainer.addClass("project-planner-preview-container");

    const updatePreview = (style: "individual" | "csv" | "dataview") => {
      previewContainer.empty();

      if (style === "individual") {
        const title = previewContainer.createDiv({
          cls: "project-planner-preview-title",
        });
        title.textContent = t("settings.linking_individual_title");

        const desc = previewContainer.createDiv({
          cls: "project-planner-preview-desc",
        });
        desc.textContent = t("settings.linking_individual_desc");

        const example = previewContainer.createDiv({
          cls: "project-planner-preview-example",
        });
        example.textContent = t("settings.linking_individual_example");
      } else if (style === "dataview") {
        const title = previewContainer.createDiv({
          cls: "project-planner-preview-title",
        });
        title.textContent = t("settings.linking_dataview_title");

        const desc = previewContainer.createDiv({
          cls: "project-planner-preview-desc",
        });
        desc.textContent = t("settings.linking_dataview_desc");

        const example = previewContainer.createDiv({
          cls: "project-planner-preview-example",
        });
        example.textContent = t("settings.linking_dataview_example");
      } else {
        const title = previewContainer.createDiv({
          cls: "project-planner-preview-title",
        });
        title.textContent = t("settings.linking_csv_title");

        const desc = previewContainer.createDiv({
          cls: "project-planner-preview-desc",
        });
        desc.textContent = t("settings.linking_csv_desc");

        const example = previewContainer.createDiv({
          cls: "project-planner-preview-example",
        });
        example.textContent = t("settings.linking_csv_example");
      }
    };

    // Initialize preview
    updatePreview(this.plugin.settings.linkingStyle);

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.advanced_options"));

    new Setting(containerEl)
      .setName(t("settings.debug_visualization"))
      .setDesc(t("settings.debug_visualization_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugVisualization)
          .onChange(async (value) => {
            this.plugin.settings.debugVisualization = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
