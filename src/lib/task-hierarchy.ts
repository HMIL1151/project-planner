/**
 * Parent/child structure for the Gantt.
 *
 * A task can sit inside another one, and the relationship is stored on the
 * child (see `task-parent`). This module is where a flat list of rows becomes
 * a tree: it works out who really is whose parent, gives a task with children
 * a bar spanning everything beneath it, and flattens the tree back into the
 * lines the chart draws, leaving out whatever is hidden inside a collapsed
 * parent.
 *
 * Everything here treats the stored relationships as untrusted. A vault is
 * hand-edited text: a task can name itself as its parent, two tasks can name
 * each other, a chain can loop back on itself after five hops, and a parent
 * can name an ID that no longer exists or that the current filter has taken
 * off screen. None of those may hang the view or lose a row, so every one of
 * them resolves the same way — the link that cannot be honoured is dropped and
 * the task stands as a root. A user who has written a loop still sees all of
 * their tasks; they just do not see the loop.
 *
 * Nothing recurses. Depth is bounded only by how many tasks a vault has, and a
 * long enough chain would overflow the stack on a recursive walk, so the tree
 * is built, rolled up and flattened with explicit loops.
 */

import { toEpochDay } from "./date-utils";
import { GanttRow } from "./gantt-rows";

/** A row and the rows nested inside it. */
export interface HierarchyNode {
  /** The row, carrying a rolled-up bar once it has children. */
  row: GanttRow;
  children: HierarchyNode[];
}

/** One line the chart draws, and where it sits in the tree. */
export interface HierarchyLine {
  row: GanttRow;
  /** 0 for a top-level task, 1 for its children, and so on. */
  depth: number;
  hasChildren: boolean;
  /** True when this row's subtree is hidden. Only ever set on a parent. */
  collapsed: boolean;
  /**
   * The tasks a collapsed row hides that do the work: its descendants with no
   * children of their own, in tree order. The chart draws them faintly in the
   * folded row, so folding a stream away does not hide where its work falls.
   * Absent on a row that is not collapsed.
   */
  rollup?: GanttRow[];
}

export interface HierarchyResult {
  lines: HierarchyLine[];
  /**
   * The parent every row ended up with, after unresolvable links and loops
   * were broken. This — not what the tasks say — is the structure on screen,
   * so it is also what row dragging has to respect.
   */
  parentById: Map<string, string | null>;
}

/** A group's heading and the lines it shows, ready to render. */
export interface HierarchyGroup {
  key: string;
  label: string;
  /** Tasks filed under this heading, including ones hidden by a collapse. */
  count: number;
  lines: HierarchyLine[];
}

/** Walk states for the cycle-breaking pass below. */
const RESOLVING = 1;
const DONE = 2;

/**
 * The parent each row really has.
 *
 * A link is dropped — the task becomes a root — when it points at the task
 * itself, at an ID no row in this set carries (deleted, or filtered out of
 * view), or at an ancestor that would close a loop.
 *
 * Loops are broken by walking each task's ancestry once and marking the nodes
 * on the way up. Meeting a node that is still being walked means the chain has
 * come back on itself, and that node is the one made a root: it is the task
 * whose own parent link closed the loop. Every other link in the loop survives,
 * so `A parent B, B parent A` renders as A holding B rather than as two rows
 * that have lost their relationship entirely.
 */
export function resolveParentIds(rows: GanttRow[]): Map<string, string | null> {
  const taskById = new Map(rows.map((row) => [row.task.id, row.task]));
  const resolved = new Map<string, string | null>();
  const state = new Map<string, number>();

  /** The parent a task names, once the links that cannot hold are dropped. */
  const namedParent = (id: string): string | null => {
    const parentId = taskById.get(id)?.parentId ?? null;
    if (parentId === null || parentId === id) return null;
    return taskById.has(parentId) ? parentId : null;
  };

  for (const row of rows) {
    const chain: string[] = [];
    let current: string | null = row.task.id;

    while (current !== null) {
      const seen = state.get(current);
      if (seen === DONE) break;
      if (seen === RESOLVING) {
        // Back where this walk has already been: this link closes the loop
        resolved.set(current, null);
        break;
      }

      state.set(current, RESOLVING);
      chain.push(current);
      current = namedParent(current);
    }

    for (const id of chain) {
      if (!resolved.has(id)) resolved.set(id, namedParent(id));
      state.set(id, DONE);
    }
  }

  return resolved;
}

