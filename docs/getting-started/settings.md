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
