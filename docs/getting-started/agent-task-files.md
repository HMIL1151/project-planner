# Generating a task file with an agent

A project rarely starts as tasks. It starts as a brief, a contract, a proposal
scope, a budget and a programme. Getting that into a plan means reading the lot
and typing out a few dozen task lines by hand.

An AI agent can do that first pass. Give it the project material and the spec
on this page, and it writes one markdown file of tasks with IDs, dependencies,
dates, hours and costs already on them. Drop the file anywhere in your vault
and the map, Gantt and board populate from it, along with the finance view once
your rates note is set up.

It gets you a draft, not a finished plan. Check the sequence and the numbers
before you trust the critical path.

## How to use it

1. Point the agent at this page, or copy everything from
   [the spec](#what-you-are-producing) down.
2. Attach the project material: brief, contract, scope, budget, programme.
3. Ask for the task file.
4. Save the output in your vault and open the map.

Everything from the next heading on is written at the agent, in the second
person, so it can be handed over as it stands.

## Expect open questions

A brief never has everything in it. The spec tells the agent to write an
`[oq:: ...]` line wherever it would otherwise have to guess, rather than
inventing a start date or a day rate. Those show up in the **Open questions**
view, so the gaps in the material come out as a list you can work through. A
real brief usually produces five to fifteen.

---

## What you are producing

You have been given project material: a brief, a contract, a proposal scope, a
budget, a programme, or some mix of those. Turn it into **one markdown file**
that the Project Planner plugin for Obsidian can load as a graph, a Gantt
chart, a kanban board and a finance dashboard.

Everything below is the complete syntax. Follow it exactly. Every field listed
is one the plugin actually parses; anything not listed is ignored.

The file contains:

- One `- [ ]` line per task.
- Markdown headings grouping tasks into phases or workstreams. Headings are for
  the human reading the file, the plugin ignores them.
- Prose where it helps. Also ignored by the plugin, so use it freely.

Output the file and nothing else. No commentary around it, no summary of what
you did, no second file unless this page says so.

## The rule that breaks everything if you get it wrong

**By default, every checkbox line anywhere in the vault becomes a task node.**
Out of the box the plugin collects every task on every page, with no folder
scope and no tag filter.

Two settings can narrow that, and you will not know whether they are set:

- **Task source** is a Dataview source picking which *notes* are read. Empty by
  default, meaning the whole vault.
- **Required task tags** pick which *lines* in those notes count. Empty by
  default, meaning every `- [ ]` line counts. When set, a line needs at least
  one of the tags, not all of them. Matching ignores case, and a nested tag
  satisfies its parent, so `#project/alpha` meets a requirement of `project`.

Write the file so it is correct either way:

- Never use a checkbox for anything that is not a task. No `- [ ]` acceptance
  criteria, no `- [ ]` assumptions list, no `- [ ]` "things to confirm". With
  the gate off, every one of those becomes a node.
- Use `-` bullets without brackets for lists that are not tasks.
- Put questions in an `[oq:: ...]` field, covered under
  [Open questions](#open-questions-use-these), not a checkbox.
- **Give every task the same project tag**, as the worked example does with
  `#northgate`. It costs nothing with the gate off, it is what makes the file
  work with the gate on, and it is what the user filters the views by.

If the brief names the tag the vault requires, use that one. If it does not,
use a project tag of your own and raise an `[oq:: ...]` asking whether the
vault has required task tags set.

If the brief contains a list of deliverables that are not units of work, write
them as plain bullets under the task they belong to.

## Anatomy of a task line

```text
- [ ] Description of the work #tag [id:: abc123] [dependsOn:: xyz789] [owner:: Alice Smith] [hours:: 12] [people:: Alice Smith 100%] [costs:: Steel 310] 🛫 2027-01-12 📅 2027-01-16
```

Order on the line does not matter to the parser. Keep this order anyway, so the
files are readable and diff cleanly:

1. Checkbox and description
2. Tags
3. `[id:: ...]`
4. `[dependsOn:: ...]`
5. `[parent:: ...]`
6. `[owner:: ...]`
7. `[hours:: ...]` or `[hoursPerDay:: ...]`
8. `[people:: ...]`
9. `[costs:: ...]`
10. `[progress:: ...]`
11. Dates, start before due
12. Priority or star emoji, last

The description is everything left after the plugin strips the fields out. Keep
it short, specific and in the language of the brief. It is what shows on the
node and the Gantt row.

## Field reference

Each field has several accepted spellings, but the plugin only ever writes one
back. **Use the canonical spelling in the table and nothing else**, otherwise
the file stops matching itself the first time someone edits a task in the app.

| Field | Canonical form | Value |
| --- | --- | --- |
| ID | `[id:: ng-survey]` | `a-z A-Z 0-9 _ -` only. Required on every task. |
| Dependencies | `[dependsOn:: ng-kick, ng-survey]` | Comma-separated IDs this task waits for. |
| Parent | `[parent:: ng-design]` | One ID. Written on the **child**. |
| Owner | `[owner:: Alice Smith]` | One person. Wiki-links allowed: `[[Alice Smith]]`. |
| Total hours | `[hours:: 12]` | Number. Effort, not duration. |
| Hours per day | `[hoursPerDay:: 6]` | Number. Overrides the global default of 8. |
| People | `[people:: Alice Smith 60%, Bob Jones 40%]` | Names and shares of the hours. |
| Costs | `[costs:: Camera 2,400; Steel 310]` | Materials and expenses, label then amount. |
| Progress | `[progress:: 40]` | Plain number, optional `%`. Nothing else parses. |
| Start date | `🛫 2027-01-12` | `YYYY-MM-DD`. |
| Due date | `📅 2027-01-16` | `YYYY-MM-DD`. |
| Scheduled | `⏳ 2027-01-12` | `YYYY-MM-DD`. |
| Done date | `✅ 2027-01-16` | `YYYY-MM-DD`. |
| Tag | `#northgate` | Preceded by a space. Drives colour and filtering, and may be what makes the line count as a task at all. |
| Priority | `🔺 ⏫ 🔼 🔽 ⏬` | Highest to lowest. One per task, or none. |
| Star | `⭐` | Flags a task as notable. Use sparingly. |
| Open question | `[oq:: Is the date fixed?]` | On its own line, never on a task line. |

Dates use the emoji form because that is what the plugin writes back. Every
other field uses the single-bracket Dataview form, for the same reason.

## IDs are mandatory

A task with no ID gets a random one generated fresh on every render. Nothing
can depend on it, and a manual ordering will not stick to it.

The same happens if the ID contains a character outside `a-z A-Z 0-9 _ -`. The
field does not partially match. It fails completely and the task falls back to
a random, unstable ID. There is no error, and the file looks fine.

Give every single task an ID. Make them short, readable and derived from the
work:

```text
[id:: ng-survey]        good
[id:: ng-design-pack]   good
[id:: ng_survey_01]     good
[id:: t1]               works, tells the reader nothing
[id:: ng.survey]        silently ignored, random unstable ID instead
[id:: ng survey]        silently ignored, random unstable ID instead
[id:: ng/survey]        silently ignored, random unstable ID instead
```

Prefix them with a short project code so two projects in one vault cannot
collide.

## Dependencies

`dependsOn` lists the tasks that must **finish before** this one starts.

```text
- [ ] Site survey [id:: ng-survey] [dependsOn:: ng-kick]
- [ ] Design pack [id:: ng-design] [dependsOn:: ng-survey]
- [ ] Install [id:: ng-install] [dependsOn:: ng-build, ng-access]
```

The dependency is written on the task that is blocked, never on the blocker.
Multiple IDs are comma-separated, and spaces after the commas are fine.

This is what builds the graph, drives the critical path and lets the Gantt
infer dates. It is the highest-value thing you can extract from a brief, so
work the sequence out properly:

- A task that cannot start until something is delivered, approved, ordered or
  signed depends on it.
- Payment milestones depend on the work they are paid against.
- Do not chain tasks that could genuinely run in parallel. A long single chain
  is almost always wrong and makes the critical path meaningless.
- Do not create a loop. The plugin survives one, but the plan is then nonsense.

There is an older emoji form, `⛔ id1,id2`. Do not use it: it breaks on a space
after the comma. The app may rewrite your `dependsOn` fields into it depending
on the user's settings, which is fine and harmless.

## Dates

Format is strictly `YYYY-MM-DD`. No `12/01/2027`, no `Jan 2027`, no `week 4`.

A Gantt bar runs from `🛫` start to `📅` due. Supply both when the brief
supports it.

Tasks with no dates still get a bar. The plugin infers one from the dependency
graph, starting the day after the last blocker finishes and lasting one day.
Inferred bars are drawn as proposals until the user accepts them.

So:

- Dates in the brief, write them.
- No dates but a known sequence, write the dependencies and leave the dates
  off. The inferred programme will be roughly right.
- Durations but no calendar dates, derive dates from the project start date if
  the brief gives one. If it does not, leave dates off, put the effort in
  `[hours:: ...]`, and raise an `[oq:: ...]` asking for the start date.

Never invent a date that is not derivable from the material. An invented date
looks exactly like a real one once it is in the chart.

## Hierarchy

A child names its parent:

```text
- [ ] Design pack [id:: ng-design] [dependsOn:: ng-survey] 🛫 2027-01-12 📅 2027-02-06
- [ ] Bracket set [id:: ng-design-brackets] [parent:: ng-design] [hours:: 16]
- [ ] Guarding [id:: ng-design-guard] [parent:: ng-design] [hours:: 24]
```

A parent's Gantt bar is rolled up to span its children, so you can leave the
parent's own dates off and let the children define it.

Use hierarchy for a deliverable broken into parts, and headings for phases. Do
not use hierarchy to mirror the brief's numbering for its own sake. Two levels
is usually plenty, three is the practical limit before the chart gets hard to
read.

## Effort, people and costs

This is time and materials. A task consumes hours, named people work those
hours in some proportion, and materials sit on top.

### Hours

```text
[hours:: 12]        12 hours of effort on this task
[hoursPerDay:: 6]   6 hours a day for as long as the bar runs
```

`hours` wins when both are present. Prefer `hours` whenever the brief gives an
effort figure, because it is independent of the dates and survives the
programme moving. Use `hoursPerDay` when the brief gives a duration and a
staffing level instead, as in "two weeks, one engineer at 60%".

### People

```text
[people:: Alice Smith 60%, Bob Jones 40%]
[people:: Cara Diaz 50%; Bob Jones 50%]
[people:: Alice Smith]
```

- Shares are fractions of the task's hours. `60%`, `60` and `0.6` all mean the
  same thing.
- A name with no number means 100%.
- Shares that do not total 100% are reported as a problem in the finance view
  rather than silently corrected. Make them add up unless the brief really does
  describe a part-loaded task.
- **Names must match the rates note exactly** or the task costs nothing and
  shows under Problems. Use the names the brief uses. If the brief only gives
  roles, such as "a senior engineer and two fitters", use the role as the name
  and raise an `[oq:: ...]` asking who is actually on it.

### Costs

```text
[costs:: Camera and lens 2,400; Mounting steel 310, Travel 85]
```

Label first, amount last. Entries separate on `;` or on a comma, **but not a
comma inside a number**, so `2,400` stays one figure. A label that needs a
comma of its own must use `;` as its separator. An entry with no amount is
dropped entirely, so never write a cost you do not have a number for. Put it in
an `[oq:: ...]` instead.

Negative amounts are kept and read as credits.

### What to do with a budget

A contract value or a proposal total is not a task field. Break it down:

- Labour, into `hours` plus `people` on the tasks that do the work.
- Materials, equipment, travel and subcontract, into `costs` on the task that
  incurs them.
- Anything you cannot attribute to a task, such as contingency, fee or
  overhead, goes in prose at the top of the file and not into a task. Say so
  plainly, so the finance total is not mistaken for the contract value.

## Status, priority and progress

The checkbox carries the status:

| Line | Status |
| --- | --- |
| `- [ ]` | To do |
| `- [/]` | In progress |
| `- [x]` | Done |
| `- [-]` | Cancelled |

Lowercase `x` only. `- [X]` is not recognised.

A plan built from a brief is almost all `- [ ]`. Only mark something done or in
progress if the material says it already is.

`[progress:: 40]` adds a percentage to an in-progress task. The value must be a
bare number. `[progress:: nearly done]` parses as nothing.

Priority emoji go at the end of the line: `🔺` highest, `⏫` high, `🔼` medium,
`🔽` low, `⏬` lowest. Only use them where the brief actually signals priority.
Marking everything high is the same as marking nothing.

## Open questions, use these

A brief never contains everything. Where you would otherwise guess, write an
open question instead. The plugin gathers them into a panel.

```text
[oq:: Contract gives a 14 week programme but no start date, when does week 1 begin?]
[oq:: "Commissioning support" is in scope but not quantified. How many days?]
```

Rules:

- On a line of its own. On a task line it is ignored.
- Not a checkbox.
- One question per line.
- Put it directly under the task or heading it relates to, so the context
  travels with it.

An answer can be written on the very next line as a callout, which the user may
do later:

```text
[oq:: When does week 1 begin?]
> [!answer] 5 January 2027, confirmed by email 12 Dec.
```

Raising a question is always better than inventing a figure. Aim for every
genuine gap in the brief to appear as an `[oq:: ...]`, and expect a real brief
to produce five to fifteen of them.

## Rates, only if the brief gives them

Costs need hourly rates, which live in a separate note the user points the
plugin at. The default is `Finance/People and rates.md`. Two tables, found by
their column headers:

```markdown
# Rates

| Grade      | Rate |
| ---------- | ---- |
| Principal  | 145  |
| Senior     | 110  |
| Engineer   | 85   |

# People

| Person      | Grade     | Rate |
| ----------- | --------- | ---- |
| Alice Smith | Principal |      |
| Bob Jones   | Engineer  |      |
| Cara Diaz   | Senior    | 130  |
```

The `Rate` column on a person overrides their grade's rate. Leave it empty
otherwise.

If the brief contains rates, append these two tables at the **end of your task
file** under a `# Rates` and `# People` heading pair, and add one line of prose
saying they need either copying into the rates note or the rate-note setting
pointing at this file. Do not output a second file.

If the brief contains no rates, leave this out entirely.

## What you cannot express

Do not try to encode these. There is no syntax for them, and inventing one
produces fields that are silently ignored.

- **Milestones.** They live in the plugin's settings, not the vault. If the
  brief has milestones, write them as prose at the top of the file so the user
  can add them, or as a zero-duration task if something genuinely depends on
  them.
- **Dependency types.** Everything is finish-to-start. No lags, no leads, no
  start-to-start.
- **Calendars and working patterns.** Weekend handling is a global setting.
- **Custom fields.** `[risk:: high]` and `[wbs:: 1.2.4]` parse as nothing and
  clutter the node. Put that information in the description, a tag, or prose.
- **Currency.** A global setting. Write bare numbers in `costs`, never `£2,400`
  or `$2400`.

## Traps

**Emoji in a description eat the following word.** The plugin strips unknown
emoji along with the word after them, so `- [ ] Review 🎯 targets` displays as
"Review". Use no emoji in descriptions beyond the dates, priority and star
listed above.

**Dates are strictly `YYYY-MM-DD`.** Anything else is not read as a date at
all, and the task quietly gets an inferred bar instead.

**Commas in cost labels split the entry.** Use `;` between entries whenever a
label contains a comma.

**`[progress:: ...]` must be a bare number.**

**Lowercase `x` in a done checkbox.**

**One owner per task.** `[owner:: ...]` is the single person answerable. The
people sharing out the hours go in `[people:: ...]`. They are different fields,
and a task can sensibly have both.

**Do not wrap task lines.** One task, one line, however long it gets. A wrapped
line becomes two broken tasks.

**Do not use a checkbox for anything that is not a task.** Worth repeating.

## Worked example

Input: a proposal for a vision-system retrofit. 14 week programme from
5 January 2027, 48,000 contract value, scope covering survey, design,
procurement, build, install and FAT.

Output:

```markdown
# Northgate line 3 vision retrofit, task plan

From Northgate retrofit proposal rev C, 14 October 2026. Contract value 48,000,
of which 4,000 is contingency and 6,200 is fee. Neither is in the tasks below,
so the finance total will read lower than the contract value.

Programme is 14 weeks from 5 January 2027.

Milestones to add in settings: design freeze 2027-02-06, equipment on site
2027-03-12, handover 2027-04-09.

## Mobilisation

- [ ] Sign the order and confirm the programme #northgate [id:: ng-kick] [owner:: Alice Smith] [hours:: 4] [people:: Alice Smith 100%] 🛫 2027-01-05 📅 2027-01-06
- [ ] Site survey and as-built check #northgate [id:: ng-survey] [dependsOn:: ng-kick] [owner:: Bob Jones] [hours:: 16] [people:: Bob Jones 100%] [costs:: Travel 85] 🛫 2027-01-07 📅 2027-01-09

[oq:: Proposal assumes line 3 is available for a full day's survey. Is a shutdown already booked?]

## Design

- [ ] Design pack #northgate [id:: ng-design] [dependsOn:: ng-survey] [owner:: Alice Smith] 🛫 2027-01-12 📅 2027-02-06
- [ ] Camera mounting brackets #northgate [id:: ng-brackets] [parent:: ng-design] [hours:: 24] [people:: Bob Jones 100%]
- [ ] Guarding and access #northgate [id:: ng-guard] [parent:: ng-design] [hours:: 16] [people:: Bob Jones 100%]
- [ ] Control integration drawings #northgate [id:: ng-controls] [parent:: ng-design] [hours:: 32] [people:: Alice Smith 40%, Cara Diaz 60%]
- [ ] Design freeze review #northgate [id:: ng-freeze] [dependsOn:: ng-brackets, ng-guard, ng-controls] [owner:: Alice Smith] [hours:: 6] [people:: Alice Smith 50%, Cara Diaz 50%] 📅 2027-02-06 ⏫

## Procurement

- [ ] Order cameras and lenses #northgate [id:: ng-order-vision] [dependsOn:: ng-freeze] [owner:: Alice Smith] [hours:: 4] [people:: Alice Smith 100%] [costs:: Cameras and lenses 9,600; Lighting 1,450] 🛫 2027-02-08 📅 2027-02-10
- [ ] Order steelwork and guarding #northgate [id:: ng-order-steel] [dependsOn:: ng-freeze] [hours:: 3] [people:: Bob Jones 100%] [costs:: Mounting steel 2,310; Guarding panels 1,180] 🛫 2027-02-08 📅 2027-02-10

[oq:: Proposal quotes a 6 week lead time on cameras. Is that confirmed with the supplier, or an estimate?]

## Build and test

- [ ] Build and bench test the vision cell #northgate [id:: ng-build] [dependsOn:: ng-order-vision] [owner:: Cara Diaz] [hours:: 60] [people:: Cara Diaz 70%, Bob Jones 30%] 🛫 2027-03-15 📅 2027-03-26
- [ ] Install on line 3 #northgate [id:: ng-install] [dependsOn:: ng-build, ng-order-steel] [owner:: Bob Jones] [hours:: 72] [people:: Bob Jones 50%, Cara Diaz 50%] [costs:: Access platform hire 640, Travel 420] 🛫 2027-03-29 📅 2027-04-02 🔺
- [ ] FAT and handover pack #northgate [id:: ng-fat] [dependsOn:: ng-install] [owner:: Alice Smith] [hours:: 20] [people:: Alice Smith 100%] 🛫 2027-04-05 📅 2027-04-09

[oq:: Scope says "commissioning support as required" with no figure. How many days should we plan and price?]

# Rates

| Grade     | Rate |
| --------- | ---- |
| Principal | 145  |
| Senior    | 110  |
| Engineer  | 85   |

# People

| Person      | Grade     | Rate |
| ----------- | --------- | ---- |
| Alice Smith | Principal |      |
| Bob Jones   | Engineer   |      |
| Cara Diaz   | Senior     |      |

Copy these two tables into your rates note, or point the finance rate-note
setting at this file.
```

## Checklist before you output

- Every task has a unique `[id:: ...]` using only `a-z A-Z 0-9 _ -`.
- Every `dependsOn` points at an ID that exists in the file.
- Dependencies are on the blocked task, not the blocker.
- No dependency loops, and no single chain where work could run in parallel.
- Every date is `YYYY-MM-DD` and derivable from the material.
- No invented dates, hours, rates or costs.
- `people` shares total 100% per task, or the exception is deliberate.
- `costs` entries all have a number, and labels with commas use `;`.
- Person names are consistent across every task and match the rates tables.
- No emoji in descriptions beyond dates, priority and star.
- No checkbox used for anything that is not a task.
- Every task carries the project tag, so the file still works if the vault has
  required task tags set.
- Every real gap in the brief is an `[oq:: ...]` on its own line.
- Contingency, fee and overhead called out in prose, not hidden in tasks.
- One file, no commentary around it.
