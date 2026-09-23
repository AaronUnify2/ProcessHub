# Process Hub

Process maps, knowledge base articles and public FAQ content in one editor.

See [`../ProcessHub-SPEC.md`](../ProcessHub-SPEC.md) for the data model and
[`../TERMINOLOGY-AUDIT.md`](../TERMINOLOGY-AUDIT.md) for the terminology
checklist.

> **This folder is self-contained** so it can be lifted into its own repository
> without changes. It deliberately breaks the one-file-per-project rule in the
> root `CLAUDE.md`, because this is a multi-file app with its own content files
> rather than a standalone page.

## Layout

```
processhub/
  index.html         the app
  live.html          the live call view
  css/app.css · css/live.css
  js/                storage.js · data.js · merge.js · edit.js · rules.js · export.js
                     richtext.js · canvas.js · ui-sidebar.js · ui-detail.js · app.js
                     live.js
  data/              source content, fetched by the app at load
    processes.json     taxonomy + process maps
    library.json       KB articles + FAQ questions + publish tabs
    variables.json     variables + owners
  exports/           generated, never hand-edited
    FAQ.json           the live published FAQ content — FAQ.html reads this
  tools/             one-off migration scripts
    import-faq.py
    import-flowcharts.py
    export-faq.py
```

## Running the app

It reads its three JSON files over http, so it cannot be opened straight from
disk — use the published address.

Keyboard: <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> jumps to search,
<kbd>Esc</kbd> clears it. The tree is the default view; search filters across
processes, articles, FAQ questions and variables at once.

Every view has its own address — `#/process/<id>`, `#/article/<id>`,
`#/faq/<id>`, `#/variable/<id>`, plus `#/articles`, `#/faqs`, `#/variables`,
`#/issues`, `#/rules`, `#/coverage` and `#/departments` — so back, forward and
copied links all work.

**Editing.** Click any field to change it. Enter saves a single-line field,
Ctrl+Enter a multi-line one, Esc cancels. The `+ Variable` button on the edit
toolbar inserts a reference that stays in step with the variable. Steps can be
added, reordered and deleted; checks and issues likewise.

Changes go to a draft in IndexedDB about half a second after you stop typing,
survive a reload, and never touch the published files until you export. The
browser only asks "leave site?" if something typed has not reached the draft
yet.

**Creating and deleting.** The `+` beside any department in the tree starts a
new process there (an entry step joined to a resolution step). The article,
FAQ and variable lists each have a `+ New` button, and every item has a
delete button on its own page. Deleting an article or FAQ detaches it from
every step first; a variable can only be deleted once nothing uses it.
Departments are managed at `#/departments`: rename, move under a new parent,
reorder, add sub-departments, and delete once nothing points at them.

**Attaching content.** Each step, and the process as a whole, has
`+ Article` and `+ FAQ`. The picker opens on suggestions for that step (the
same scoring the live call view uses) and searches the library as you type.

**Issues.** `⚑ Raise issue` on a process, or `⚑` on a single step, records an
issue by hand. Resolving keeps the issue, stamped with the date and an
optional note on how it was fixed, under *resolved* on the process page and in
the register — the report and CSV carry the history too. Reopen puts it back.

**When the published files move on.** If the files on GitHub have a newer
version than your draft started from, you stay on your draft and a bar offers
three ways forward:

| | |
|---|---|
| Review and merge | Item by item. Changed only on your side → yours is kept. Changed only in published → theirs is taken. Changed on both → you choose. |
| Keep my draft | Yours wins everywhere. The draft adopts the newer version numbers, so the bar does not come back and your next export numbers itself above theirs. |
| Take published | Throw the draft away. |

The draft keeps a copy of the published files it started from, which is what
lets the merge tell a one-sided change from a two-sided one. Drafts saved
before this existed have no copy, so every difference is listed for you to
choose, yours selected by default.

**Export** (the button in the header):

| | |
|---|---|
| Export for GitHub | Four files → `processhub/data/` and `processhub/exports/` |
| FAQ.json only | → `processhub/exports/FAQ.json`, which `FAQ.html` reads |
| Verification sheet | Every variable, grouped by owning department |
| Issues report | The register as a readable page |
| Discard local changes | Throw the draft away and reload the published content |

