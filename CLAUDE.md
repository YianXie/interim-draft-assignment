# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A laptop-only demo (Interim Draft Assistant): six invented `.xlsx` files become an editable, explained allocation of teachers to course-sponsor seats, solved in the browser and downloadable as Excel. Plain JavaScript, bundled with esbuild, served as static files from `127.0.0.1:4173`. No framework, no TypeScript, no Worker, no server code beyond `scripts/serve.mjs`. `docs/spec.md` is the governing spec; feature designs and plans are in `docs/superpowers/`.

## Hard rules (from docs/spec.md)

- **Invented data only.** Never open `~/interim-private`, any `config/pseudonymize.yaml`, or any real file. No real-year figure in code, tests or fixtures. `tools/reader-test/cases.py` must never hold a real teacher's answer.
- **Never loosen an existing check** without the owner's yes. "Done" means pasted output of `npm run check` ending in `CHECK OK`.
- **Screen fixes: rename or remove, never add a sentence.** Screens have word/size budgets (below).
- On-screen wording says "best draft found", never "proven", "optimal" or "secure". The forbidden-word list is in `tests/e2e/words.mjs` (also: Keep, Kept, Swap, mixed, gender, Sample school, …) and is matched whole-word, case-insensitive, over visible text, `title`/`aria-label`/`placeholder`/`value`, and every workbook string.
- The page must never make outside requests. The CSP meta in `public/index.html` must stay the first element in `<head>`; no inline scripts, and no outside links except the one plain link to the project's GitHub page (owner-approved 2026-11-16). The page never calls a model.
- Dependencies are pinned exactly in `package.json`. `src/xlsx.js` is the only file that imports `hucre`.

## Commands

