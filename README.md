# Process Hub

Process maps, public FAQ content and fact sheets in one editor, all built from
one set of variables.

Live at **https://aaronunify2.github.io/ProcessHub/** — Pages serves the `main`
branch as it stands, so every push to `main` is live within a minute or two.

## Two repositories

| | | |
|---|---|---|
| **ProcessHub** (this one) | public | The app, and `exports/FAQ.json` — the published FAQ content the public FAQ page reads |
| **ProcessHub-data** | private | The content: `data/processes.json`, `library.json`, `variables.json`, plus the spec and migration tools |

The content is internal to the council — draft fact sheets, system names,
extension numbers, the issues register — so it lives in the private
repository and is never served by the public site. The app reads it through
the GitHub API with each person's own token. Without a token that can read
ProcessHub-data there is nothing to load, and the app shows a sign-in screen
instead.

Process Hub started as a folder in
[UnifyVersion1](https://github.com/AaronUnify2/UnifyVersion1) and moved here.
The content, with its history, is in the private repository. Older commits in
this repository's history still contain the content files from before the
split. That was a deliberate choice: the aim is council hosting, and the
content in those older public copies was judged acceptable to leave.

## Layout

```
  index.html         the app
  live.html          the live call view
  ask.html           experimental, staff only: ask a question in plain words, get the matching
                     FAQ answers (a small language model running in the browser)
  map.html           experimental, staff only: the published FAQ laid out by meaning
  css/app.css · css/live.css · css/gate.css · css/meaning-map.css
  js/                github.js · gate.js · storage.js · data.js · merge.js · edit.js
                     rules.js · writing.js · checks.js · export.js · factsheet-export.js · faq.js
                     richtext.js · canvas.js
                     semantic.js · semantic-worker.js · probe.js · meaning-map.js · probe-map.js
                     spot-hint.js
                     ui-sidebar.js · ui-detail.js · ui-probe.js · app.js · live.js
  exports/
    FAQ.json         the live published FAQ content — the public FAQ page reads this
  vendor/            self-hosted copies of Transformers.js and the model for ask.html
                     and the Probe section — see vendor/README.md
```

## Signing in

The first time on a computer, Process Hub asks for a fine-grained personal
access token:

- Repository access: **Only select repositories → ProcessHub-data and ProcessHub**
- Permissions: **Contents → Read and write**, nothing else
- An expiry of 90 days is sensible

The token is checked with GitHub, then kept in this browser's `localStorage`
on this computer only — never in the draft, an export or a repository — and is
only ever sent to `api.github.com`. **Sign out** (under Export → GitHub
connection) removes the token *and* the local copy of the content, warning
first if there are unpublished changes.

If GitHub cannot be reached, a draft already on the computer still opens, so
work can carry on offline and be published later.

**`ask.html` and `map.html`** sit behind the same sign-in. They start hidden
and run only once GitHub confirms the token kept in the browser can still read
ProcessHub-data; anyone signed in to Process Hub on that computer goes
straight in. They ask search engines not to index them. What they show is the
public FAQ, so the sign-in keeps the tools to staff — it cannot hide the
files themselves, which GitHub Pages serves to anyone who asks for them by
name (their code, and the FAQ fingerprints in `ask.html`, can still be
downloaded). `exports/FAQ.json` and the public FAQ page stay public.

## Sections

The switch at the top of the sidebar has eight sections. Each gives the
sidebar a list for jumping straight to anything in it, and the content area
a dashboard for the section as a whole.

| Section | Sidebar | Dashboard |
|---|---|---|
| Processes | the department tree | totals, handoffs, the processes with most handoffs |
| FAQ | publish tabs, headings and questions — drag to reorder (below) | what needs attention, figures per tab |
| Fact sheets | fact sheets by stage: draft, in sign-off, approved, live | counts by stage, who sign-off is waiting on, what needs attention, by owner |
| Variables | department › sub-department › source document › value, coloured by verification | verified, pending, stale, unused, sourced; what still needs a public source; every source document and the values it backs; a verification email or sheet per department |
| Issues | open issues by severity, then resolved | tiles for open, high, medium, low, content gaps and resolved — click one to list just those issues (`#/issues?show=high`, `gaps`, `resolved`…); issues by department, and the full register of what people have raised |
| Rules | writing checks, housekeeping checks, then your rules, each with what it finds | the six built-in checks as cards under *Writing* and *Housekeeping*, then your text rules; each opens on its own page |
| Departments | the department tree with a status bar per department | progress for every department — processes by status, FAQ answers (how many public), fact sheets (how many approved), variables (how many verified), open issues; each row opens the department |
| Probe | the questions probed lately, and the open content gaps | ask a question the way a customer would and see whether the FAQ answers it; open content gaps, and which of them an FAQ answer now seems to cover (below) |

Search looks at FAQ questions, fact sheets or variables only when in those
sections, and at everything elsewhere.

Single issues, rules and departments each have a page of their own
(`#/issue/<item>/<issue>`, `#/rule/<id>`, `#/department/<id>`), so choosing
one in the sidebar keeps you in that section.

## The Variables section

The sidebar nests each variable under the department that owns it, then the
sub-department (where it is owned by one), then the published document it
comes from — so you can see at a glance which figures each document backs.
A department's own values sit under its sources, after its sub-departments;
values with no source yet, and internal ones that never need one, come last.
A document cited by two departments appears under each, with that
department's values.

- Click a **department** to open or close it. Click a **document's name** to
  open its page; its ▸ opens it in the sidebar. A ⚑ marks a value with an
  open issue.
- A **source page** (`#/source/<link>`) has a *View live page* button, every
  value the document backs split into **Still correct** (verified, no open
  issue — carry them forward when the document is updated) and **Needs
  attention** (unverified, stale or with an open issue), and the
  departments that own them.
- A **variable's page** reads top to bottom: the value, then **Where it comes
  from** — the document, a *View live page* button, the words that say so and
  when someone last checked — then **Where it's used**, by fact sheet,
  process (with the step numbers) and FAQ answer, then its **Issues**. The
  breadcrumb at the top is the same path as the sidebar.
- A department's page lists the **Variable sources** its values draw on.

## The FAQ section

The switch at the top of the sidebar moves between **Processes** and **FAQ**.

In the FAQ section the sidebar is the public FAQ page as a list: each publish
tab with its section headings and questions, in published order.

- **Drag** any row to move it — within a tab, into another tab, or onto a
  tab's name to put it at the end. A heading row drags on its own, and the
  questions below it follow whichever heading they end up under, exactly as
  in the old FAQ Editor.
- **↑ ↓** appear on the open question (and on headings), for phones and for
  anyone who would rather not drag.
- **+ Question** and **+ Heading** sit at the foot of each tab. A new heading
  holds no question yet, so it stays greyed until a question is moved under
  it — until then it is not saved.
- **Not published** at the bottom holds questions in no tab.
- Search looks through FAQ questions only while this section is showing.

The content area opens on an **FAQ dashboard**: totals, questions not
published, not yet approved or without an owner, how many are linked to a
process step, and how many rely on a value nobody has verified yet; then each
tab's figures, and a short list of questions that need attention.

Clicking a tab's name opens its **settings**: the label, the NEW badge, the
last-reviewed date, the intro box, the step strip (written by hand, or
generated from a process map so it never drifts from it), the footer links,
and moving or deleting the tab. Deleting a tab moves its questions to *Not
published* — nothing is lost.

Behind the scenes each question stores its tab, its position and the heading
it sits under; the list and the published `FAQ.json` are two views of the
same thing, and reordering nothing leaves `FAQ.json` byte-for-byte unchanged.

Each question's page also has **Also asked as**: other ways people ask it,
one per line, in their words (`alsoAsked`), and **Everyday question**
(`common`), for the question most people mean when several answers fit.
Neither is ever published as text. Probe and `ask.html` match a question
against its phrasings as well as its own wording, and give an everyday
question a small lift (3 points) that breaks near-ties. When Probe lands on
the wrong answer, add what was asked as a phrasing on the right one.

## Fact sheets

A fact sheet is the longer public version of what the FAQ answers say, built
from the same variables, so a fee or phone number changed once is right in
both. Fact sheets are not published from Process Hub: they go out for sign-off
as a review pack, and once approved go to comms as a Word document for the
council's style guide to be put on.

The Fact sheets section lists them by stage — **Draft → In sign-off →
Approved → Live** (live meaning comms have published it on the council
website). The dashboard shows who each sheet in sign-off is still waiting on,
and what needs attention: an internal value in the wording, changes requested,
no reason given for replacing the current sheet, no related FAQ answers.

Each fact sheet's page holds:

| | |
|---|---|
| The fact sheet | Written in the rich text editor, with section headings (H2, H3) and **☐ List** for a checklist, as well as everything an FAQ answer can use. The preview shows it as it will be exported. |
| What it replaces | The title and link of the version on the council website now, if there is one |
| Why replace it | The case for the new sheet — what it does that the current one doesn't |
| Related FAQ answers | The FAQ questions it expands on, with suggestions drawn from its wording. Each FAQ question's page lists the fact sheets that expand on it. |
| Sign-off | Everyone who has to agree, with their role, decision (Waiting, Approved, Changes requested — dated when chosen) and comments |
| Where the values come from | Every value it uses, and the public source behind each |

**Exports**, from the buttons at the top of the page:

| | |
|---|---|
| Fact sheet → Word | A `.doc` file with Word's own headings, lists and tables, for comms to restyle |
| Fact sheet → PDF | A printable page; choose *Save as PDF* in the print dialog |
| Review pack → Word or PDF | Sign-off table, the reason for replacing the current sheet and a link to it, the proposed sheet, the related FAQ answers as they read now, and a table of every value with its source and whether it has been verified |

A sheet still in draft or sign-off carries a *not yet approved* line at the
top of every export. Values are frozen into the text; an internal value is
never printed — it is replaced with *[internal value withheld]*, and the page
warns about it before you export.

Fact sheets attach to process steps with `+ Fact sheet`, and appear in the
live call view's **Fact sheets** panel.

## Probe

Probe answers one question: *does the FAQ have an answer for this?* Type a
question the way a customer would put it — "can I keep chooks in town",
"where's the tip" — and Probe ranks every FAQ answer in your draft by how well
it answers it, with a plain verdict on top:

| | |
|---|---|
| ✓ Answered | a strong match (55% or more): the content is there |
| ~ Partly | related answers (38–55%), but maybe not this question |
| ✗ Not answered | nothing comes close |

It compares by meaning, not by words, using the same small language model as
`ask.html` (all-MiniLM-L6-v2, self-hosted in `vendor/`), running in the
browser — nothing typed leaves it. Each result shows its score, where it sits
on the FAQ page (or that it isn't public), its status, and the answer itself.
**Include questions not on the public page** is on by default, so you can tell
a real gap from an answer written but not yet published.

**Content gaps.** A question the FAQ doesn't answer can be logged with **⚑ Log
as a content gap** — the question, a note (filled in with the nearest answer
Probe found), the department to answer it and the tab it would belong on
(both guessed from the nearest answer), severity and who raised it. A content
gap is its own kind of issue: it is listed in the issues register, counted
on the Issues and Departments dashboards and in the register's exports, and
has its own page (`#/issue/<gap>/<gap>`) with the same resolve, reopen and
delete. A gap logged by mistake can also be deleted straight from Probe, with
the **×** on its row or card. Gaps are kept in `library.json` → `contentGaps` and published with the
rest of the draft.

Probe also reads each question's **Also asked as** phrasings and its
**Everyday question** flag (see *The FAQ section*).

Open gaps are searched along with the FAQ, so probing a question that has
already been logged — in any wording — shows the gap under **Already logged
as a content gap** rather than inviting a second one. And the gaps check
themselves: once an FAQ answer matches a gap strongly, the Probe dashboard
marks it *may be answered by …*, and **✓ Resolve** closes it, recording the
answer that covers it.

The first time Probe opens on a computer the model loads in a few seconds.
Fingerprints for the published FAQ come ready-made from `ask.html`; anything
new or edited is read once and kept in the browser (IndexedDB), so only
changed text is ever read again.

**The meaning map.** Between the search box and the closest answers, Probe
shows the whole FAQ laid out by meaning (see *The meaning map* below), drawn
from the draft — unpublished questions included, as hollow rings:

- A probed question is a **★**, placed among the answers Probe ranked
  highest, with lines to them (heavier for a higher score). The caption reads
  the picture: the closest answers sitting together means the model knows
  what the question is about (and if none scores well, that part of the FAQ
  has a gap); answers spread across different parts of the map means it
  can't tell — that is when Ask picks the wrong answer, and an *Also asked
  as* phrasing on the right answer is the fix.
- On the dashboard, open content gaps are **◇ diamonds**, each placed among
  the answers it comes closest to; a patch of them is a topic the FAQ is thin
  on. Tap one to probe it again.
- Tap a dot for its question, status and meaning group, with a link to it.
- **Tap empty space** to ask *what would go here?* A target marks the spot,
  and the caption suggests three questions that would sit there, each a link
  that probes it. The model can only read, not write, so the suggestions are
  made in steps (`js/spot-hint.js`): the spot's fingerprint is estimated by
  blending the answers around it, nearest counting most; candidate questions
  are written from the phrases those answers use most and the rest of the FAQ
  uses least, set into everyday question shapes ("Who do I contact about …?",
  "Is there a fee for …?"); and the model keeps the candidates closest to the
  spot. Each shows how well it fits the spot and the nearest question the FAQ
  already has. The wording is only ever the FAQ's own phrases, so it reads
  stiffly — a hint to probe, not a finished question. A spot far from any dot
  is flagged as empty ground between topics, where the hints are the most
  likely to be gaps.

The map waits until every answer has been read, lays itself out once, and
again only when an FAQ question or answer changes.

**Refreshing `ask.html`.** `ask.html` carries the fingerprints of the
published FAQ, including each question's phrasings (as fingerprints only,
never their text) and which are everyday questions. After phrasings change,
or once a lot of the FAQ has been edited: open Process Hub with the published
content and no local changes, run `copy(await Probe.exportFingerprints())`
in the browser console, and paste the result over the `fingerprints` block
in `ask.html`.

## The meaning map (experimental)

`map.html` lays the published FAQ out on one page by meaning: every answer is
a dot, and answers the model reads as being about the same thing sit close
together, whatever tab they are on. It is behind the sign-in (see *Signing
in*), then reads `exports/FAQ.json`, the fingerprints in `ask.html`, and the
model in `vendor/`, so it opens in a few seconds:
`https://aaronunify2.github.io/ProcessHub/map.html`. The same map, drawn from
the draft, is in the Probe section. Both use `js/meaning-map.js`.

- **Read: Whole answers** averages each question with every passage of its
  answer; **Questions only** uses the question as `ask.html` reads it.
- The layout is t-SNE, worked out in the browser and seeded, so the same
  content gives the same map; **Re-run layout** draws it from another start.
  Nearness is meaningful, distance across the page is not.
- **Colour by: Meaning group** shows the model's own grouping (k-means on the
  fingerprints, ignoring tabs), named after each group's most distinctive words.
