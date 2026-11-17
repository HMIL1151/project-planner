# Settings

Access the settings through **Obsidian Settings → Community plugins → Project Planner**.

## Language

Choose the display language for the plugin interface.

| Option                        | Description                    |
| ----------------------------- | ------------------------------ |
| English                       | Default language               |
| Nederlands (Dutch)            | Dutch translation              |
| 简体中文 (Simplified Chinese) | Simplified Chinese translation |

## Task Source

Which part of the vault every view reads its tasks from. Leave it empty to read the whole vault.

The value is a [Dataview source](https://blacksmithgu.github.io/obsidian-dataview/reference/sources/), the part of a query that follows `FROM`:

| Example                         | Reads tasks from                         |
| ------------------------------- | ---------------------------------------- |
| `"Projects"`                    | The `Projects` folder                    |
| `-"Archive"`                    | Everywhere except the `Archive` folder   |
| `#work`                         | Notes tagged `#work`                     |
| `"Projects" and -"Projects/Old"` | `Projects`, leaving out `Projects/Old` |

A [Gantt or graph block](embedding.md#choosing-which-tasks-a-block-shows) in a note narrows this further to one project. If Dataview cannot read the source, the views show no tasks and a notice says why.

## Required Task Tags

Which checkbox lines count as tasks. Leave it empty — the default — and every
`- [ ]` line in the notes being read counts, which is how the plugin has always
behaved.

Set it, and a line only counts if it carries one of the tags you list:

```markdown
- [ ] Draft the handover pack #task     <!-- counted -->
- [ ] Milk, bread, coffee               <!-- ignored -->
```

Separate several tags with commas or spaces, and the leading `#` is optional —
`#task, #project` and `task project` both work. A line matching **any** one of
them counts.

A parent tag matches its children, so `project` also matches `#project/alpha`
and `#project/beta`. You do not have to list every branch.

### How this differs from Task Source

The two stack, and they answer different questions:

| Setting               | Narrows                | Granularity |
| --------------------- | ---------------------- | ----------- |
| **Task source**       | Which notes are read   | Per note    |
| **Required task tags** | Which lines count      | Per line    |

A Dataview source is page-level, so it cannot help when real tasks and stray
checkboxes live in the *same* note — a daily note holding both a project task
and a shopping list, for example. That is what this setting is for.

Because the gate runs before anything is parsed, the lines it excludes cost
nothing: on a vault with thousands of unrelated checkboxes, this is faster than
reading them all and hiding them afterwards.

!!! note "Note-based tasks are unaffected"

    A note tagged `task` in its frontmatter is already opted in by that tag, so
    this setting does not apply to it. Only inline checkbox lines are gated.

## Display Options

Toggle what information is shown on task nodes in the graph.

| Setting              | Default | Description                                     |
| -------------------- | ------- | ----------------------------------------------- |
| Show task priorities | On      | Display priority emoji indicators on task nodes |
| Show task tags       | On      | Display tags on task nodes                      |
| Show status counts   | On      | Display task completion status counts           |

## Layout

Control the visual arrangement of the graph.

| Setting           | Default    | Options                      | Description                                                                     |
| ----------------- | ---------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Layout direction  | Horizontal | Horizontal, Vertical         | The direction of the graph layout                                               |
| Edge style        | Bezier     | Bezier, Straight, SmoothStep | The style of connections between task nodes                                     |
| SmoothStep radius | 10         | 0–100                        | Corner radius for SmoothStep edges (only visible when edge style is SmoothStep) |

## Tag Appearance

Customize how tags are colored in the graph.

### Tag color palette

Every tag is assigned a color from the selected palette, derived from the tag
name, so the same tag always gets the same color.

| Setting           | Default | Options                                  | Description                       |
| ----------------- | ------- | ---------------------------------------- | --------------------------------- |
| Tag color palette | Rainbow | Rainbow, Ocean, Forest, Sunset, Mono     | The color theme applied to tags   |

A preview below the dropdown shows sample tags in the selected palette.

### Individual tag colors

Any tag can be pinned to a specific color instead of following the palette.
The list shows every tag used by your tasks; use the search box to narrow it
down, then pick a color from the dropdown next to a tag.

| Setting    | Default     | Options                                                                          | Description                          |
| ---------- | ----------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| Tag color  | Theme color | Theme color, Red, Orange, Yellow, Green, Teal, Blue, Indigo, Purple, Pink, Gray  | The color applied to that single tag |

Tags left on **Theme color** keep following the palette, so changing the
palette only recolors the tags you have not pinned. **Reset all** clears every
manual assignment at once.

## Simple Task Relations

Choose how task dependencies are written in your notes.

| Style      | Description                        | Example                           |
| ---------- | ---------------------------------- | --------------------------------- |
| CSV        | Comma-separated list of task links | `🔗 task1, task2, task3`          |
| Individual | One link per line                  | `🔗 task1`<br>`🔗 task2`          |
| Dataview   | Dataview inline field              | `relation:: [[task1]], [[task2]]` |

## Advanced

| Setting             | Default | Description                                          |
| ------------------- | ------- | ---------------------------------------------------- |
| Debug visualization | Off     | Show debug overlays on the graph for troubleshooting |