/** How deep each task sits, roots at 0. Assumes an already-broken tree. */
function depthsFrom(
  parentById: ReadonlyMap<string, string | null>
): Map<string, number> {
  const depths = new Map<string, number>();

  for (const id of parentById.keys()) {
    const chain: string[] = [];
    let current: string | null = id;

    while (current !== null && !depths.has(current)) {
      chain.push(current);
      current = parentById.get(current) ?? null;
    }

    let depth = current === null ? -1 : (depths.get(current) ?? -1);
    for (let i = chain.length - 1; i >= 0; i--) {
      depth += 1;
      depths.set(chain[i], depth);
    }
  }

  return depths;
}

/**
 * The bar a parent takes from its children: earliest start to latest end.
 *
 * Returns null when no child offers a usable pair of dates, which leaves the
 * parent drawing its own bar — a task whose children are all undated is still
 * a task, and blanking it would be worse than showing what it does know.
 */
function rolledUpDates(
  children: HierarchyNode[]
): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;

  for (const child of children) {
    const bar = child.row.bar;
    if (
      toEpochDay(bar.start) !== null &&
      (start === null || bar.start < start)
    ) {
      start = bar.start;
    }
    if (toEpochDay(bar.end) !== null && (end === null || bar.end > end)) {
      end = bar.end;
    }
  }

  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * The rows as a tree, deepest bars rolled up first so a grandparent spans
 * everything beneath it and not merely its own children's written dates.
 *
 * A rolled-up bar overrides whatever dates the parent itself carries. Those
 * dates are not lost — they are still on the task, and still what an edit
 * writes — but a summary that disagreed with the work under it would be
 * telling the user something untrue about their own plan.
 */
export function buildHierarchyTree(rows: GanttRow[]): {
  roots: HierarchyNode[];
  parentById: Map<string, string | null>;
} {
  const parentById = resolveParentIds(rows);
  const nodeById = new Map<string, HierarchyNode>();
  const roots: HierarchyNode[] = [];

  for (const row of rows) {
    nodeById.set(row.task.id, { row, children: [] });
  }

  // Row order decides sibling order, so the manual order the user dragged into
  // place still holds inside each parent
  for (const row of rows) {
    const node = nodeById.get(row.task.id);
    if (!node) continue;

    const parentId = parentById.get(row.task.id) ?? null;
    const parent = parentId === null ? undefined : nodeById.get(parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const depths = depthsFrom(parentById);
  const deepestFirst = [...nodeById.values()].sort(
    (a, b) =>
      (depths.get(b.row.task.id) ?? 0) - (depths.get(a.row.task.id) ?? 0)
  );

  for (const node of deepestFirst) {
    if (node.children.length === 0) continue;

    const dates = rolledUpDates(node.children);
    if (!dates) continue;

    node.row = {
      ...node.row,
      bar: {
        ...node.row.bar,
        start: dates.start,
        end: dates.end,
        // The span is read off the children, so it is a fact about the plan
        // rather than a suggestion waiting to be written to the note
        startInferred: false,
        endInferred: false,
      },
      inferred: false,
    };
  }

  return { roots, parentById };
}

/**
 * The tree walked top to bottom, skipping whatever sits inside a collapsed
 * parent. A collapsed leaf is not a thing: the flag only means anything on a
 * row that has children, so a stale ID left in the collapsed set after its
 * children were deleted quietly stops applying.
 */
export function flattenHierarchy(
  roots: HierarchyNode[],
  collapsedIds: ReadonlySet<string>
): HierarchyLine[] {
  const lines: HierarchyLine[] = [];
  const stack: Array<{ node: HierarchyNode; depth: number }> = [];

  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ node: roots[i], depth: 0 });
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;

    const { node, depth } = entry;
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && collapsedIds.has(node.row.task.id);

    if (collapsed) {
      lines.push({
        row: node.row,
        depth,
        hasChildren,
        collapsed,
        rollup: leafRows(node),
      });
      continue;
    }

    lines.push({ row: node.row, depth, hasChildren, collapsed });

    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i], depth: depth + 1 });
    }
  }

  return lines;
}

/** Every descendant of `node` with no children of its own, in tree order. */
function leafRows(node: HierarchyNode): GanttRow[] {
  const leaves: GanttRow[] = [];
  const stack = [...node.children].reverse();

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    if (next.children.length === 0) {
      leaves.push(next.row);
      continue;
    }
    for (let i = next.children.length - 1; i >= 0; i--) {
      stack.push(next.children[i]);
    }
  }

  return leaves;
}

/** The lines to draw for one set of rows, and the structure they came out of. */
export function buildHierarchy(
  rows: GanttRow[],
  collapsedIds: ReadonlySet<string>
): HierarchyResult {
  const { roots, parentById } = buildHierarchyTree(rows);
  return { lines: flattenHierarchy(roots, collapsedIds), parentById };
}

