import React from "react";
import {
  ArrowDownWideNarrow,
  CalendarArrowDown,
  CalendarCheck,
  Flag,
  ImageDown,
  Plus,
  RefreshCw,
  Search,
  Undo2,
  Wand2,
} from "lucide-react";
import {
  GANTT_GROUP_BY_OPTIONS,
  GanttGroupBy,
  isGanttGroupBy,
} from "src/lib/gantt-order";
import {
  FIXED_GANTT_SCALES,
  GanttScaleId,
  WINDOW_GANTT_SCALES,
  isWindowGanttScale,
  windowMonths,
} from "src/lib/gantt-scale";
import { t } from "../i18n";

/** Deeper plans still get "all"; past this a level button saves little */
const MAX_OUTLINE_BUTTONS = 4;

function scaleClassName(active: boolean): string {
  return `project-planner-gantt-toolbar__scale ${
    active ? "project-planner-gantt-toolbar__scale--active" : ""
  }`;
}

interface GanttToolbarProps {
  scale: GanttScaleId;
  onScaleChange: (_scale: GanttScaleId) => void;
  /** Levels the task tree goes down; 1 when no task has children */
  outlineDepth: number;
  /** Folds the chart to show `level` levels; `Infinity` opens everything */
  onShowLevel: (_level: number) => void;
  onScrollToToday: () => void;
  onReload: () => void;
  onApplyInferred: () => void;
  inferredCount: number;
  applying: boolean;
  searchQuery: string;
  onSearch: (_query: string) => void;
  hideCompleted: boolean;
  onHideCompletedChange: (_hide: boolean) => void;
  skipWeekends: boolean;
  onSkipWeekendsChange: (_skip: boolean) => void;
  showCriticalPath: boolean;
  onShowCriticalPathChange: (_show: boolean) => void;
  taskCount: number;
  groupBy: GanttGroupBy;
  onGroupByChange: (_groupBy: GanttGroupBy) => void;
  /** True while the chart is drawn flat and earliest first. */
  dateOrder: boolean;
  onToggleDateOrder: () => void;
  onAddTask: () => void;
  onAddMilestone: () => void;
  /** Draws the chart as it stands into a PNG for a document. */
  onExport: () => void;
  exporting: boolean;
  onUndoOrder: () => void;
  canUndoOrder: boolean;
  /** What pressing undo would reverse, for the tooltip. */
  undoLabel: string | null;
}