- The side panel lists **possible overlaps** (pairs read as near-identical)
  and **answers far from their tab** (most of their nearest answers are on
  other tabs) — candidates for merging or cross-linking.
- Typing a question loads the model and drops a star where it lands, with
  lines to the closest answers.

## Running the app

It reads its content from GitHub, so it needs a connection and a token the
first time; see *Signing in* above.

Keyboard: <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> jumps to search,
<kbd>Esc</kbd> clears it. The tree is the default view; search filters across
processes, fact sheets, FAQ questions and variables at once.

Every view has its own address — `#/process/<id>`, `#/faq/<id>`,
`#/tab/<id>`, `#/factsheet/<id>`, `#/variable/<id>`, `#/source/<link>`, `#/issue/<item>/<id>`,
`#/rule/<id>`, `#/department/<id>`, and each section's
dashboard — so back, forward and copied links all work.

**Editing.** Click any field to change it. Enter saves a single-line field,
Ctrl+Enter a multi-line one, Esc cancels. The `+ Variable` button on the edit
toolbar inserts a reference that stays in step with the variable. Steps can be
added, reordered and deleted; checks and issues likewise.

Changes go to a draft in IndexedDB about half a second after you stop typing,
survive a reload, and never touch the published files until you export. The
browser only asks "leave site?" if something typed has not reached the draft
yet.

