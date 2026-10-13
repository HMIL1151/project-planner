# Embedding a Project Planner

You can embed a fully interactive Project Planner graph directly inside any note using a fenced code block. The embedded graph supports panning, zooming, and filtering — the same as the main view. A second block, [`project-planner-gantt`](#a-gantt-chart-in-a-note), draws a Gantt chart the same way.

!!! note
    Blocks tagged `tasks-map` — the name this plugin used before it was renamed — are still rendered, so notes written against the older plugin keep working. New blocks should use `project-planner`.

!!! tip
    The safest way to write an embed is to use the [insert commands](#inserting-an-embed-block) rather than writing the JSON by hand.

## Inserting an embed block

There are two ways to insert an embed block into a note.

### From the command palette

Run **Project Planner: Insert current filter as embedded Project Planner** from the command palette (`Ctrl+P` / `Cmd+P`). This captures the active filter state from an open Project Planner view and inserts it as an embed block into the currently active note. If no note is active, you are prompted to pick one.

### From a saved filter preset

In the Project Planner view, open the **Saved Filters** panel. Select a preset, then click the **Insert into note** button (download icon). You are prompted to pick a note, and the embed block is appended to it using that preset's filter.

!!! tip
    Using one of these two methods is the recommended way to create embed blocks — they produce correctly formatted JSON and avoid manual errors.

## The embed format

An embed block is a fenced code block with the language tag `project-planner`. The body is a JSON object with two optional top-level keys: `filter` and `config`.

```project-planner title="Minimal embed"
{}
```

When the body is empty or `{}`, all defaults are used and the full graph is shown.

A more complete example — a compact view showing only starred tasks that are active:

````markdown title="Example embed"
```project-planner
{
  "filter": {
    "onlyStarred": true,
    "selectedStatuses": ["todo", "in_progress"]
  },
  "config": {
    "height": 300,
    "showMinimap": false,
    "showFilterPanel": false,
    "showPresetsPanel": false,
    "showUnlinkedPanel": false
  }
}
```
````

## Filter options

All fields under `filter` are optional. Omitted fields use their defaults.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `selectedTags` | `string[]` | `[]` | Show only tasks with at least one of these tags |
| `excludedTags` | `string[]` | `[]` | Hide tasks that have any of these tags |
| `selectedStatuses` | `string[]` | all statuses | Show only tasks with these statuses (`"todo"`, `"in_progress"`, `"done"`, `"canceled"`) |
| `selectedFiles` | `string[]` | `[]` | Show only tasks from these files or folders |
| `searchQuery` | `string` | `""` | Pre-filled search query |
| `traversalMode` | `string` | `"match"` | Dependency traversal for search results: `"match"`, `"upstream"`, `"downstream"`, or `"both"` |
| `onlyStarred` | `boolean` | `false` | Show only starred tasks |

## Config options

All fields under `config` are optional. Omitted fields use their defaults.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `height` | `number` | `400` | Height of the embed in pixels |
| `showMinimap` | `boolean` | `true` | Show the minimap |
| `showFilterPanel` | `boolean` | `true` | Show the filter panel |
| `showPresetsPanel` | `boolean` | `true` | Show the saved filters panel |
| `showUnlinkedPanel` | `boolean` | `true` | Show the unlinked tasks panel |
| `showStatusCounts` | `boolean` | `true` | Show the status counts overlay |

## Choosing which tasks a block shows

Both blocks take an optional top-level `source` key that decides which tasks the block reads at all. It is what lets one vault hold a separate plan per project: put a block in each project's note and point it at that project's tasks.

````markdown title="Only the Alpha project"
```project-planner
{
  "source": { "folders": ["Projects/Alpha"] }
}
```
````

| Field     | Type       | Description                                                                 |
| --------- | ---------- | --------------------------------------------------------------------------- |
| `folders` | `string[]` | Tasks in these folders, subfolders included                                 |
| `files`   | `string[]` | Tasks in these notes, as paths from the vault root (`"Work/plan.md"`)       |
| `tags`    | `string[]` | Tasks in notes carrying one of these tags, with or without the `#`          |
| `query`   | `string`   | Any other [Dataview source](https://blacksmithgu.github.io/obsidian-dataview/reference/sources/), for what the lists cannot say |

A task is in when it matches any of them. For an exclusion, write it in `query`, for example `"query": "\"Projects\" and -\"Projects/Old\""`. Without `source`, a block reads every task, subject to the vault-wide [task source](settings.md#task-source) setting. When both are set, a task has to match both.

`source` decides what is loaded. `filter.selectedFiles` only hides tasks that were already loaded, so in a large vault `source` is the one to use.

## A Gantt chart in a note

A block tagged `project-planner-gantt` draws the [Gantt chart](gantt.md) inside the note. Its body is JSON with two optional keys, `source` (described [above](#choosing-which-tasks-a-block-shows)) and `config`.

````markdown title="Alpha project plan"
```project-planner-gantt
{
  "source": {
    "folders": ["Projects/Alpha"],
    "files": ["Meetings/alpha-kickoff.md"]
  },
  "config": { "height": 600 }
}
```
````

| Config field | Type     | Default | Description                     |
| ------------ | -------- | ------- | ------------------------------- |
| `height`     | `number` | `500`   | Height of the chart in pixels   |

The chart works the same as the Gantt tab: bars can be dragged, tasks added and linked. The **Open in a tab** button beside it opens the chart in a full tab with the same tasks, named after the note. The tab keeps its project when Obsidian restarts.

Row order, folded rows and milestones are still shared by every chart. Rows are ordered by task, so projects do not disturb each other's order, but a milestone shows on every chart.

## Error states

If something prevents the embed from rendering, a message is shown in place of the graph:

- **Dataview not available** — the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin is not installed or not enabled. Enable it and reload.
- **Invalid JSON** — the code block body could not be parsed. Re-insert the embed using the command palette or the saved filters panel to generate a valid block.
- **Outdated format** — the block uses a legacy flat format from an earlier version. Re-insert the embed to migrate it to the current format.
