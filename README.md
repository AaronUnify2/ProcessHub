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
  css/app.css
  js/                storage.js · data.js · ui-sidebar.js · ui-detail.js · app.js
  data/              source content, fetched by the app at load
    processes.json     taxonomy + process maps
    library.json       KB articles + FAQ questions + publish tabs
    variables.json     variables + owners
  exports/           generated, never hand-edited
    FAQ.json           legacy shape for the council website
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
`#/faq/<id>`, `#/variable/<id>`, plus `#/articles`, `#/faqs`, `#/variables` and
`#/issues` — so back, forward and copied links all work.

**This pass is read-only.** It exists so the imported content can be read and
judged. Editing, the draggable canvas and the export matrix come next.

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

**Project the data back into the legacy `FAQ.json`** that the council website
already consumes:

```
python3 processhub/tools/export-faq.py
```

**Verify the round trip.** Compares a fresh export against the original file
and reports any difference. This is the regression test for the data model —
if a schema change loses content, this catches it:

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

1. Editing: step fields, the variable manager, the rich text editor.
2. The draggable process canvas and SVG export.
3. The rest of the export matrix from the spec.
4. Work the issue register down, starting with the 32 Merit rewrites.
