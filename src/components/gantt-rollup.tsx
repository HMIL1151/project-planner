import React, { useCallback } from "react";
import { diffDays, inclusiveDayCount } from "src/lib/date-utils";
import { GanttRow } from "src/lib/gantt-rows";
import { effectiveTaskStatus } from "src/lib/task-progress";
import { plainTaskText } from "src/lib/task-text";

interface GanttRollupProps {
  /** The work a collapsed row hides: its leaf tasks */
  rows: GanttRow[];
  timelineStart: string;
  isAtRisk: (_taskId: string) => boolean;
}

/**
 * The inside of a collapsed row: each hidden task as a faint strip under the
 * summary rail, and each one-day task as a diamond, since at a coarse scale a
 * one-day bar is a pixel wide and a gate or go-live would vanish.
 *
 * The strips are translucent so parallel work stacks into a darker band and a
 * gap between phases shows as a gap. They are read-only: open the row to move
 * anything.
 */
export function GanttRollup({
  rows,
  timelineStart,
  isAtRisk,
}: GanttRollupProps) {
  const setSpanRef = useCallback(
    (offset: number, span: number) => (el: HTMLDivElement | null) => {
      if (!el) return;
      el.style.setProperty("--bar-offset", String(offset));
      el.style.setProperty("--bar-span", String(span));
    },
    []
  );

  return (
    <div className="project-planner-gantt-rollup">
      {rows.map((row) => {
        const { bar, task } = row;
        const point = bar.start === bar.end;
        const classNames = [
          "project-planner-gantt-rollup__item",
          point
            ? "project-planner-gantt-rollup__item--point"
            : "project-planner-gantt-rollup__item--span",
          `project-planner-gantt-rollup__item--${effectiveTaskStatus(
            task.status,
            task.progress
          )}`,
          isAtRisk(task.id)
            ? "project-planner-gantt-rollup__item--at-risk"
            : "",
        ].join(" ");

        return (
          <div
            key={task.id}
            className={classNames}
            ref={setSpanRef(
              diffDays(timelineStart, bar.start),
              inclusiveDayCount(bar.start, bar.end)
            )}
            title={
              point
                ? `${plainTaskText(task.summary)} · ${bar.start}`
                : `${plainTaskText(task.summary)} · ${bar.start} – ${bar.end}`
            }
          />
        );
      })}
    </div>
  );
}