**Creating and deleting.** The `+` beside any department in the tree starts a
new process there (an entry step joined to a resolution step). The fact sheet,
FAQ and variable lists each have a `+ New` button, and every item has a
delete button on its own page. Deleting a fact sheet or FAQ detaches it from
every step first; a variable can only be deleted once nothing uses it.
Departments are managed on each department's own page: rename, move under a
new parent, reorder, add sub-departments or processes, and delete once nothing
points at them. **+ New department** is on the Departments tab.

**Attaching content.** Each step, and the process as a whole, has
`+ Fact sheet` and `+ FAQ`. The picker opens on suggestions for that step (the
same scoring the live call view uses) and searches the library as you type.

**Issues.** An issue is something a person has noticed — a number that
doesn't match, a guess that needs checking, a step that is missing. It can be
about a process (or one of its steps), an FAQ answer, a fact sheet or a
variable, and it is kept on that item (`issues` on the process, the FAQ answer,
the fact sheet or the variable). Raise one with `⚑` on any of those pages, `⚑`
on a single step, from the live call view, or with **⚑ Raise an issue** on the
Issues tab, where you search for what it is about. A **content gap** — a
question the FAQ doesn't answer — is the one kind with nothing to sit on: it
is logged from Probe and kept in its own list (see *Probe*).

