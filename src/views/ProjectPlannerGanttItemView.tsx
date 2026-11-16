import React, { useEffect, useState } from "react";
import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { AppContext } from "src/contexts/context";
import { ProjectPlannerSettings } from "src/types/settings";
import { checkDataviewPlugin } from "../lib/utils";
import ProjectPlannerPlugin from "../main";
import GanttView from "./GanttView";
import { GANTT_VIEW_TYPE } from "src/lib/view-focus";
import { t } from "../i18n";

export { GANTT_VIEW_TYPE };

/**
 * What a Gantt tab remembers between sessions: the project it was opened for,
 * when a `project-planner-gantt` block opened it. A tab opened from the ribbon
 * has neither and charts every task.
 */
export interface GanttViewState {
  source: string;
  title: string;
}

function readGanttViewState(state: unknown): GanttViewState {
  const obj =
    typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)
      : {};
  return {
    source: typeof obj.source === "string" ? obj.source : "",
    title: typeof obj.title === "string" ? obj.title : "",
  };
}

/** Keeps the chart in step with the settings tab, like the graph view does. */
function GanttViewWrapper({
  plugin,
  source,
}: {
  plugin: ProjectPlannerPlugin;
  source: string;
}) {
  const [settings, setSettings] = useState<ProjectPlannerSettings>({
    ...plugin.settings,
  });

  useEffect(() => {
    const handler = () => setSettings({ ...plugin.settings });
    window.addEventListener("project-planner:settings-changed", handler);
    return () =>
      window.removeEventListener("project-planner:settings-changed", handler);
  }, [plugin]);

  return <GanttView settings={settings} plugin={plugin} source={source} />;
}

export default class ProjectPlannerGanttItemView extends ItemView {
  root: Root | null = null;
  plugin: ProjectPlannerPlugin;
  private viewState: GanttViewState = { source: "", title: "" };

  /**
   * The plugin is handed in rather than looked up. It used to be fetched
   * out of `app.plugins.plugins` by a hard-coded id, which tied the view to
   * the folder name the plugin happened to be installed under — rename the
   * folder, or install it beside an older copy, and every view opened onto
   * an error instead. `registerView` already runs on the plugin.
   */
  constructor(leaf: WorkspaceLeaf, plugin: ProjectPlannerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return GANTT_VIEW_TYPE;
  }

  getDisplayText() {
    return this.viewState.title
      ? t("gantt.view_title_project", { project: this.viewState.title })
      : t("gantt.view_title");
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.viewState };
  }

  // Obsidian opens the view before handing it its state, so the chart drawn
  // in `onOpen` is redrawn here once the tab knows its project
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.viewState = readGanttViewState(state);
    await super.setState(state, result);
    this.render();
  }

  getIcon() {
    return "gantt-chart";
  }

  async onOpen() {
    this.root = createRoot(this.containerEl.children[1]);
    this.render();
  }

  private render() {
    if (!this.root) return;
    const dataviewCheck = checkDataviewPlugin(this.app);

    if (!dataviewCheck.isReady) {
      this.root.render(
        <div className="project-planner-centered-message-container">
          <div className="project-planner-centered-message-content">
            <div className="project-planner-message-icon">⚠️</div>
            <h3 className="project-planner-message-title">
              {t("view.dataview_required")}
            </h3>
            <p className="project-planner-message-description">
              {dataviewCheck.getMessage()}
            </p>
          </div>
        </div>
      );
      return;
    }

    this.root.render(
      <AppContext.Provider value={this.app}>
        <GanttViewWrapper plugin={this.plugin} source={this.viewState.source} />
      </AppContext.Provider>
    );
  }

  async onClose() {
    this.root?.unmount();
  }
}
