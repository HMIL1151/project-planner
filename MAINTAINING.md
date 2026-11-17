# Maintaining Project Planner

Notes to myself for running this repository now that other people are in it.
`CONTRIBUTING.md` is what contributors read; this is the other side of it.

## The loop

Twenty minutes, every week or two, in this order:

1. **New issues** — label each one and reply, even if the reply is "I have read
   this, it is a good idea, I am not starting it yet". An unanswered issue is
   the only thing here that actually costs anything: the community plugin
   scorecard scores _Responsiveness_ on the share of issues closed, and people
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

| Outcome        | What it looks like                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix it**     | Reproducible bug. Label `bug`, fix, close by merging.                                                                                              |
| **Plan it**    | Real need, not this week. Label `enhancement`, say so plainly, leave it open.                                                                      |
| **Answer it**  | It already works, or it is a docs gap. Label `question` or `documentation`, answer, close. A docs gap is a real bug — fix the page before closing. |
| **Decline it** | Needs a database, a second data format, or a dependency you do not want. Label `wontfix`, say why in two sentences, close.                         |

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
Settings → Actions → General → _Fork pull request workflows from outside
collaborators_ can be set to require approval only for first-time
contributors.

### Stacked pull requests

A contributor branching each PR off the last one — #5 off #4, #6 off #5 — is
doing you a favour, but only if you merge them in order. Until #4 lands, #5's
diff also contains #4's commits and looks three times its real size.

Review and merge the bottom of the stack first, then ask the contributor to
rebase the rest. Do not try to read all of them at once; you will review the
same code three times and still miss something.

### Reading a diff you did not write

The checks CI runs do not tell you whether code is _right_, only that it is
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

<https://community.obsidian.md/plugins/project-planner#scorecard> grades Health
and Review. The thing to know before promising anything is that **it grades the
last released build, not `main`** — anything fixed after a release reads as
unfixed until you ship again. That is what the attestation finding turned out
to be.

Not every finding is yours to fix:

- **Actionable, and usually a deprecation.** As of 1.3.0 the list is clear:
  the contributing guide exists, issues get answered, `getSettingDefinitions()`
  is implemented, `parentNode` is `parentId`, and `setWarning` is
  `setDestructive`. Expect new ones as Obsidian moves.
- **Watch the API-vs-`minAppVersion` error.** It is the most severe thing the
  scanner reports and it is easy to cause: use an API newer than
  `manifest.json` declares and you get it. 1.1.0 earned one by implementing
  `getSettingDefinitions()` (1.13) while declaring 1.8.0. Either raise
  `minAppVersion` or do not use the API.
- **Mine, deliberate, and staying.** `activeDocument.createElement` and
  `embed.ownerDocument.createElement` in five places trip
  `prefer-create-el`. They are correct: `activeDocument` follows the focused
  popout window, and the global `createEl` would build the element in the main
  document, which breaks the Gantt PNG export and the handover pack from a
  popped-out view. Say so rather than "that is not my code" — a case-sensitive
  grep for `document.createElement` misses both spellings and makes it look
  like a dependency's problem.
- **Informational.** Vault enumeration and clipboard access are disclosures of
  what the plugin legitimately does. It has to see every file to find your
  tasks, and the Gantt export puts an image on the clipboard.

## Known gaps

Current as of 2026-11-17; delete each line as it is dealt with.

- **The release workflow only works on a commit that came from a pull
  request.** `🚚 Release`'s _Determine version_ job runs `semVersie`, which
  reads the version bump off the **pull request title**, not the commit
  message. Push straight to `main` and it retries four times looking for an
  associated PR, then fails with _Could not find pull request in context_ — no
  release is cut, but `main` carries a red run. So merge through a PR even when
  you are the only reviewer, and put the `feat:`/`fix:`/`docs:` prefix in the
  **PR title**.
- **The invalid-source `Notice` fires once per view per load**, so a typo in
  _Task source_ shows up four times over with every view open.

## Things that bit once and are fixed

Kept because the cause is not obvious and a fork can reintroduce any of them.

- **Fork PR CI needs your approval, and the approval expires.** See above. It
  cost this repository three runs and made a good contributor's work look
  broken for a month.
- **A fork does not inherit repository settings.** Not labels, not GitHub
  Pages, not `CODEOWNERS` ownership. `.github/CODEOWNERS` still read
  `* @NicoKNL` — the upstream author — so every review request went to someone
  with no connection to this repo. Pages was never enabled, so the docs site
  404'd and every link to it from `CONTRIBUTING.md` was dead while the deploy
  job failed on every release. `actions/labeler` does create its own labels,
  but grey and undescribed.
- **Line endings.** `.gitattributes` with `eol=lf` now pins both ends. Before
  it, `core.autocrlf` plus Prettier's `endOfLine: "lf"` meant `npm run format`
  failed locally on files nobody had touched and passed in CI.
- **Merging a fork PR locally still gives the contributor credit**, as long as
  you use a merge commit. A squash creates a new SHA, GitHub cannot match it,
  and their PR shows as _closed_ rather than _merged_ — which looks like
  rejection on their profile.