Each page lists its issues at the foot, after *Used in*: open ones in full,
resolved ones folded away. Resolving keeps the issue, stamped with the date and
an optional note on how it was fixed — the register, the report and the CSV
carry the history too. Reopen puts it back. Issues are internal: neither
FAQ.json export carries them.

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
| Publish to GitHub | All four files as one commit on `main` — see below |
| GitHub connection… | Save, test or forget the token this computer publishes with |
| Download the files instead | The same four files, to commit by hand |
| FAQ.json only | → `exports/FAQ.json`, which the public FAQ page reads |
| Verification sheet | Every variable, grouped by owning department |
| Issues report | The register as a readable page |
| Discard local changes | Throw the draft away and reload the published content |

A process page also exports itself as JSON or as a self-contained HTML page,
and the variables list offers a verification email per department — copied to
the clipboard, or downloaded as a printable sheet. Variables are frozen to
their values in everything that leaves the app, and anything marked internal is
withheld from a public export.

**Prose editing.** Fact sheets and FAQ answers use the rich text
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

**Rules.** The Rules tab has two parts.

*Built-in checks* — six of them, defined in code (`js/rules.js`, worked out by
`js/checks.js` and `js/writing.js`). Each goes through all of Process Hub at
once and lists what it finds by type — variables, FAQ answers, fact sheets,
processes — and then by department, with dropdowns to narrow the list. The
tab and its sidebar show them in two groups, writing first:

