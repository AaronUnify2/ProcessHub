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
  data/              source content, fetched by the app at load
    processes.json     taxonomy + process maps
    library.json       KB articles + FAQ questions + publish tabs
    variables.json     variables + owners
  exports/           generated, never hand-edited
    FAQ.json           legacy shape for the council website
  tools/             one-off migration scripts
    import-faq.py
    export-faq.py
```

## Tools

Both scripts run from the repository root and need nothing installed.

**Import the published FAQ content into the data model.** Overwrites everything
in `data/`, so it is only for seeding.

```
python3 processhub/tools/import-faq.py
```

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

At the last run: 129 variables, 14 tabs, 197 items, identical to the original.

## Current state

| | |
|---|---|
| Taxonomy | 10 departments, top level only |
| Variables | 129, all `status: pending` |
| FAQ questions | 166 across 14 publish tabs |
| Articles | 0 — arrive with the flowchart import |
| Processes | 0 — arrive with the flowchart import |

## Next

1. Import the flowchart content: 112 processes, 37 articles, the
   sub-department taxonomy, and the internal system variables.
2. Build the editor shell: storage layer, sidebar, process canvas.
3. Wire up the export matrix from the spec.
