import React from "react";
import {
  WorkspaceLeaf,
  Plugin,
  Editor,
  TFile,
  FuzzySuggestModal,
  MarkdownRenderChild,
  MarkdownPostProcessorContext,
} from "obsidian";
import { createRoot } from "react-dom/client";

import ProjectPlannerGraphItemView, {
  VIEW_TYPE,
} from "./views/ProjectPlannerGraphItemView";
import ProjectPlannerGanttItemView, {
  GANTT_VIEW_TYPE,
} from "./views/ProjectPlannerGanttItemView";
import ProjectPlannerFinanceItemView, {
  FINANCE_VIEW_TYPE,
} from "./views/ProjectPlannerFinanceItemView";
import ProjectPlannerKanbanItemView, {
  KANBAN_VIEW_TYPE,
} from "./views/ProjectPlannerKanbanItemView";
import ProjectPlannerOpenQuestionsItemView, {
  OPEN_QUESTIONS_VIEW_TYPE,
} from "./views/ProjectPlannerOpenQuestionsItemView";
import GraphEmbedView, {
  EmbedError,
  filterStateFromSource,
} from "./views/GraphEmbedView";
import GanttEmbedView from "./views/GanttEmbedView";
import { GANTT_EMBED_CODE_BLOCK, parseGanttEmbed } from "./lib/gantt-embed";
import { buildDataviewSource } from "./lib/task-source";
import {
  ProjectPlannerSettings,
  DEFAULT_SETTINGS,
  FilterPreset,
} from "./types/settings";
import { ProjectPlannerSettingTab } from "./settings/settings-tab";
import { initI18n, changeLanguage, t } from "./i18n";
import { FilterState, DEFAULT_FILTER_STATE } from "./types/filter-state";
import { EmbedConfig, DEFAULT_EMBED_CONFIG } from "./types/embed-config";
import { Notice } from "obsidian";
import { checkDataviewPlugin, getAllTasks } from "./lib/utils";
import {
  openQuestionMarker,
  openQuestionMarkerCursor,
} from "./lib/open-question";
import {
  findTasksNeedingNotes,
  retrofitCompanionNotes,
} from "./lib/companion-note-retrofit";
import { confirm } from "./components/confirm-modal";
import {
  DEFAULT_HANDOVER_DRAFT,
  promptForHandover,
} from "./components/handover-export-modal";
import { exportHandoverPack } from "./components/handover-export";
import { requestTaskFocus } from "./lib/view-focus";
import { UndoHistory } from "./lib/undo-history";
import { ensureRateNote } from "./lib/rate-book-note";
import { EdgeStyleOverrides } from "./lib/edge-style-manager";
import { GanttMilestone } from "./lib/gantt-milestones";
import { KanbanGroupBy } from "./lib/kanban-buckets";

const EMBED_CODE_BLOCK = "project-planner";

/**
 * The block name this plugin used before it was renamed from Tasks Map.
 * Still rendered, so embeds already written into vaults keep working.
 */
const LEGACY_EMBED_CODE_BLOCK = "tasks-map";

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  private onChoose: (_file: TFile) => void;

  constructor(
    app: InstanceType<typeof Plugin>["app"],
    onChoose: (_file: TFile) => void
  ) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(t("embed.pick_note_placeholder"));
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

export default class ProjectPlannerPlugin extends Plugin {
  settings: ProjectPlannerSettings = {
    ...DEFAULT_SETTINGS,
    filterPresets: [...DEFAULT_SETTINGS.filterPresets],
  };

  /** Shared by both views, so either can take back the other's edits. */
  readonly undoHistory = new UndoHistory();

  async onload() {
    // Load settings
    await this.loadSettings();

    // Initialize i18n with saved language
    await initI18n(this.settings.language);

    // Always register the view - it will handle the Dataview check internally
    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ProjectPlannerGraphItemView(leaf, this)
    );

    this.registerView(
      GANTT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ProjectPlannerGanttItemView(leaf, this)
    );

