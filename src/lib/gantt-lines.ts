/**
 * The flat list of lines the Gantt draws.
 *
 * Three things end up in one column: group headings, task rows (already
 * nested and folded by `task-hierarchy`), and milestones the user asked to see
 * as a row rather than as a flag in the lane above the chart. Working out the
 * running order is the whole job of this module, and it is pure so it can be
 * tested without a chart.
 *
 * A row milestone is not a task. It has no bar, no duration, no dependencies
 * and no children, and nothing that counts or analyses tasks ever sees it —
 * it only ever appears here, at the point where lines are laid out.
 */

import {
  GanttMilestone,
  milestoneOrderKey,
  rowMilestones,
} from "./gantt-milestones";
import { GanttRow } from "./gantt-rows";
import { HierarchyGroup } from "./task-hierarchy";

/** A rendered line: a group heading, a task row, or a milestone. */
export type ChartLine =
  | { kind: "header"; key: string; orderId: null; label: string; count: number }
  | {
      kind: "row";
      key: string;
      /** This row's slot in the manual order, i.e. its task ID. */
      orderId: string;
      row: GanttRow;
      /** How far the label indents: 0 for a top-level task. */
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      /** What a collapsed row hides, drawn faintly inside it */
      rollup?: GanttRow[];
    }
  | {
      kind: "milestone";
      key: string;
      /** This milestone's slot in the manual order. */
      orderId: string;
      milestone: GanttMilestone;
    };

/** Ranks by position in the manual order; anything unranked sorts last. */
function rankLookup(order: string[]): (_id: string) => number {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  return (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
}

/** A group heading and its rows, each tagged with the rank it sits at. */
interface RankedLine {
  line: ChartLine;
  /**
   * The order position this line stands at. A heading borrows the rank of the
   * first row under it, so a milestone that belongs above that group lands
   * above its heading rather than wedged between the heading and its rows.
   */
  rank: number;
}

/**
 * Every group's heading and its visible rows, in one flat list.
 *
 * The nesting is already done by the time this runs — each group arrives with
 * its own subtree flattened, rows hidden inside a collapsed parent already
 * gone. That is deliberate: hierarchy applies *within* a group, never across
 * one. If a parent and a child end up under different headings (they carry
 * different tags, say) each is drawn where its own metadata puts it, as a
 * top-level row. Indenting a child under a heading its parent is not filed
 * under would claim a relationship the grouping has just denied, and moving
 * the child to its parent's group would quietly overrule the grouping the user
 * asked for.
 */
function buildTaskLines(
  groups: HierarchyGroup[],
  rankOf: (_id: string) => number
) {
  const ranked: RankedLine[] = [];

  for (const group of groups) {
    const firstRank = group.lines.reduce(
      (lowest, line) => Math.min(lowest, rankOf(line.row.task.id)),
      Number.MAX_SAFE_INTEGER
    );

    if (group.label) {
      ranked.push({
        rank: firstRank,
        line: {
          kind: "header",
          key: `group:${group.key}`,
          orderId: null,
          label: group.label,
          count: group.count,
        },
      });
    }

    for (const line of group.lines) {
      ranked.push({
        rank: rankOf(line.row.task.id),
        line: {
          kind: "row",
          key: line.row.task.id,
          orderId: line.row.task.id,
          row: line.row,
          depth: line.depth,
          hasChildren: line.hasChildren,
          collapsed: line.collapsed,
          ...(line.rollup ? { rollup: line.rollup } : {}),
        },
      });
    }
  }

  return ranked;
}

/**
 * The lines to draw, with row milestones slotted in among the tasks.
 *
 * Both kinds of line take their place from the same flat order (see
 * `MILESTONE_ORDER_PREFIX`), so a milestone sits wherever the user dragged it
 * — before the first task, between two groups, after everything. A milestone
 * the order has never seen goes last, which is where a brand-new one belongs
 * until it is moved.
 *
 * Grouping never files a milestone under a heading: it has no tag, no status,
 * no note and no project, so there is no heading it could honestly belong to.
 * It is drawn between groups instead, at the depth of a top-level row.
 */
export function buildLines(
  groups: HierarchyGroup[],
  milestones: GanttMilestone[],
  order: string[]
): ChartLine[] {
  const rankOf = rankLookup(order);
  const ranked = buildTaskLines(groups, rankOf);

  const pending = rowMilestones(milestones)
    .map((milestone) => ({
      milestone,
      rank: rankOf(milestoneOrderKey(milestone.id)),
    }))
    .sort((a, b) => a.rank - b.rank);

  const lines: ChartLine[] = [];
  let next = 0;

  const flushBefore = (rank: number) => {
    while (next < pending.length && pending[next].rank < rank) {
      const { milestone } = pending[next];
      lines.push({
        kind: "milestone",
        key: milestoneOrderKey(milestone.id),
        orderId: milestoneOrderKey(milestone.id),
        milestone,
      });
      next += 1;
    }
  };

  for (const entry of ranked) {
    flushBefore(entry.rank);
    lines.push(entry.line);
  }

  flushBefore(Number.MAX_SAFE_INTEGER);
  // Anything still unplaced ranks at the very end of the order, or nowhere in
  // it at all; either way it belongs after the last task
  for (; next < pending.length; next++) {
    const { milestone } = pending[next];
    lines.push({
      kind: "milestone",
      key: milestoneOrderKey(milestone.id),
      orderId: milestoneOrderKey(milestone.id),
      milestone,
    });
  }

  return lines;
}

/** The rows on screen, in the order they are drawn. */
export function visibleRowsOf(lines: ChartLine[]): GanttRow[] {
  return lines.flatMap((line) => (line.kind === "row" ? [line.row] : []));
}