/**
 * The same rows drawn as one flat list, in whatever order `compare` asks for.
 *
 * Nesting only ever decides the order of siblings, so a chart that keeps its
 * indenting cannot put a row next to an unrelated task that happens to start
 * the same day. Sorting the whole chart therefore has to give the indenting up
 * — every row becomes a line of its own, at the top level.
 *
 * What the tree earned is kept: a parent still carries the bar rolled up over
 * its children, and it is that bar `compare` is handed, so a summary lands
 * where the work under it actually falls. Collapsing goes on working too — a
 * folded parent still hides its children, which are still its children, they
 * just are not drawn underneath it any more.
 */
export function buildFlatHierarchy(
  rows: GanttRow[],
  collapsedIds: ReadonlySet<string>,
  compare: (_a: GanttRow, _b: GanttRow) => number
): HierarchyResult {
  const { roots, parentById } = buildHierarchyTree(rows);
  const lines = flattenHierarchy(roots, collapsedIds).map((line) => ({
    ...line,
    depth: 0,
  }));

  lines.sort((a, b) => compare(a.row, b.row));
  return { lines, parentById };
}

/** Children keyed by parent, in the order their rows were given. */
export function childrenByParent(
  parentById: ReadonlyMap<string, string | null>
): Map<string, string[]> {
  const children = new Map<string, string[]>();

  for (const [id, parentId] of parentById) {
    if (parentId === null) continue;
    const siblings = children.get(parentId);
    if (siblings) {
      siblings.push(id);
    } else {
      children.set(parentId, [id]);
    }
  }

  return children;
}

/**
 * Everything nested under a task, at any depth. The task itself is not in the
 * set. Safe on a map that still has a loop in it: nothing is visited twice.
 */
export function collectDescendantIds(
  parentById: ReadonlyMap<string, string | null>,
  taskId: string
): Set<string> {
  const children = childrenByParent(parentById);
  const descendants = new Set<string>();
  const queue = [...(children.get(taskId) ?? [])];

  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || id === taskId || descendants.has(id)) continue;

    descendants.add(id);
    queue.push(...(children.get(id) ?? []));
  }

  return descendants;
}

/** Every task that has at least one child among these rows. */
export function parentTaskIds(
  parentById: ReadonlyMap<string, string | null>
): Set<string> {
  const ids = new Set<string>();

  for (const parentId of parentById.values()) {
    if (parentId !== null) ids.add(parentId);
  }

  return ids;
}

/** The collapsed set with one task's state flipped. */
export function toggleCollapsed(
  collapsedIds: readonly string[],
  taskId: string
): string[] {
  return collapsedIds.includes(taskId)
    ? collapsedIds.filter((id) => id !== taskId)
    : [...collapsedIds, taskId];
}

/**
 * The collapsed set that shows the chart `level` deep: level 1 is the
 * top-level tasks alone, level 2 adds their children, and so on. `Infinity`
 * opens everything.
 *
 * Every parent below the cut is folded too, not only the ones on it, so that
 * opening one of those afterwards shows a single level rather than its whole
 * subtree at once. Collapsed IDs for tasks not on this chart — another
 * project's, or ones filtered away — are left as they were.
 */
export function collapsedIdsForLevel(
  collapsedIds: readonly string[],
  parentById: ReadonlyMap<string, string | null>,
  level: number
): string[] {
  const depths = depthsFrom(parentById);
  const kept = collapsedIds.filter((id) => !parentById.has(id));
  const folded = [...parentTaskIds(parentById)].filter(
    (id) => (depths.get(id) ?? 0) >= level - 1
  );

  return [...kept, ...folded];
}

/** How many levels deep the tree goes: 1 when no task has children. */
export function hierarchyDepth(
  parentById: ReadonlyMap<string, string | null>
): number {
  let deepest = 0;
  for (const depth of depthsFrom(parentById).values()) {
    deepest = Math.max(deepest, depth);
  }
  return deepest + 1;
}

/**
 * The collapsed set with a whole branch folded or opened: the task and every
 * parent beneath it follow the task's own new state. Opening a branch this way
 * shows all of it, and folding it leaves nothing half-open inside to surprise
 * the user the next time it is opened one level at a time.
 */
export function toggleBranchCollapsed(
  collapsedIds: readonly string[],
  parentById: ReadonlyMap<string, string | null>,
  taskId: string
): string[] {
  const parents = parentTaskIds(parentById);
  const branch = new Set(
    [taskId, ...collectDescendantIds(parentById, taskId)].filter((id) =>
      parents.has(id)
    )
  );
  const rest = collapsedIds.filter((id) => !branch.has(id));

  return collapsedIds.includes(taskId) ? rest : [...rest, ...branch];
}
