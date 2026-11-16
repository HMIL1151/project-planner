import {
  App,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
} from "obsidian";
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
import { normalizeSettingValue } from "../lib/settings-normalize";
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

  /**
   * The worked example under the linking-style picker. Shared by both render
   * paths so the declarative definitions and display() cannot drift apart.
   */
  private renderLinkingPreview(
    container: HTMLElement,
    style: "individual" | "csv" | "dataview"
  ): void {
    container.empty();

    container.createDiv({
      cls: "project-planner-preview-title",
      text: t(`settings.linking_${style}_title`),
    });
    container.createDiv({
      cls: "project-planner-preview-desc",
      text: t(`settings.linking_${style}_desc`),
    });
    container.createDiv({
      cls: "project-planner-preview-example",
      text: t(`settings.linking_${style}_example`),
    });
  }

  // ---------------------------------------------------------------------------
  // Declarative definitions (Obsidian 1.13+)
  //
  // Returning a non-empty array from getSettingDefinitions() means Obsidian
  // renders the tab itself and never calls display(), and the same array is
  // what the settings search indexes. display() below is kept as the fallback
  // for Obsidian older than 1.13, which manifest.json still supports
  // (minAppVersion 1.8.0). A setting added to one has to be added to the other.
  // ---------------------------------------------------------------------------

  /** Marks a per-tag colour override key rather than a plain settings key. */
  private static readonly TAG_OVERRIDE_PREFIX = "tagColorOverrides.";

  /** Offered codes, plus whatever is set now if it was typed by hand. */
  private currencyCodes(): string[] {
    const current = this.plugin.settings.financeCurrency;
    return CURRENCY_CODES.includes(current)
      ? [...CURRENCY_CODES]
      : [...CURRENCY_CODES, current];
  }

  /** Reads the value Obsidian should show for a bound control key. */
  getControlValue(key: string): unknown {
    const prefix = ProjectPlannerSettingTab.TAG_OVERRIDE_PREFIX;
    if (key.startsWith(prefix)) {
      const tag = key.slice(prefix.length);
      return this.plugin.settings.tagColorOverrides[tag] ?? TAG_COLOR_DEFAULT;
    }
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  /**
   * Persists a bound control key, applying the same normalisation the
   * imperative onChange handlers do, so a cleared path falls back to its
   * default rather than being stored blank.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    const prefix = ProjectPlannerSettingTab.TAG_OVERRIDE_PREFIX;
    if (key.startsWith(prefix)) {
      this.plugin.settings.tagColorOverrides = setTagColorOverride(
        this.plugin.settings.tagColorOverrides,
        key.slice(prefix.length),
        value as TagColorName | typeof TAG_COLOR_DEFAULT
      );
      await this.plugin.saveSettings();
      this.update();
      return;
    }

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = normalizeSettingValue(key, value);

    await this.plugin.saveSettings();

    // These decide what else is on screen: the language changes every label,
    // and the others gate a row or a section behind a predicate.
    if (
      key === "language" ||
      key === "edgeStyle" ||
      key === "financeEnabled" ||
      key === "tagColorPalette"
    ) {
      this.update();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const knownTags = this.getKnownTags();
    const previewTags = ["priority", "bug", "feature", "docs", "blocked"];

    return [
      {
        name: t("settings.language"),
        desc: t("settings.language_desc"),
        control: {
          type: "dropdown",
          key: "language",
          options: Object.fromEntries(
            SUPPORTED_LANGUAGES.map((lang) => [lang.value, lang.label])
          ),
        },
      },
      {
        name: t("settings.task_source"),
        desc: t("settings.task_source_desc"),
        // Hand-rendered rather than bound to a text control: this one saves on
        // blur or Enter, because every save reloads the views and a half-typed
        // source is one Dataview cannot read.
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(t("settings.task_source_placeholder"))
              .setValue(this.plugin.settings.taskSource);
            text.inputEl.addEventListener("change", () => {
              this.plugin.settings.taskSource = text.getValue().trim();
              void this.plugin.saveSettings();
            });
          });
        },
      },
      {
        type: "group",
        heading: t("settings.display_options"),
        items: [
          {
            name: t("settings.show_task_priorities"),
            desc: t("settings.show_task_priorities_desc"),
            control: { type: "toggle", key: "showPriorities" },
          },
          {
            name: t("settings.show_task_tags"),
            desc: t("settings.show_task_tags_desc"),
            control: { type: "toggle", key: "showTags" },
          },
          {
            name: t("settings.show_status_counts"),
            desc: t("settings.show_status_counts_desc"),
            control: { type: "toggle", key: "showStatusCounts" },
          },
          {
            name: t("settings.gantt_show_warnings"),
            desc: t("settings.gantt_show_warnings_desc"),
            control: { type: "toggle", key: "ganttShowWarnings" },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.layout"),
        items: [
          {
            name: t("settings.layout_direction"),
            desc: t("settings.layout_direction_desc"),
            control: {
              type: "dropdown",
              key: "layoutDirection",
              options: {
                Horizontal: t("settings.layout_horizontal"),
                Vertical: t("settings.layout_vertical"),
              },
            },
          },
          {
            name: t("settings.edge_style"),
            desc: t("settings.edge_style_desc"),
            control: {
              type: "dropdown",
              key: "edgeStyle",
              options: {
                Bezier: t("settings.edge_style_bezier"),
                Straight: t("settings.edge_style_straight"),
                SmoothStep: t("settings.edge_style_smoothstep"),
              },
            },
          },
          {
            name: t("settings.smooth_step_radius"),
            desc: t("settings.smooth_step_radius_desc"),
            // Only means anything for the one edge style that has corners.
            visible: () => this.plugin.settings.edgeStyle === "SmoothStep",
            control: {
              type: "number",
              key: "smoothStepRadius",
              placeholder: "5",
              min: 0,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.tag_appearance"),
        items: [
          {
            name: t("settings.tag_color_palette"),
            desc: t("settings.tag_color_palette_desc"),
            control: {
              type: "dropdown",
              key: "tagColorPalette",
              options: {
                rainbow: t("settings.palette_rainbow"),
                ocean: t("settings.palette_ocean"),
                forest: t("settings.palette_forest"),
                sunset: t("settings.palette_sunset"),
                mono: t("settings.palette_mono"),
              },
            },
          },
          {
            name: t("settings.tag_color_palette"),
            // The chips are the whole row; it needs no second heading in search.
            searchable: false,
            render: (setting) => {
              this.createTagPreview(
                setting.controlEl,
                previewTags,
                this.plugin.settings.tagColorPalette
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.tag_colors"),
        cls: "project-planner-tag-color-list",
        search: {
          placeholder: t("settings.tag_colors_search_placeholder"),
          match: (def, query) =>
            def.name.toLowerCase().includes(query.trim().toLowerCase()),
        },
        extraButtons: [
          (button) =>
            button
              .setIcon("rotate-ccw")
              .setTooltip(t("settings.tag_colors_reset_desc"))
              .onClick(async () => {
                this.plugin.settings.tagColorOverrides = {};
                await this.plugin.saveSettings();
                this.update();
              }),
        ],
        items:
          knownTags.length > 0
            ? knownTags.map((tag) => ({
                name: tag,
                render: (setting: Setting) => {
                  setting.settingEl.addClass("project-planner-tag-color-row");
                  setting.nameEl.empty();
                  setting.nameEl.createSpan({
                    cls: `project-planner-tag ${getTagColorClass(
                      tag,
                      this.plugin.settings.tagColorPalette,
                      this.plugin.settings.tagColorOverrides
                    )}`,
                    text: tag,
                  });
                  setting.addDropdown((dropdown) => {
                    dropdown.addOption(
                      TAG_COLOR_DEFAULT,
                      t("settings.tag_color_theme")
                    );
                    TAG_COLOR_NAMES.forEach((color) => {
                      dropdown.addOption(
                        color,
                        t(`settings.tag_color_${color}`)
                      );
                    });
                    dropdown
                      .setValue(
                        this.plugin.settings.tagColorOverrides[tag] ??
                          TAG_COLOR_DEFAULT
                      )
                      .onChange(async (value) => {
                        await this.setControlValue(
                          `${ProjectPlannerSettingTab.TAG_OVERRIDE_PREFIX}${tag}`,
                          value
                        );
                      });
                  });
                },
              }))
            : [
                {
                  name: t("settings.no_tags_found"),
                  searchable: false,
                  render: (setting: Setting) => {
                    setting.settingEl.addClass(
                      "project-planner-tag-color-empty"
                    );
                  },
                },
              ],
      },
      {
        type: "group",
        heading: t("settings.task_creation"),
        items: [
          {
            name: t("settings.companion_notes"),
            desc: t("settings.companion_notes_desc"),
            control: { type: "toggle", key: "createCompanionNotes" },
          },
          {
            name: t("settings.companion_note_folder"),
            desc: t("settings.companion_note_folder_desc"),
            control: {
              type: "text",
              key: "companionNoteFolder",
              placeholder: DEFAULT_COMPANION_FOLDER,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.finance"),
        items: [
          {
            name: t("settings.finance_enabled"),
            desc: t("settings.finance_enabled_desc"),
            control: { type: "toggle", key: "financeEnabled" },
          },
        ],
      },
      {
        type: "group",
        // The rest of finance only makes sense once it is switched on.
        visible: () => this.plugin.settings.financeEnabled,
        items: [
          {
            name: t("settings.finance_rate_note"),
            desc: t("settings.finance_rate_note_desc"),
            // Hand-rendered for the create-note button beside the path.
            render: (setting) => {
              setting
                .addText((text) =>
                  text
                    .setPlaceholder(DEFAULT_RATE_NOTE_PATH)
                    .setValue(this.plugin.settings.financeRateNotePath)
                    .onChange(async (value) => {
                      await this.setControlValue("financeRateNotePath", value);
                      this.update();
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
                      if (file) {
                        await this.app.workspace.getLeaf(true).openFile(file);
                      }
                      this.update();
                    })
                );
            },
          },
          {
            name: t("settings.finance_rate_note"),
            // Says what the rate note actually yielded, so a mistyped table
            // header shows up here rather than as a silently empty dashboard.
            searchable: false,
            render: (setting) => {
              setting.settingEl.addClass("project-planner-setting-status");
              void this.showRateNoteStatus(setting.settingEl);
            },
          },
          {
            name: t("settings.finance_default_hours"),
            desc: t("settings.finance_default_hours_desc"),
            control: {
              type: "number",
              key: "financeDefaultHoursPerDay",
              placeholder: "8",
              min: 0,
            },
          },
          {
            name: t("settings.finance_currency"),
            desc: t("settings.finance_currency_desc"),
            control: {
              type: "dropdown",
              key: "financeCurrency",
              options: Object.fromEntries(
                this.currencyCodes().map((code) => [code, code])
              ),
            },
          },
          {
            name: t("settings.finance_include_inferred"),
            desc: t("settings.finance_include_inferred_desc"),
            control: { type: "toggle", key: "financeIncludeInferred" },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.simple_task_relations"),
        items: [
          {
            name: t("settings.linking_style"),
            desc: t("settings.linking_style_desc"),
            control: {
              type: "dropdown",
              key: "linkingStyle",
              options: {
                csv: t("settings.linking_csv"),
                individual: t("settings.linking_individual"),
                dataview: t("settings.linking_dataview"),
              },
            },
          },
          {
            name: t("settings.linking_style"),
            searchable: false,
            render: (setting) => {
              setting.settingEl.addClass("project-planner-preview-container");
              this.renderLinkingPreview(
                setting.settingEl,
                this.plugin.settings.linkingStyle
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.advanced_options"),
        items: [
          {
            name: t("settings.debug_visualization"),
            desc: t("settings.debug_visualization_desc"),
            control: { type: "toggle", key: "debugVisualization" },
          },
        ],
      },
    ];
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

    const updatePreview = (style: "individual" | "csv" | "dataview") =>
      this.renderLinkingPreview(previewContainer, style);

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