A process page also exports itself as JSON or as a self-contained HTML page,
and the variables list offers a verification email per department — copied to
the clipboard, or downloaded as a printable sheet. Variables are frozen to
their values in everything that leaves the app, and anything marked internal is
withheld from a public export.

**Prose editing.** Knowledge base articles and FAQ answers use the rich text
editor carried over from the FAQ Editor: bold, italic, paragraph, lists, links,
the Note / Warn / Term boxes, a starter table, and a `</> HTML` toggle for when
the markup needs a hand.

Underneath sits a **live preview styled like the published page**, so a public
answer is judged as it will appear rather than as markup. Variables show as
chips in the editor — dotted while they are unverified — and as plain text in
the preview, which is what a member of the public sees.

A chip is `contenteditable="false"`, so a reference can be deleted whole but
never half-edited into nonsense. The link builder can point at a URL variable
instead of a typed address, so a changed web address is still one edit.

**Content rules.** A rule is a standing check across every process, article
and FAQ. When something in the organisation changes — a system renamed, a form
retired, a team restructured — add a rule rather than hunt through 112
processes, and everything now wrong appears in the issues register.

Four kinds: text that should no longer appear, a field that ought to be filled
in, a date untouched for N months, and library content nothing references.
Each rule carries a severity, the scopes it applies to, and a message
explaining what to do. Text rules can match whole words only and exact
capitals — the Merit rule does both, so "sufficient merit" in a planning
answer is not flagged. Any rule can leave drafts alone: "not reviewed in 12
months" is true of every imported draft and says nothing new until a process
is marked mapped or beyond.

Findings are computed on every load and never stored, so fixing the content
makes the finding disappear by itself. A recorded issue has to be ticked off by
hand; a rule finding cannot lie about being fixed.

Manage them at `#/rules`. They export with the issues report and CSV. In the
register, recorded issues come first; each rule's findings sit collapsed under
its name and count until you open them.

**Coverage.** `#/coverage` shows each department's processes by status, its
handoffs, open issues and rule findings, plus variable verification by owning
department. The same page is in the Export menu as a self-contained report.

**Routes and branching.** The arrows between steps are the process's flow. A
decision step can lead to several places, each route with a label ("Yes",
"Over $500"). On the Steps view every step shows where it leads: click a label
to edit it, `×` to remove a route, and *+ Add a route to…* to draw a new one.
Adding, deleting or reordering steps never rebuilds the arrows or moves cards
on the map:

- a step inserted after another takes over where that step led, and the
  earlier step now leads to it
- a deleted step's incoming arrows are joined to wherever it led
- in a straight-line process ↑ ↓ reorder the flow and swap the two cards;
  once a process branches, the list is reading order only and the arrows are
  left as you drew them

Handoffs are counted along the arrows, so each branch into another
department counts.

**The map.** Every process has a Steps view and a Map view. On the map, cards
drag on a 20px grid, the background pans, Ctrl and the wheel zooms, and
**Tidy layout** arranges the process into columns by depth — wrapping every
five columns and running alternate rows backwards, so a ten step process reads
as two rows rather than one very long line. Arrows that cross a department
boundary are drawn dashed and orange.

Drag from the round handle on a card's right edge to another card to draw a
route. Click an arrow or its label to select it, then label or remove it in the
bar above the map. `✎` on a card opens that step in the Steps view.

Three card detail levels (Simple / Default / Context) control how much each
card shows, and the same setting drives the SVG.

**⤓ SVG** exports the map as real vector output — not a screenshot — with a
header carrying the process name, department path, step and handoff counts,
and a legend. Variables are frozen to their values, since an SVG cannot
resolve anything when it is opened.

## The live call view

`live.html` is the same data read a different way: one step at a time while
someone is on the phone. It shares `storage.js`, `data.js`, `edit.js` and
`export.js` with the editor, so the draft is the same draft and an export from
either view writes the same four files.

Open it, pick a process — the tree for finding your way, <kbd>/</kbd> for
search when you already know the name — and the first step fills the screen
with the rest of the process collapsed above and below it. Click any collapsed
step to jump there.

Next follows the arrows. Where a step has more than one route, it asks
*Which way?* with a button per route label; <kbd>1</kbd>–<kbd>9</kbd> pick one.
Back retraces the steps actually taken, not the list.

