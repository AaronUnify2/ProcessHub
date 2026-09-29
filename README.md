# Process Hub

Process maps, knowledge base articles and public FAQ content in one editor.

Live at **https://aaronunify2.github.io/ProcessHub/** — Pages serves the `main`
branch as it stands, so every push to `main` is live within a minute or two.

## Two repositories

| | | |
|---|---|---|
| **ProcessHub** (this one) | public | The app, and `exports/FAQ.json` — the published FAQ content the public FAQ page reads |
| **ProcessHub-data** | private | The content: `data/processes.json`, `library.json`, `variables.json`, plus the spec and migration tools |

The content is internal to the council — internal articles, system names,
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
  css/app.css · css/live.css
  js/                github.js · gate.js · storage.js · data.js · merge.js · edit.js
                     rules.js · export.js · faq.js · richtext.js · canvas.js
                     ui-sidebar.js · ui-detail.js · app.js · live.js
  exports/
    FAQ.json         the live published FAQ content — the public FAQ page reads this
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

## Sections

The switch at the top of the sidebar has eight sections. Each gives the
sidebar a list for jumping straight to anything in it, and the content area
a dashboard for the section as a whole.

| Section | Sidebar | Dashboard |
|---|---|---|
| Processes | the department tree | totals, handoffs, the processes with most handoffs |
| FAQ | publish tabs, headings and questions — drag to reorder (below) | what needs attention, figures per tab |
| Articles | knowledge base articles by owning department | current vs draft, not attached, without an owner |
| Variables | variables by owning department, coloured by verification | verified, pending, stale, unused; a verification email or sheet per department |
| Issues | open issues by severity, then resolved | severity counts, issues by department, the full register and rule findings |
| Rules | every content rule with its severity and finding count | findings by severity; each rule opens on its own page with everything it finds |
| Coverage | the department tree with a status bar per department | status by department; each department opens on its processes |
| Depts | the department tree | the tree editor; each department opens on everything filed under, done by or owned by it |

Search looks at FAQ questions, articles or variables only when in those
sections, and at everything elsewhere.

Single issues, rules, departments and a department's coverage each have a
page of their own (`#/issue/<process>/<issue>`, `#/rule/<id>`,
`#/department/<id>`, `#/coverage/<id>`), so choosing one in the sidebar keeps
you in that section.

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

## Running the app

It reads its content from GitHub, so it needs a connection and a token the
first time; see *Signing in* above.

Keyboard: <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> jumps to search,
<kbd>Esc</kbd> clears it. The tree is the default view; search filters across
processes, articles, FAQ questions and variables at once.

Every view has its own address — `#/process/<id>`, `#/faq/<id>`,
`#/tab/<id>`, `#/article/<id>`, `#/variable/<id>`, `#/issue/<process>/<id>`,
`#/rule/<id>`, `#/coverage/<id>`, `#/department/<id>`, and each section's
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
