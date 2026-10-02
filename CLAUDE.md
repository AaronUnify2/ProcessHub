# Process Hub

Process maps, knowledge base articles and public FAQ content in one editor.
A multi-file static web app: plain HTML, CSS and JavaScript, no build step, no
framework, no `package.json`, no dependency install. The browser loads the
files as they sit in the repository.

Read `README.md` for how the app works. The content and its data model
(`SPEC.md`) live in the **private** ProcessHub-data repository.

## Public repository — keep it that way

This repository is public and served by GitHub Pages. **Never add council
content to it**: no data files, no copies of articles, processes or issues, no
internal system names beyond what the code already needs, no test fixtures
made from real content. The only content file here is `exports/FAQ.json`,
which is public by design and written by Process Hub's Publish button.

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

**Test it before calling it done.** Serve the repository over http and drive
it in a headless browser, with the GitHub API mocked (see *The content*).
Check edge cases and computed results rather than assuming. Say plainly if
something doesn't work.

## The content

The app reads `data/*.json` from the private ProcessHub-data repository
through the GitHub API (`js/github.js`, `Storage.fetchLive`), so there is no
content to serve locally. To test, run a local server and stand in for the
API — route `https://api.github.com/**` in a headless browser to a mock that
serves the files — never by copying real content into this repository.

`exports/FAQ.json` must keep the shape the public FAQ page reads.

## Publishing from the browser

`js/github.js` reads the content from ProcessHub-data and publishes it
there, then publishes `exports/FAQ.json` here — one commit each, straight to
`main` — using a fine-grained token the person pastes into the sign-in
screen. The token
lives in `localStorage` under `processhub.github.token` and must never be
written anywhere else — not the draft, not an export, not a log. Never ask
Aaron for the token or put one in the repository.

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

## Writing FAQ content

Workshopping FAQ questions and answers with Aaron is done in a separate
session, in the private ProcessHub-data repository — its `CLAUDE.md` has the
whole procedure. Content is written into the data there and reaches the public
page only when Aaron presses Publish. Nothing about it happens in this
repository; this one is for changes to the app.

## Workflow

- Develop on the assigned working branch and commit with a clear message.
- Merge into `main` when the work is done. **No pull request is needed**
  unless Aaron explicitly asks for one.
- After merging, send him the live Pages URL so he can test it.