| | Check | What it shows | Setting |
|---|---|---|---|
| **Writing** | Who does this? | instructions that say something must be done without saying who | words never to flag |
| | Long sentence | sentences in FAQ answers and fact sheets over a word limit | the word limit |
| | No next step | FAQ answers with no link, phone, email or "see *another answer*" | — |
| **Housekeeping** | Empty fields | every field in the app, how many leave it empty; pick a row for the list | — |
| | Not touched | every review, verification and edit date older than the period chosen, or missing | 1, 3, 6 or 12 months |
| | Nothing uses it | variables nothing uses; FAQ answers and fact sheets no process attaches | — |

They can be switched off, and given their one setting, but not changed, copied or
deleted. `Rules.applyBuiltIns`, called from `Storage.upgrade` on every load,
puts any that are missing back with their fixed settings. The writing checks
are also run as you type, in the **Writing check** panel under the FAQ and
fact sheet editors.

*Your rules* — the one kind people add: **text that should no longer appear**
(a system renamed, a form retired, a team that is now called something else).
Each has the wording or a pattern, an optional "say instead", whole words
only, match capitals, a severity, what it applies to, and a message. A text
rule checks everything it applies to and lists what it finds in the issues
register; where it applies to FAQ answers or fact sheets, the Writing check
also flags it as you type, with what to say instead. The Merit rule matches
whole words and exact capitals, so "sufficient merit" is not flagged.