Node 24+ is required. `start-server.command` (double-click launcher, written for the office: plain messages only) picks the first Node 24+ from `./.node/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, then PATH; if none, it offers to fetch the checksum-verified nodejs.org tarball into `.node` (gitignored, no sudo). It clears quarantine on its own folder, refuses to start a second server (asks before opening a second tab, since two tabs can lose saves), runs a quiet `npm ci` when `node_modules/.package-lock.json` is missing, and re-fetches once if the build fails. Office-facing steps are in `docs/office-guide.md`.

```bash
npm install
npm run build        # dist/: bundled app.js, public/, highs.wasm, fixtures as dist/sample + two sample zips
npm run serve        # http://127.0.0.1:4173 (serves dist/, so build first); INTERIM_PORT=4174 npm run serve for another port
npm run check        # build + unit tests + Playwright, ends with CHECK OK
npm run check:final  # same, Playwright repeated 5 times
```

Single tests:

```bash
node --test tests/unit/solver.test.mjs
node --test --test-name-pattern "some name" tests/unit/
npm run build && npx playwright test tests/e2e/draft.spec.mjs
```

Playwright starts its own `npm run serve` (`reuseExistingServer: false`), so stop any server already on 4173 or run with another port (`INTERIM_PORT=4174 npm run check`; e2e tests take their origin from `ORIGIN` in `tests/e2e/helpers.mjs`), and rebuild before e2e runs because it serves `dist/`. Browser tests must use no fixed waits.

Regenerating fixtures (needs `uv`; Python + OR-Tools are used only here):

```bash
npm run fixtures        # fixtures/school + fixtures/expected.json
npm run fixtures:past   # fixtures/past + expected-past.json
npm run fixtures:fit    # fixtures/fit/fit.xlsx + expected-fit.json, expected-past-fit.json
npm run fixtures:later  # fixtures/later/kept.json + expected-later.json
```

The fit reader is run by hand against a local Ollama, never by the page or tests: `node tools/reader.mjs --dir <folder with the six>` (see README for flags). Prompt experiments live in `tools/reader-test/`.

## Architecture

Data flow: **files → `School` → solver → `Mock` state → snapshots in IndexedDB → render / export.**

- `src/import.js` — `parseFiles(files, random)` turns dropped workbooks into a `School` or per-slot refusals (one plain line: file, row, problem). The file name picks the slot (`SLOTS`, `PAST_SLOTS`, `FIT`); exact headers in `HEADERS`, first sheet must be `Fernhollow`, emails must be `@fernhollow.example`. `round2.xlsx`/`singapore.xlsx` are optional; the past files are all four or none; `fit.xlsx` is optional. T numbers are random IDs assigned here. Runs in browser and Node, so no Node imports.
  Later forms are added on a built draft: `readForms(school, files)` reads only `round2.xlsx`/`singapore.xlsx` (`LATER`) into a copy of the School; the app's Add forms card calls it.
- `src/past.js` — last year's result per teacher from the four `past-*` files (pure, imports nothing).
- `src/solver.js` — `solveDraft(highs, school)` builds an LP-format MIP and solves it with HiGHS (WASM) lexicographically: each stage is solved then pinned as an equality before the next. Stages: (1) min empty seats on returning-sponsor courses, [past files only: max "owed" teachers on a top-4 choice], (2) max preference score (rank weight 7..1 + round bonus 20/10/0), (3) min no-form teachers placed, [fit only: max teachers on a course they fit, then max agreement with the plain draft]. Input is sorted by normalised email and course code, never by T number, so the same files give the same draft. `fixtures/expected*.json` (from the independent CP-SAT `tools/expected.py`, which shares no code with `src/`) must match these stage values.
  Later forms are added on a built draft with `solveDraft(highs, school, keep)`: everyone in `keep` stays put and `pairs` holds only the new placements; the app accepts them only if `newProblems` (recheck.js) is empty.
- `src/recheck.js` — independent plain re-check of every hard rule on a draft; imports nothing, especially not the solver.
- `src/state.js` — `Mock`: the ported mock's in-memory state and all derived text (reasons ≤ 20 words that never name another teacher, flags, To do list, move/leave/undo/restore, names switch). Every change appends a snapshot holding only T numbers and course codes; words are built at display/export time so they follow the names switch.
- `src/store.js` — IndexedDB `interim-demo`: one `upload` record (parsed School, with names) and one `snapshots` record per version. A new upload clears snapshots; Add forms replaces the upload and keeps them.
- `src/export.js` — sheets for the download (Courses, Teachers, Changes, plus Last year / Note when relevant), following the names switch; `cleanCell` strips XML-illegal characters.
- `src/app.js` — DOM rendering and event wiring for Start, To do, Teachers, Courses; serialises IndexedDB writes so "Saved" is never claimed over a failed write.

## Tests

- `tests/unit/` (`node:test`) cover import, solver vs expected JSON, recheck (one broken draft per rule), reasons, export, past, fit, reader. `*-fixture.mjs` files are helpers that parse the fixture folders.
- `tests/e2e/` (Playwright, Chromium) drive real uploads and screens. `helpers.mjs` collects page errors and CSP violations; `words.mjs` is the forbidden-words check; `network.spec.mjs` asserts zero outside requests.
- Screen budgets: `tests/e2e/measure-source.mjs` holds `BUDGETS` and `INSPECT`, copied from `seed/measure.cjs` and locked by SHA-256 in `tests/e2e/lock.json` (checked by `tests/unit/lock.test.mjs`). Do not edit them. Pages mark up `data-rows`, `data-row` and `data-panel` for this measurement; Start/To do use the `first` budget, lists `list`, an open reason `detail`.
- `docs/hand-checks.md` lists the seven checks done by hand in real Excel/Chrome.

## Other folders

- `seed/` — files copied from the original prototypes (solver model, CP-SAT model, measure tool, name lists); reference only.
- `tools/make_*.mjs` — seeded generators for the invented fixtures; `tools/answers.mjs` makes the layout-only columns the page never reads; `tools/renames.json` holds the owner's renames of invented names.
