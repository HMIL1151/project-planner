import React from "react";
import { TaskStatus } from "src/types/task";
import { t } from "../i18n";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "canceled"];

interface GanttLegendProps {
  /** The critical entry only earns its place when the path is being drawn. */
  showCriticalPath: boolean;
}

/** Explains what the bar colours and the dashed outline mean. */
export function GanttLegend({ showCriticalPath }: GanttLegendProps) {
  return (
    <div className="project-planner-gantt-legend">
      {STATUSES.map((status) => (
        <span key={status} className="project-planner-gantt-legend__item">
          <span
            className={`project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--${status}`}
          />
          {t(`gantt.legend_${status}`)}
        </span>
      ))}
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--inferred" />
        {t("gantt.legend_suggested")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--summary" />
        {t("gantt.legend_summary")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--rollup" />
        {t("gantt.legend_rollup")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--today" />
        {t("gantt.legend_today")}
      </span>
      {showCriticalPath && (
        <span className="project-planner-gantt-legend__item">
          <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--critical" />
          {t("gantt.legend_critical")}
        </span>
      )}
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--at-risk" />
        {t("gantt.legend_at_risk")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--milestone" />
        {t("gantt.legend_milestone")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--upstream" />
        {t("gantt.legend_upstream")}
      </span>
      <span className="project-planner-gantt-legend__item">
        <span className="project-planner-gantt-legend__swatch project-planner-gantt-legend__swatch--downstream" />
        {t("gantt.legend_downstream")}
      </span>
    </div>
  );
}