Findings are computed, never stored: fix the content and the finding
disappears by itself. A recorded issue has to be ticked off by hand; a rule
finding cannot lie about being fixed. Only text rules count in the issues
exports (the Issues tab itself lists only what people have raised) — the
built-in checks have their
own pages, where thousands of empty fields would not bury what needs action.

**Writing check.** A panel under the FAQ answer and fact sheet editors, run a
moment after you stop typing, with Who does this?, Long sentence, No next step
and every text rule that applies there. It reads what a reader sees, block by
block, so a sentence never runs across a heading or a list item, and a
variable counts as its value. Click a flag to select the words in the editor;
× dismisses it until the page is next opened. It never changes the text.

**Departments.** `#/departments` is one table of progress by department, each
row counting the department and everything under it: processes and their
status, handoffs, FAQ answers (and how many are on the public page), fact
sheets (and how many are approved), variables (and how many are verified), and
open issues on any of it. FAQ answers, fact sheets and variables count under
their owning department. Each row opens the department's page — its figures,
everything filed under, done by or owned by it, and the controls to rename,
move, reorder, add to or delete it. The same table is in the Export menu as a
self-contained report. The old Coverage addresses (`#/coverage`,
`#/coverage/<id>`) open the Departments pages.

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

## Publishing

**Publish to GitHub** writes `data/processes.json`, `data/library.json` and
`data/variables.json` to **ProcessHub-data** as one commit, then
`exports/FAQ.json` to **this repository** as another. Files whose content has
not changed are left alone, and a repository with nothing new gets no commit.
Pages serves `main` here, so the public FAQ page picks up a new `FAQ.json`
within a minute or two. If the second commit fails, the content is already
safe and the dialog offers to send the FAQ on its own.

The dialog lists what changed since the last publish — worked out the same way
as the merge, by comparing the draft with what it started from — and offers a
commit message built from it ("Process Hub: 2 processes, 1 FAQ question"),
with the list of items in the commit body.

Before writing anything it reads the version numbers of the files on GitHub.
If someone has published since your draft started, it stops and sends you to
**Review and merge** instead of overwriting their work. The final step asks
GitHub to move `main` only if nobody moved it in the meantime, so two people
publishing at once cannot clobber each other either. Nothing in the app
changes until GitHub has accepted the commit.

The same token signs you in and publishes. To stop it working everywhere,
not just on one computer, delete it on GitHub.

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
| Fact sheets | The fact sheets attached to this step, with their stage |
| What the customer can read | The FAQ answers attached to this step, rendered as the public page renders them |

Both stay shut until you open them, and both list **suggestions** underneath
what is already attached — fact sheets and FAQ answers whose wording overlaps this
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