Each step carries two panels:

| | |
|---|---|
| Knowledge base | The internal articles attached to this step |
| What the customer can read | The FAQ answers attached to this step, rendered as the public page renders them |

Both stay shut until you open them, and both list **suggestions** underneath
what is already attached — articles and FAQ answers whose wording overlaps this
step. Suggestions are scored on how rare the shared words are, so boilerplate
counts for nothing and a shared term like *kerbside* counts for a lot. Attach
one and it stops being a suggestion and becomes a reference on the step,
carried out with the next export. Nothing is attached without a click.

Mid-call you can also:

- **✎ Note** — writes a note into the issues register against this step, marked
  `Live call`. The step's own text is never edited from here, so a hurried note
  cannot become published wording by accident.
- **+ Step after this** — adds a step where a real call found one missing.
- Tick the checks as you work through them.

Keyboard: <kbd>→</kbd> or <kbd>Space</kbd> for the next step, <kbd>←</kbd> to
go back, <kbd>1</kbd>–<kbd>9</kbd> to choose a route, <kbd>n</kbd> for a note,
<kbd>/</kbd> for search.

**Nothing is recorded about the call.** No timings, no counts, no log of who
opened what — the only things that persist are the edits you deliberately make:
an attachment, a note, an added step. They live in the same browser draft as
everything else and leave the machine only when you export and commit, so the
work survives the browser rather than living in it.

## Tools

The scripts run from the repository root and need nothing installed.

**Import the published FAQ content into the data model.** Overwrites everything
in `data/`, so it is only for seeding.

```
python3 processhub/tools/import-faq.py
```

**Import the call flowcharts.** Merges into the files above, so run it second.
Each leaf node of the diagram becomes one process: numbered items become steps,
`[ ]` lines become checks on the step above them, italic passages become the
call script, and context chips become article references.

```
python3 processhub/tools/import-flowcharts.py
```

This is a structural extraction, not a rewrite. Everything it produces is
`status: "draft"` and anything needing judgement is recorded as an issue.

**Project the data back into the `FAQ.json`** that the public page reads. This
writes `processhub/exports/FAQ.json`, which is the single source of truth for
published FAQ content — `../FAQ.html` fetches it directly:

```
python3 processhub/tools/export-faq.py
```

**Verify the round trip.** Compares a fresh export against the frozen
pre-Process-Hub copy at the repository root. That root `FAQ.json` is no longer
live — it is kept purely as this baseline. If a schema change ever loses
content, this catches it:

```
python3 processhub/tools/export-faq.py --check FAQ.json
```

At the last run: 129 variables, 14 tabs, 197 items, no published content lost.
The only difference from the original is the `departments` list, which gained
Works — an addition rather than a loss, so it is reported as a note.

## Current state

| | |
|---|---|
| Taxonomy | 11 departments, 22 sub-departments |
| Processes | 112, all `status: draft` |
| Steps | 515 (4.6 per process) |
| Articles | 37, all internal |
| FAQ questions | 166 across 14 publish tabs, each with an owner |
| Variables | 140 — 129 from the FAQ, 11 internal system names |
| Variable references | 332 across processes and articles, no orphans |
| Issues raised | 86 (32 high, 48 medium, 6 low) |
| Cross-department | 29 processes, 53 handoffs |
| Rule findings | 132 — 19 Merit (high), 112 processes without an owner (low), 1 unused article; 252 draft items left alone by the review-date rules |

## Known limits of the flowchart import

The importer extracts structure. It does not read for meaning, so:

- **Handoffs are undercounted.** Only transfers written as a numbered step are
  detected. Short-Term Accommodation reads as two departments because its
  four-department approval stack is described in prose, not as steps. A human
  reading it sees four.
- **Resolutions are inferred** from wording in the node body, so some are
  approximate.
- **32 processes referenced Merit.** The system name now resolves to the CRM
  variable, but the surrounding wording still describes the Merit workflow and
  needs rewriting.

All of this is why every imported process is `draft`.

## Next

1. Work the issue register down, starting with the 21 remaining Merit mentions.
2. Review the 13 variables that nothing references.
3. Proofread the imported content and move processes off `draft`.
