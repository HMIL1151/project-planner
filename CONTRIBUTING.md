# Contributing

Cheers for being here. This is a one-maintainer plugin, so the most useful thing
you can do before writing code is tell me what you're about to write.

Full developer docs are on the
[docs site](https://hmil1151.github.io/project-planner/contributing/):
[Development Environment](https://hmil1151.github.io/project-planner/contributing/development/)
for setup,
[CI & Releases](https://hmil1151.github.io/project-planner/contributing/ci-releases/)
for how a merge becomes a release. This file is the short version.

## Reporting a bug

Use the **Bug report** template.

The plugin reads your tasks through Dataview, so a report is only reproducible
if it says which versions you're on and what the task line or note actually
looks like. The template asks for exactly that. A screenshot of a view helps.
The Markdown behind it helps more.

## Asking for a feature

Use the **Feature request** template, and say what you're trying to plan rather
than just which control you want. Some of the best things in here turned up as
"my project looks like this and the chart can't show it", and got built
differently, and better, than the original ask.

## Sending a pull request

Fork, branch off `main`, open the PR against `main`.

Run what CI runs:

```bash
npm run lint && npm run lint:css && npm run format && npm run build && npm test
```

On Windows, `npm run format` will flag every file you've just checked out
because of line endings. `npx prettier --check --end-of-line auto "src/**"` is
the honest check until that's sorted.

A few rules here are load-bearing, and a PR that breaks one will come back:

- **Never edit `main.js` or `styles.css`.** Both are build output. Style changes
  go in `global.css`.
- **No hardcoded user-facing strings.** Use `t()` and add the key to all three
  locale files (`en`, `nl`, `zh-CN`). A missing key ships as a raw key on
  screen.
- **No `any`, no inline `style` props, no runtime `<style>` elements.** ESLint
  errors on all three.
- **New logic goes in `src/lib/` with a matching `test/*.test.ts`.** That
  directory is pure and framework-free. React files stay presentational.
- **Test files are `.test.ts`, never `.test.tsx`.** Jest's `testMatch` would
  silently never run a `.tsx` test.
- **Don't hand-edit version fields** in `package.json`, `manifest.json` or
  `versions.json`. The release workflow owns them.

`AGENTS.md` in the repo root has the detailed style guide: imports, naming,
React patterns, error handling. Worth a read before you write code.

If you're stacking PRs (branching each off the last), say so in the description
and tell me the order. It makes a big change reviewable, but only if I merge
them bottom up.

### Scope, and what I'm likely to merge

<!--
TODO(human): write this section — it is the one rule only you can set.

Every open PR, and every PR after them, gets handled by whatever this
paragraph says, so it decides how much unsolicited code you end up owning.
Three or four sentences, in your own voice. Things to pin down:

  - Does a feature need an agreed issue BEFORE the PR, or are you happy to
    receive a finished feature cold?
  - Is there a size past which you would rather discuss first? (The three PRs
    open right now are 800-2200 lines each.)
  - What do you NOT want? (New dependencies? New top-level views? Changes to
    the Markdown formats the plugin reads and writes?)
  - What does a contributor get from you, and when — a first reply within a
    week, a review when you have a free evening, no promises?

Be honest rather than generous. A rule you will actually follow is kinder to
contributors than a promise you will not.
-->

## Code of conduct

Be decent to each other. I'll close threads that aren't.
