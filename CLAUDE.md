# Process Hub

Process maps, knowledge base articles and public FAQ content in one editor.
A multi-file static web app: plain HTML, CSS and JavaScript, no build step, no
framework, no `package.json`, no dependency install. The browser loads the
files as they sit in the repository.

Read `README.md` for how the app works and `SPEC.md` for the data model before
changing either.

## How to build things here

**Plain, readable JavaScript.** ES5-style modules on `window` (`Data`,
`Edit`, `Storage`…), one concern per file under `js/`. It should still make
sense in six months. No clever abstractions, no syntax that needs tooling.

**No external dependencies unless asked.** If a library is genuinely needed,
load it from a CDN with a pinned version. Never a local install.

**Always produce complete files, not diffs or fragments.** Aaron prefers whole
files — it reduces errors and makes review straightforward.

**Works on a phone as well as a desktop.** Responsive layout is expected, not
a bonus.

**Test it before calling it done.** Serve the repository over http (the app
fetches `data/*.json`, so `file://` will not work) and drive it in a headless
browser. Check edge cases and computed results rather than assuming. Say
plainly if something doesn't work.

## The data files

`data/processes.json`, `data/library.json` and `data/variables.json` are the
content. `exports/FAQ.json` is generated from them — never hand-edit it.

If you edit a data file directly, bump its `version` and set `updated`. The
app compares versions to decide whether someone's local draft is out of date;
an edit without a bump can be silently overwritten by an older draft.

`tools/export-faq.py --check` must stay clean: it proves no published FAQ
content has been lost against the frozen baseline in `tools/sources/`.

## Hosting

GitHub Pages serves this repository straight from the `main` branch (Settings →
Pages → Deploy from a branch → `main`, root). Every push to `main` is live
within a minute or two. `.nojekyll` tells Pages to serve the files exactly as
they are, without running Jekyll over them:

```
https://aaronunify2.github.io/ProcessHub/
```

The public FAQ page, `FAQ.html` in the UnifyVersion1 repository, reads
`https://aaronunify2.github.io/ProcessHub/exports/FAQ.json`. Changing the shape
of that file breaks the public page.

## Workflow

- Develop on the assigned working branch and commit with a clear message.
- Merge into `main` when the work is done. **No pull request is needed**
  unless Aaron explicitly asks for one.
- After merging, send him the live Pages URL so he can test it.