export function GanttToolbar({
  scale,
  onScaleChange,
  outlineDepth,
  onShowLevel,
  onScrollToToday,
  onReload,
  onApplyInferred,
  inferredCount,
  applying,
  searchQuery,
  onSearch,
  hideCompleted,
  onHideCompletedChange,
  skipWeekends,
  onSkipWeekendsChange,
  showCriticalPath,
  onShowCriticalPathChange,
  taskCount,
  groupBy,
  onGroupByChange,
  dateOrder,
  onToggleDateOrder,
  onAddTask,
  onAddMilestone,
  onExport,
  exporting,
  onUndoOrder,
  canUndoOrder,
  undoLabel,
}: GanttToolbarProps) {
  return (
    <div className="project-planner-gantt-toolbar">
      <div className="project-planner-gantt-toolbar__group">
        {FIXED_GANTT_SCALES.map((option) => (
          <button
            key={option}
            className={scaleClassName(option === scale)}
            onClick={() => onScaleChange(option)}
          >
            {t(`gantt.scale_${option}`)}
          </button>
        ))}
        {/* A window scale shows that many months across the chart, however
            wide it is; six of them would crowd out the rest of the toolbar
            as buttons. */}
        <select
          className={`project-planner-gantt-toolbar__window ${scaleClassName(
            isWindowGanttScale(scale)
          )}`}
          value={isWindowGanttScale(scale) ? scale : ""}
          title={t("gantt.scale_window_desc")}
          aria-label={t("gantt.scale_window_desc")}
          onChange={(event) => {
            const value = event.target.value;
            if (isWindowGanttScale(value)) onScaleChange(value);
          }}
        >
          <option value="" disabled hidden>
            {t("gantt.scale_window")}
          </option>
          {WINDOW_GANTT_SCALES.map((option) => (
            <option key={option} value={option}>
              {t("gantt.scale_window_months", {
                count: windowMonths(option),
              })}
            </option>
          ))}
        </select>
        <button
          className={scaleClassName(scale === "fit")}
          onClick={() => onScaleChange("fit")}
          title={t("gantt.scale_fit_desc")}
        >
          {t("gantt.scale_fit")}
        </button>
      </div>

      {/* One-off folds rather than a mode, so they never look pressed: a row
          opened by hand afterwards stays open */}
      {outlineDepth > 1 && (
        <div
          className="project-planner-gantt-toolbar__group"
          title={t("gantt.outline_desc")}
        >
          <span className="project-planner-gantt-toolbar__group-label">
            {t("gantt.outline")}
          </span>
          {Array.from(
            { length: Math.min(outlineDepth - 1, MAX_OUTLINE_BUTTONS) },
            (_, index) => index + 1
          ).map((level) => (
            <button
              key={level}
              className={scaleClassName(false)}
              onClick={() => onShowLevel(level)}
              title={t("gantt.outline_level_desc", { level })}
            >
              {level}
            </button>
          ))}
          <button
            className={scaleClassName(false)}
            onClick={() => onShowLevel(Infinity)}
            title={t("gantt.outline_all_desc")}
          >
            {t("gantt.outline_all")}
          </button>
        </div>
      )}

      <button
        className="project-planner-gantt-toolbar__button"
        onClick={onScrollToToday}
        title={t("gantt.jump_to_today")}
      >
        <CalendarCheck size={14} />
        <span>{t("gantt.today")}</span>
      </button>

      <button
        className="project-planner-gantt-toolbar__button project-planner-gantt-toolbar__button--accent"
        onClick={onAddTask}
        title={t("gantt.add_task_desc")}
      >
        <Plus size={14} />
        <span>{t("gantt.add_task")}</span>
      </button>

      <button
        className="project-planner-gantt-toolbar__button"
        onClick={onAddMilestone}
        title={t("gantt.add_milestone_desc")}
      >
        <Flag size={14} />
        <span>{t("gantt.add_milestone")}</span>
      </button>

      {/* A mode, not a one-off shuffle: while it is on the chart stays sorted
          and the rows stay flat, and the manual order waits underneath. It
          says so three ways over — filled in, a calendar in place of the sort
          arrows, and a name that turns from the action into the state — since
          a toggle that looks like every other button is one the user has to
          press to find out what it did. */}
      <button
        className={`project-planner-gantt-toolbar__button ${
          dateOrder ? "project-planner-gantt-toolbar__button--active" : ""
        }`}
        onClick={onToggleDateOrder}
        aria-pressed={dateOrder}
        title={
          dateOrder
            ? t("gantt.sort_by_date_off_desc")
            : t("gantt.sort_by_date_desc")
        }
      >
        {dateOrder ? (
          <CalendarArrowDown size={14} />
        ) : (
          <ArrowDownWideNarrow size={14} />
        )}
        <span>
          {dateOrder ? t("gantt.sorted_by_date") : t("gantt.sort_by_date")}
        </span>
      </button>

      <button
        className="project-planner-gantt-toolbar__button"
        onClick={onUndoOrder}
        disabled={!canUndoOrder}
        title={undoLabel ?? t("gantt.undo_order_desc")}
      >
        <Undo2 size={14} />
        <span>{t("gantt.undo_order")}</span>
      </button>

      <label className="project-planner-gantt-toolbar__toggle">
        <span>{t("gantt.group_by")}</span>
        <select
          value={groupBy}
          onChange={(event) => {
            const value = event.target.value;
            if (isGanttGroupBy(value)) onGroupByChange(value);
          }}
        >
          {GANTT_GROUP_BY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`gantt.group_by_${option}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="project-planner-gantt-toolbar__search">
        <Search size={14} />
        <input
          type="text"
          value={searchQuery}
          placeholder={t("gantt.search_placeholder")}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <label className="project-planner-gantt-toolbar__toggle">
        <input
          type="checkbox"
          checked={hideCompleted}
          onChange={(event) => onHideCompletedChange(event.target.checked)}
        />
        <span>{t("gantt.hide_completed")}</span>
      </label>

      <label
        className="project-planner-gantt-toolbar__toggle"
        title={t("gantt.skip_weekends_desc")}
      >
        <input
          type="checkbox"
          checked={skipWeekends}
          onChange={(event) => onSkipWeekendsChange(event.target.checked)}
        />
        <span>{t("gantt.skip_weekends")}</span>
      </label>

      <label
        className="project-planner-gantt-toolbar__toggle"
        title={t("gantt.critical_path_desc")}
      >
        <input
          type="checkbox"
          checked={showCriticalPath}
          onChange={(event) => onShowCriticalPathChange(event.target.checked)}
        />
        <span>{t("gantt.critical_path")}</span>
      </label>

      <span className="project-planner-gantt-toolbar__count">
        {t("gantt.task_count", { n: taskCount })}
      </span>

      <div className="project-planner-gantt-toolbar__spacer" />

      {inferredCount > 0 && (
        <button
          className="project-planner-gantt-toolbar__button project-planner-gantt-toolbar__button--accent"
          onClick={onApplyInferred}
          disabled={applying}
          title={t("gantt.apply_inferred_desc")}
        >
          <Wand2 size={14} />
          <span>{t("gantt.apply_inferred", { n: inferredCount })}</span>
        </button>
      )}

      {/* Beside the other things that leave the chart rather than change it,
          and away from the editing controls: exporting writes a picture, not
          a task. */}
      <button
        className="project-planner-gantt-toolbar__button"
        onClick={onExport}
        disabled={exporting}
        title={t("gantt.export_desc")}
      >
        <ImageDown size={14} />
        <span>{exporting ? t("gantt.exporting") : t("gantt.export")}</span>
      </button>

      <button
        className="project-planner-gantt-toolbar__button"
        onClick={onReload}
        title={t("gantt.reload")}
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}