    this.registerView(
      FINANCE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ProjectPlannerFinanceItemView(leaf, this)
    );

    this.registerView(
      KANBAN_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ProjectPlannerKanbanItemView(leaf, this)
    );

    this.registerView(
      OPEN_QUESTIONS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new ProjectPlannerOpenQuestionsItemView(leaf, this)
    );

    this.addSettingTab(new ProjectPlannerSettingTab(this.app, this));

    this.addCommand({
      id: "open-graph-view",
      name: t("commands.open_map_view"),
      callback: () => {
        void this.activateViewInMainArea();
      },
    });

    this.addCommand({
      id: "open-gantt-view",
      name: t("commands.open_gantt_view"),
      callback: () => {
        void this.activateGanttViewInMainArea();
      },
    });

    // Finance is off by default, so its command, ribbon icon and menu entries
    // stay out of the way until somebody turns it on
    if (this.settings.financeEnabled) {
      this.addCommand({
        id: "open-finance-view",
        name: t("commands.open_finance_view"),
        callback: () => {
          void this.activateFinanceViewInMainArea();
        },
      });

      this.addCommand({
        id: "create-rate-note",
        name: t("commands.create_rate_note"),
        callback: () => {
          void this.createRateNote();
        },
      });

      this.addRibbonIcon("coins", t("ribbon.open_tasks_finance"), () => {
        void this.activateFinanceViewInMainArea();
      });
    }

    this.addCommand({
      id: "open-kanban-view",
      name: t("commands.open_kanban_view"),
      callback: () => {
        void this.activateKanbanViewInMainArea();
      },
    });

    this.addCommand({
      id: "open-open-questions-view",
      name: t("commands.open_open_questions_view"),
      callback: () => {
        void this.activateOpenQuestionsViewInMainArea();
      },
    });

