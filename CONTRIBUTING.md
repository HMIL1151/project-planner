# Contributing

Thanks for being here. Project Planner has one maintainer, so the most useful
thing you can do before writing code is say what you are about to write.

The full developer documentation lives on the docs site under
[Contributing](https://hmil1151.github.io/project-planner/contributing/) —
[Development Environment](https://hmil1151.github.io/project-planner/contributing/development/)
for setup, and
[CI & Releases](https://hmil1151.github.io/project-planner/contributing/ci-releases/)
for how a merge becomes a release. This file is the short version: the ground
rules, and what to expect from me.

## Reporting a bug

Open an issue with the **Bug report** template.

Project Planner reads your tasks through Dataview, so a report is only
reproducible if it says which versions you are on and what the task line or
note actually looks like. The template asks for exactly that. A screenshot of
a view is useful; the Markdown behind it is more useful.

## Asking for a feature

Open an issue with the **Feature request** template and say what you are
trying to plan, not only which control you want. Several of the best ideas in
this plugin arrived as a description of a real project that the views could
not show, and were built differently — and better — than the original ask.

## Sending a pull request

Fork, branch from `main`, and open the PR against `main`.

A PR needs to pass the same checks CI runs, which you can run yourself:

```bash
npm run lint && npm run lint:css && npm run format && npm run build && npm test
```

Beyond that, a few rules are load-bearing in this repo and a PR that breaks
one will be sent back:

- **Never edit `main.js` or `styles.css`.** Both are build output. Style
  changes go in `global.css`.
- **No user-facing string is hardcoded.** Use `t()` and add the key to all
  three locale files (`en`, `nl`, `zh-CN`); a missing key ships as a raw key.
- **No `any`, no inline `style` props, no runtime `<style>` elements.** ESLint
  enforces all three.
- **New logic goes in `src/lib/` with a matching `test/*.test.ts`.** That
  directory is pure and framework-free, and it is where the test suite lives.
  React files stay presentational.
- **Test files are named `.test.ts`, never `.test.tsx`.** Jest's `testMatch`
  would silently never run a `.tsx` test.
- **Never hand-edit the version fields** in `package.json`, `manifest.json` or
  `versions.json`. The release workflow owns them.

`AGENTS.md` in the repository root holds the detailed style guide — imports,
naming, React patterns, error handling. Read it before writing code.

### Scope, and what I am likely to merge

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

Be decent to each other. I will close threads that are not.
