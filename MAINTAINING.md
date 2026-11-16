# Maintaining Project Planner

Notes to myself for running this repository now that other people are in it.
`CONTRIBUTING.md` is what contributors read; this is the other side of it.

## The loop

Twenty minutes, every week or two, in this order:

1. **New issues** — label each one and reply, even if the reply is "I have read
   this, it is a good idea, I am not starting it yet". An unanswered issue is
   the only thing here that actually costs anything: the community plugin
   scorecard scores *Responsiveness* on the share of issues closed, and people
   stop reporting things when nobody answers.
2. **New PRs** — approve the CI run (see below), then read the diff.
3. **Renovate PRs** — minor and patch updates automerge themselves. Majors
   wait for you; they are the ones that break the Obsidian bundle.
4. **Release** — a merge to `main` with a `feat:` or `fix:` title releases
   itself. Nothing to do unless it did not.

## Triaging an issue

Every issue gets a label and a reply on the first pass. The labels that exist
are the GitHub defaults (`bug`, `enhancement`, `question`, `documentation`,
`good first issue`, `help wanted`, `duplicate`, `wontfix`), and four outcomes
cover almost everything:

| Outcome | What it looks like |
| --- | --- |
| **Fix it** | Reproducible bug. Label `bug`, fix, close by merging. |
| **Plan it** | Real need, not this week. Label `enhancement`, say so plainly, leave it open. |
| **Answer it** | It already works, or it is a docs gap. Label `question` or `documentation`, answer, close. A docs gap is a real bug — fix the page before closing. |
| **Decline it** | Needs a database, a second data format, or a dependency you do not want. Label `wontfix`, say why in two sentences, close. |

Declining is not rude; leaving someone guessing for a month is. A feature
request closed with a reason can always be reopened.

## Triaging a pull request

### CI on a fork PR needs your approval first

This is the trap, and it has already cost this repository three CI runs.

GitHub does not run workflows on a pull request from a fork until a maintainer
approves the run. Until you do, the PR shows a **failed** 💎 Qualify and 🚚
Release — and the failure is not the contributor's: the run never started a
single job. After 30 days the approval expires and the run is recorded as a
permanent failure.

To approve: open the PR's **Checks** tab (or the **Actions** tab) and click
**Approve and run**.

If the approval already expired, there is nothing left to approve — the run is
dead. Close the pull request and immediately reopen it; that fires the
`pull_request` workflows again, and this time approve them.

To stop the gate applying to a contributor who has already proved themselves,
Settings → Actions → General → *Fork pull request workflows from outside
collaborators* can be set to require approval only for first-time
contributors.

### Stacked pull requests

A contributor branching each PR off the last one — #5 off #4, #6 off #5 — is
doing you a favour, but only if you merge them in order. Until #4 lands, #5's
diff also contains #4's commits and looks three times its real size.

Review and merge the bottom of the stack first, then ask the contributor to
rebase the rest. Do not try to read all of them at once; you will review the
same code three times and still miss something.

### Reading a diff you did not write

The checks CI runs do not tell you whether code is *right*, only that it is
clean. For a feature PR the questions worth actually answering are:

- **Does it change what the vault holds?** A new frontmatter key or inline
  field is forever — every vault that uses it has to keep parsing it. This is
  the one thing worth being slow about.
- **Does an existing vault behave identically after upgrading?** New settings
  keys must default to the old behaviour.
- **Is the logic in `src/lib/` with tests, or hidden in a component?** The
  second kind cannot be tested and will rot.
- **Are the `nl` and `zh-CN` keys there?** A missing key ships as a raw key on
  screen.
- **Would you be willing to debug this in a year?** You are the one who will.

If the answer to the last one is no, say so. "This is more surface than I can
maintain alone, but I would take the smaller half" is a legitimate review.

## Keeping it up to date

- **Dependencies**: Renovate automerges minors and patches, and opens majors
  for review (`renovate.json`). Two pins are deliberate and documented in that
  file: React stays on 18 because React 19's bundle trips Obsidian's
  obfuscation scanner, and `@dagrejs/dagre` stays on 1.x.
- **Obsidian API**: the scorecard on the community plugin page is the cheapest
  way to hear about a deprecation. Check it when a new Obsidian minor ships.
- **The release itself**: `main` → version bump → tag → GitHub release with
  `main.js`, `manifest.json`, `styles.css`, driven by
  `.github/workflows/release.yaml`. Details in
  `docs/contributing/ci-releases.md`. Never hand-edit a version field.

## The community plugin scorecard

<https://community.obsidian.md/plugins/project-planner#scorecard> grades
Health and Review. Not every finding is yours to fix, and it is worth knowing
which is which before promising anything:

- **Actionable.** A missing contributing guide (this file's neighbour fixes
  it), unanswered issues, missing artifact attestations on release assets,
  `PluginSettingTab` not implementing `getSettingDefinitions()` so the
  settings do not appear in Obsidian's settings search on 1.13+, and
  ReactFlow's deprecated `parentNode` node property.
- **Not yours.** `document.createElement` warnings come from the bundled
  React runtime, not from `src/` — there are zero occurrences in this
  codebase. "Malware scan not available" is the scanner's own state.
- **Informational.** Vault enumeration and clipboard access are disclosures of
  what the plugin legitimately does, not defects.

## Known gaps

Current as of 2026-11-16; delete each line as it is dealt with.

- **The emoji labels `.github/labeler.yaml` writes do not exist in this
  repository.** Labels are not copied when a repository is forked, so the PR
  Labeler job has nothing to apply. Either create the nine labels or simplify
  the config.
- **🚚 Release triggers on `pull_request`.** Its `release` job is correctly
  gated to `push`, so the run does nothing useful on a PR but still shows up
  as a required-looking check that fails behind the approval gate. Worth
  narrowing the trigger.
- **Release assets carry no attestation the scanner can find.** The workflow
  does run `actions/attest`, so this is a question of which predicate and
  which action (`actions/attest-build-provenance`) the scanner looks for.