    // Writing the marker by hand means remembering the syntax at exactly the
    // moment attention is on the question instead
    this.addCommand({
      id: "insert-open-question",
      name: t("commands.insert_open_question"),
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        const start = editor.getCursor("from");

        editor.replaceSelection(openQuestionMarker(selection));
        editor.setCursor({
          line: start.line,
          ch: start.ch + openQuestionMarkerCursor(selection),
        });
      },
    });

    this.addCommand({
      id: "create-notes-for-existing-tasks",
      name: t("commands.retrofit_companion_notes"),
      callback: () => {
        void this.createNotesForExistingTasks();
      },
    });

    this.addCommand({
      id: "export-handover-pack",
      name: t("commands.export_handover_pack"),
      callback: () => {
        void this.createHandoverPack();
      },
    });

    this.addCommand({
      id: "insert-filter-as-code-block",
      name: t("commands.insert_filter_as_code_block"),
      callback: () => {
        this.insertFilterIntoActiveNote(null);
      },
    });

    this.addRibbonIcon("map", t("ribbon.open_tasks_map"), () => {
      void this.activateViewInMainArea();
    });

    this.addRibbonIcon("gantt-chart", t("ribbon.open_tasks_gantt"), () => {
      void this.activateGanttViewInMainArea();
    });

    this.addRibbonIcon("columns-3", t("ribbon.open_tasks_kanban"), () => {
      void this.activateKanbanViewInMainArea();
    });

    this.addRibbonIcon("help-circle", t("ribbon.open_open_questions"), () => {
      void this.activateOpenQuestionsViewInMainArea();
    });

    // Both names render the same embed. The pre-rename one is still
    // registered so notes written before this plugin was renamed keep working.
    for (const lang of [EMBED_CODE_BLOCK, LEGACY_EMBED_CODE_BLOCK]) {
      this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
        this.renderEmbed(source, el, ctx);
      });
    }

    this.registerMarkdownCodeBlockProcessor(
      GANTT_EMBED_CODE_BLOCK,
      (source, el, ctx) => {
        this.renderGanttEmbed(source, el, ctx);
      }
    );
  }

  /** Renders one `project-planner-gantt` block into `el`. */
  private renderGanttEmbed(
    body: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    const root = createRoot(el);
    const child = new MarkdownRenderChild(el);
    child.onunload = () => root.unmount();
    ctx.addChild(child);

    if (!checkDataviewPlugin(this.app).isReady) {
      root.render(<EmbedError message={t("embed.dataview_required")} />);
      return;
    }

    const parsed = parseGanttEmbed(body);
    if (parsed.kind === "invalid") {
      root.render(<EmbedError message={t("embed.invalid_json")} />);
      return;
    }

    // The note holding the block names the project in a tab opened from it
    const noteName =
      ctx.sourcePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

    root.render(
      <GanttEmbedView
        plugin={this}
        source={buildDataviewSource(parsed.source)}
        config={parsed.config}
        title={noteName}
      />
    );
  }

  /** Renders one fenced embed block into `el`. */
  private renderEmbed(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    const dataviewCheck = checkDataviewPlugin(this.app);

    const root = createRoot(el);

    // Register cleanup via MarkdownRenderChild so the root is unmounted
    // when the embed is removed or the preview re-renders
    const child = new MarkdownRenderChild(el);
    child.onunload = () => root.unmount();
    ctx.addChild(child);

    if (!dataviewCheck.isReady) {
      root.render(<EmbedError message={t("embed.dataview_required")} />);
      return;
    }

    const parsed = filterStateFromSource(source);

    if (parsed.kind === "invalid") {
      root.render(<EmbedError message={t("embed.invalid_json")} />);
      return;
    }

    if (parsed.kind === "legacy") {
      root.render(<EmbedError message={t("embed.legacy_format")} />);
      return;
    }

    root.render(
      <GraphEmbedView
        plugin={this}
        initialFilter={parsed.filter}
        embedConfig={parsed.config}
        source={buildDataviewSource(parsed.source)}
      />
    );
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<ProjectPlannerSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update language when settings change
    changeLanguage(this.settings.language);
    // Notify open views of settings change
    window.dispatchEvent(new Event("project-planner:settings-changed"));
  }

  /**
   * Gives every existing inline task a note and moves its properties into it,
   * the same shape a task edited in the dialog ends up with.
   *
   * Two jobs, because a vault can need either: tasks written before companion
   * notes existed have no note at all, and tasks linked by an earlier run of
   * this command have one that is still empty. Bulk-rewrites task lines, so it
   * asks first.
   */
  async createNotesForExistingTasks(): Promise<void> {
    const tasks = getAllTasks(this.app);
    const needNotes = findTasksNeedingNotes(tasks);
    const alreadyLinked = tasks.filter(
      (task) => task.type === "dataview" && !needNotes.includes(task)
    ).length;

    if (needNotes.length === 0 && alreadyLinked === 0) {
      new Notice(t("retrofit.nothing_to_do"));
      return;
    }

    const proceed = await confirm(this.app, {
      title: t("retrofit.title"),
      body: t("retrofit.body", {
        n: needNotes.length,
        folder: this.settings.companionNoteFolder,
      }),
      confirmLabel: t("retrofit.confirm"),
    });
    if (!proceed) return;

    const result = await retrofitCompanionNotes(this.app, tasks, {
      enabled: true,
      folder: this.settings.companionNoteFolder,
    });

    new Notice(
      result.failed === 0 && result.skipped === 0
        ? t("retrofit.done", { n: result.linked, moved: result.migrated })
        : t("retrofit.done_partial", {
            n: result.linked,
            moved: result.migrated,
            skipped: result.skipped + result.failed,
          })
    );
  }

  /**
   * Writes the whole project out as one searchable PDF.
   *
   * The point of it is the reader who does not have Obsidian, has no intention
   * of installing it, and still has to be able to find "who owns the thing that
   * blocks the launch" six months from now. So it is deliberately the whole
   * vault and not a view: the plan, the register, the dependencies, the costs,
   * the open questions and every note behind them, in one file that searches.
   */
  async createHandoverPack(): Promise<void> {
    const draft = await promptForHandover(
      this.app,
      { ...DEFAULT_HANDOVER_DRAFT, title: this.app.vault.getName() },
      this.settings.financeEnabled
    );
    if (!draft) return;

    const title = draft.title || this.app.vault.getName();

    try {
      const result = await exportHandoverPack(
        this.app,
        this.settings,
        { ...draft, title },
        `${this.manifest.name} ${this.manifest.version}`
      );

      new Notice(
        result.isPdf
          ? t("handover.done", {
              path: result.file.path,
              tasks: result.taskCount,
              notes: result.noteCount,
            })
          : t("handover.done_html", { path: result.file.path }),
        result.isPdf ? 8000 : 0
      );
    } catch (error) {
      console.error("Could not build the handover pack", error);
      new Notice(t("handover.failed"));
    }
  }

  /** Persists the Gantt task-column width after a resize drag. */
  async setGanttLabelWidth(width: number): Promise<void> {
    this.settings.ganttLabelWidth = width;
    await this.saveSettings();
  }

  /** Persists the Gantt's manual row order. */
  async setGanttTaskOrder(order: string[]): Promise<void> {
    this.settings.ganttTaskOrder = order;
    await this.saveSettings();
  }

  /** Persists which Gantt parents are folded away. */
  async setGanttCollapsedTaskIds(taskIds: string[]): Promise<void> {
    this.settings.ganttCollapsedTaskIds = taskIds;
    await this.saveSettings();
  }

  /**
   * Persists whether the Gantt draws its rows in date order.
   *
   * A mode rather than a rewrite of the row order: the manual order is left
   * where it is, so turning this off gives the user their own arrangement back.
   */
  async setGanttDateOrder(dateOrder: boolean): Promise<void> {
    this.settings.ganttDateOrder = dateOrder;
    await this.saveSettings();
  }

  /** Persists the Gantt's working-days toggle. */
  async setGanttSkipWeekends(skip: boolean): Promise<void> {
    this.settings.ganttSkipWeekends = skip;
    await this.saveSettings();
  }

  /** Persists the Gantt's milestones; they belong to no note. */
  async setGanttMilestones(milestones: GanttMilestone[]): Promise<void> {
    this.settings.ganttMilestones = milestones;
    await this.saveSettings();
  }

  /** Persists the critical-path toggle, which the map and Gantt share. */
  async setShowCriticalPath(show: boolean): Promise<void> {
    this.settings.showCriticalPath = show;
    await this.saveSettings();
  }

  /** Persists the Gantt's schedule-warning toggle. */
  async setGanttShowWarnings(show: boolean): Promise<void> {
    this.settings.ganttShowWarnings = show;
    await this.saveSettings();
  }

  /** Persists which question the board's columns answer. */
  async setKanbanGroupBy(groupBy: KanbanGroupBy): Promise<void> {
    this.settings.kanbanGroupBy = groupBy;
    await this.saveSettings();
  }

  /**
   * Persists the board's manual card order.
   *
   * One flat list of task IDs for the whole board rather than one per column:
   * a card dragged to another column keeps the place it was dropped in, and
   * changing the grouping does not throw the arrangement away.
   */
  async setKanbanCardOrder(order: string[]): Promise<void> {
    this.settings.kanbanCardOrder = order;
    await this.saveSettings();
  }

  /** Persists which board columns are folded away. */
  async setKanbanCollapsedBuckets(keys: string[]): Promise<void> {
    this.settings.kanbanCollapsedBuckets = keys;
    await this.saveSettings();
  }

  /** Persists per-connection line styles. */
  async setEdgeStyleOverrides(overrides: EdgeStyleOverrides): Promise<void> {
    this.settings.edgeStyleOverrides = overrides;
    await this.saveSettings();
  }

  async savePreset(name: string, filter: FilterState): Promise<void> {
    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      filter,
    };
    this.settings.filterPresets = [...this.settings.filterPresets, preset];
    await this.saveSettings();
  }

  async renamePreset(id: string, name: string): Promise<void> {
    this.settings.filterPresets = this.settings.filterPresets.map((p) =>
      p.id === id ? { ...p, name: name.trim() } : p
    );
    await this.saveSettings();
  }

  async deletePreset(id: string): Promise<void> {
    this.settings.filterPresets = this.settings.filterPresets.filter(
      (p) => p.id !== id
    );
    await this.saveSettings();
  }

  insertPresetIntoNote(preset: FilterPreset): void {
    new NoteSuggestModal(this.app, (file) => {
      void this.appendCodeBlockToFile(
        file,
        preset.filter,
        DEFAULT_EMBED_CONFIG
      );
    }).open();
  }

  insertFilterIntoActiveNote(filter: FilterState | null): void {
    const activeFile = this.app.workspace.getActiveFile();
    const filterToInsert = filter ?? this.getCurrentFilterState();

    if (activeFile) {
      void this.appendCodeBlockToFile(
        activeFile,
        filterToInsert,
        DEFAULT_EMBED_CONFIG
      );
    } else {
      new NoteSuggestModal(this.app, (file) => {
        void this.appendCodeBlockToFile(
          file,
          filterToInsert,
          DEFAULT_EMBED_CONFIG
        );
      }).open();
    }
  }

  private getCurrentFilterState(): FilterState {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view instanceof ProjectPlannerGraphItemView) {
      return leaf.view.getFilterState();
    }
    // Fall back to an empty filter if no active graph view is found
    return { ...DEFAULT_FILTER_STATE };
  }

  private async appendCodeBlockToFile(
    file: TFile,
    filter: FilterState,
    config: EmbedConfig
  ): Promise<void> {
    const payload = JSON.stringify({ filter, config }, null, 2);
    const block = `\n\`\`\`${EMBED_CODE_BLOCK}\n${payload}\n\`\`\`\n`;
    await this.app.vault.process(file, (content) => content + block);
  }

  async activateViewInMainArea() {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Opens a view and points it at one task.
   *
   * The views listen for this rather than reading a shared field, so a view
   * that is already open reacts too instead of only picking it up on mount.
   */
  private async focusTaskInView(
    viewType: string,
    taskId: string
  ): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);

    if (!existing) {
      await leaf.setViewState({ type: viewType, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    // After the view has had a chance to mount
    window.setTimeout(() => requestTaskFocus(viewType, taskId), 50);
  }

  /** Shows a task on the map, opening it if necessary. */
  async focusTaskInMap(taskId: string): Promise<void> {
    await this.focusTaskInView(VIEW_TYPE, taskId);
  }

  /** Shows a task on the timeline, opening it if necessary. */
  async focusTaskInGantt(taskId: string): Promise<void> {
    await this.focusTaskInView(GANTT_VIEW_TYPE, taskId);
  }

  async activateGanttViewInMainArea() {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({ type: GANTT_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  /** Opens a Gantt tab charting only the tasks a Dataview source names. */
  async openGanttForSource(source: string, title: string) {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({
      type: GANTT_VIEW_TYPE,
      active: true,
      state: { source, title },
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  async activateKanbanViewInMainArea() {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({ type: KANBAN_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  async activateOpenQuestionsViewInMainArea() {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({ type: OPEN_QUESTIONS_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  async activateFinanceViewInMainArea() {
    const leaf = this.app.workspace.getLeaf(true); // true = main area
    await leaf.setViewState({ type: FINANCE_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  /** Creates the rates note if it is missing, then opens it either way. */
  async createRateNote(): Promise<void> {
    const file = await ensureRateNote(
      this.app,
      this.settings.financeRateNotePath
    );

    if (!file) {
      new Notice(t("finance.rate_note_failed"));
      return;
    }

    await this.app.workspace.getLeaf(true).openFile(file);
  }

  onunload(): void {
    // Embed roots are cleaned up individually via MarkdownRenderChild
  }
}
