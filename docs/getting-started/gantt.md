# Gantt View

The Gantt view puts the same tasks the map shows onto a timeline, so you can
plan when work happens rather than just how it connects.

Open it from the **Gantt chart** ribbon icon, or with the **Open Gantt view**
command.

!!! tip
    In a large vault, give each project its own chart: a [`project-planner-gantt` block](embedding.md#a-gantt-chart-in-a-note) in the project's note shows only that project's tasks.

## Every task gets a bar

Most tasks in a real vault have no dates, and a chart that only drew dated
tasks would be nearly empty. So every task gets a bar:

- A task with a start date (🛫, or ⏳ scheduled as a fallback) and a due date
  (📅) is drawn between them.
- A task with only a start date runs for one day.
- A task with only a due date is drawn from the day its blockers finish up to
  the deadline, showing the window available for the work.
- A task with **no** dates is placed by its dependencies: it starts the day
  after the last task blocking it finishes, and lasts one day. A task with no
  dated blockers sits on today.

Because inference follows the dependency graph, a chain of undated tasks
spreads out day by day in the order the map says they have to happen.

## Suggested dates are proposals

Bars whose dates were inferred are drawn as **dashed outlines**, and nothing is
written to your notes while they stay that way. To turn a proposal into a real
date:

- **Drag or resize the bar** — writes that one task, or
- **Apply suggested dates** in the toolbar — writes every dashed bar at once,
  reporting how many notes were updated.

## Row order

The chart never rearranges itself unless you ask it to. Rows keep the order you
put them in, and new tasks are appended rather than slotted in by date.

| Control          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| Drag the grip    | Moves a row; the order is saved                            |
| Sort by date     | Switches date order on or off (see below)                  |
| Undo             | Steps back through previous orders, including after a drag |
| Group by         | Splits rows by tag, status, note, or project               |

A task with several tags is filed under one of them only — drawing it in every
matching group would duplicate the bar.

### Date order

**Sort by date** is a mode rather than a one-off shuffle. While it is on the
chart draws every row **flat** — no indenting — and strictly earliest first, so
a child sits next to whatever else starts that day rather than under its
parent. Nesting only ever decides the order of rows within a parent, so an
indented chart could never be in true date order.

A parent is sorted by the bar it draws, i.e. the span rolled up over its
children, and it can still be collapsed to fold them away. Milestones drawn as
rows sort in on their own date alongside the tasks.

Your own row order is untouched underneath: dragging is switched off while the
mode is on, and turning it off puts the arrangement — and the nesting — back
exactly as it was.

## Adding and linking tasks

| Control                    | What it does                                                |
| -------------------------- | ------------------------------------------------------------ |
| **Add task** in the toolbar | Adds a task at the end of the list                          |
| **+** on a row             | Writes a task directly below that one, in the same note      |
| **Link** on a row          | Starts a dependency — click the task it should block, Escape to cancel |

Links are written with the same `⛔` / `🆔` metadata the map uses, so anything
you connect here shows up in the map too.

## Milestones

A milestone is a named day marked across the whole chart — "Design freeze",
"Release 1.0" — drawn as a diamond in its own band above the rows, with a
dashed line running down the timeline.

Milestones are not tasks. They have no note behind them, no duration and no
dependencies, so nothing is ever written to your vault: they are saved with
the plugin's settings and show up on every chart.

| Control                       | What it does                                    |
| ----------------------------- | ----------------------------------------------- |
| **Milestone** in the toolbar  | Asks for a name and a date, then marks the day  |
| Drag a diamond                | Moves the milestone, snapping to whole days     |
| Click a diamond               | Reopens it to rename, re-date, or delete it     |
| Undo                          | Steps back through milestone changes too        |

A milestone that has already passed is drawn in grey, one falling today in
orange, and anything still ahead in purple. The timeline always stretches far
enough to reach the milestones, so one set months out is never off the end of
the chart.

## Editing the timeline

| Action                     | Result                                          |
| -------------------------- | ----------------------------------------------- |
| Drag a bar sideways        | Moves start and due together, keeping its length |
| Drag the left edge         | Changes the start date                          |
| Drag the right edge        | Changes the due date                            |
| Click a task name          | Selects the row and lights up its dependency chain |
| Click the arrow button     | Opens the note the task lives in                |

Dragging snaps to whole days. A bar can never be shorter than one day.

Edits are written straight into your notes: inline tasks get `🛫`/`📅` (or
Dataview `[start:: …]` style if that is what the line already uses), and
note-based tasks get `start` and `due` frontmatter keys.

## Dependencies

Arrows join each blocker to the task it blocks, using the same `⛔` / `🆔`
relationships as the map. Arrows are only drawn between tasks that are both
visible, so filtering hides the arrows to tasks that dropped out.

Clicking a task highlights its whole chain — everything it waits on and
everything waiting on it — and fades the rest. Click it again, or click
another task, to move the highlight. The map does the same thing.

## Toolbar

| Control              | Purpose                                                     |
| -------------------- | ------------------------------------------------------------ |
| Days / Weeks / Months | Zoom level of the timeline                                  |
| Today                | Scrolls the timeline back to today                          |
| Search               | Filters rows by task text or tag                            |
| Hide completed       | Removes done and canceled tasks from the chart              |
| Apply suggested dates | Writes every dashed bar to its note                        |
| Reload               | Re-reads tasks from the vault                               |
| Task column divider  | Drag to widen the column for long task names                |

Task names render `[[wikilinks]]` as real links, so a task whose text is a
link opens that note when clicked.

The red vertical line marks today, and weekends are shaded at the day zoom
level.
