# Raw-file Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `node tools/convert.mjs --in <raw> --out <new>` turns the office's raw workbooks into the six files the page reads, with a report of what is still to fill.

**Architecture:** Pure functions in `tools/convert/` take raw sheets as row arrays and return the page's rows plus report lines; a thin CLI reads and writes folders through `src/xlsx.js` and finishes by running `parseFiles` on its own output.

**Tech Stack:** Node 24 ES modules, `node:test`, `src/xlsx.js` (hucre), `src/import.js`.

**Spec:** `docs/superpowers/specs/2026-11-22-convert-raw-design.md`

## Global Constraints

- Invented data only in code and tests; old domain in tests is `oldschool.example`. No real header text, real domain or real-year figure in the repo.
- Only `src/xlsx.js` imports hucre. No network. The page, its checks and `tests/e2e` are untouched; no existing check is loosened.
- Output headers are exactly `HEADERS[file]` from `src/import.js`; first sheet `Fernhollow`; emails `<local>@fernhollow.example`, lower case.
- The converter never guesses: anything it cannot settle is left blank or as written and gets a report line.
- Done = `npm run check` ending in `CHECK OK`.

## Review Focus

- A choice using a different dash (`–`, `-`, `—`) or extra spaces around it: still matched. (Task 1 test.)
- A sponsor name with a two-word last name ("Ana De Souza" → `adesouza` or `asouza`): matched if exactly one email fits. (Task 3 test.)
- Timestamps read back as Date objects, numbers or text: the latest still wins. (Task 2 test.)
- Two courses with the same bare name in different countries: choices with a country still resolve; the duplicate is reported. (Task 1 test.)
- A raw email with capitals or spaces (` WOxley@OldSchool.example `): becomes `woxley@fernhollow.example`. (Task 1 test.)

---

### Task 1: Matching helpers

**Files:** Create `tools/convert/match.mjs`; Test `tests/unit/convert-match.test.mjs`

**Interfaces — Produces:**
- `norm(s: any) => string` — trim, lower case, every dash (`—`, `–`, `-`) surrounded by optional spaces becomes ` - `, whitespace collapsed.
- `newEmail(raw: any) => string | null` — `local@fernhollow.example` from a trimmed, lower-cased address with exactly one `@` and a non-empty local part; else `null`.
- `courseIndex(courses: {name, country}[]) => { find(text) => course | null, duplicates: string[] }` — `find` tries `country - name`, then the bare name (only when unique), then the whole text as a bare name; `duplicates` lists bare names held by more than one course.
- `nameKeys(full: string) => string[]` — first letter of the first word + the last word, and first letter + all later words joined; letters only, lower case, distinct.
- `findColumn(head: any[], words: string[]) => number` — index of the first header whose `norm` contains every word; `-1` if none.

- [ ] **Step 1: Write failing tests** — `norm("Australia —  Great  Ocean Road") === norm("australia - great ocean road")`; `newEmail(" WOxley@OldSchool.example ") === "woxley@fernhollow.example"`; `newEmail("nobody") === null`; `newEmail("@oldschool.example") === null`; `courseIndex` with `{Great Ocean Road, Australia}`, `{River Walk, Tasland}`, `{River Walk, Moravia}`: `find("Australia – Great Ocean Road")` and `find("great ocean road")` give the first, `find("Moravia - River Walk")` the third, `find("River Walk")` is `null`, `duplicates` is `["River Walk"]`; `nameKeys("Ana De Souza")` deep-equals `["asouza", "adesouza"]`; `nameKeys("Wen Oxley")` deep-equals `["woxley"]`; `findColumn(["Timestamp ", "Email Address", "First Preference "], ["first", "preference"]) === 2`.
- [ ] **Step 2:** `node --test tests/unit/convert-match.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement `tools/convert/match.mjs`; imports nothing.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat: matching helpers for the raw-file converter`.

### Task 2: Courses, forms and returning

**Files:** Create `tools/convert/convert.mjs`; Test `tests/unit/convert.test.mjs`

**Interfaces — Consumes:** Task 1. **Produces:** `convert(raw: { [file]: any[][] }) => { files: { [file]: any[][] }, report: string[] }` where `raw` keys are `courses.xlsx`, `returning.xlsx`, `round1.xlsx`, `allocation.xlsx` and optional `round2.xlsx`, `singapore.xlsx` (each the first sheet's rows, header first), and `files` holds the page's files (header row first), `round2.xlsx`/`singapore.xlsx` only when given. Throws `Error` with a plain line when an expected column is missing or two addresses become one.

Column key words (all via `findColumn`): Timestamp `["timestamp"]`; Email `["email"]`; choice k `[ORDINAL[k], "preference"]` with ORDINAL `first..seventh`; Enhancing `["enhance"]`; Notable Priorities `["priorit"]`; Final Questions or Comments `["final"]`; Additional Comments or Questions `["additional"]`; Prior Course `["prior", "course"]`; courses Course Name `["course", "name"]`, Vendor `["vendor"]`, Arrival City `["city"]`, Country `["country"]`; allocation Trip Code `["code"]`, Course Name `["course", "name"]`, sponsors every header containing `"sponsor"`.

- [ ] **Step 1: Write failing tests** on an invented school built inline (3 International courses in two countries, 1 Singapore course with Country `Singapore`, an allocation with one course of 3 sponsors, one of 2 and one course absent):
  - courses rows equal `[code, name, type, seats, "Yes", "", country, city, vendor]`; code and seats come from the allocation (Course Name minus its leading Trip Code, matched with `find`); the absent course has code `""`, seats `2` and a report line naming it; the Singapore one has type `Singapore`.
  - round1: raw order Timestamp, Email, First, three answers, Second..Seventh becomes `HEADERS["round1.xlsx"]` order; `"Australia — Great Ocean Road"` is written `"Great Ocean Road"`; an unmatched choice stays as written with a report line holding file, row and text.
  - two round1 rows for one email (one Date, one later Date; and a case with a number vs number): only the later is kept, one report line names the dropped row.
  - returning: Prior Course copied to Course Code; a code not among this year's codes gives a report line.
  - two raw addresses `a.b@x.example` and `a.b@y.example` → throws.
- [ ] **Step 2:** `node --test tests/unit/convert.test.mjs` → FAIL.
- [ ] **Step 3:** Implement `convert` for these files (staff comes in Task 3; write `staff.xlsx` as header only for now). Row numbers in report lines are raw sheet rows (header = row 1).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: convert raw courses, forms and returning list`.

### Task 3: staff.xlsx

**Files:** Modify `tools/convert/convert.mjs`; Test `tests/unit/convert.test.mjs`

- [ ] **Step 1: Write failing tests:** `staff.xlsx` rows are every distinct new email from returning and the forms, sorted, as `[email, name, ""]`; sponsor "Wen Oxley" names `woxley@…`; "Ana De Souza" names `adesouza@…`; two sponsors with key `jsmith` leave `jsmith@…` blank with a report line; an email with no sponsor match is blank with a report line; a sponsor matching no email gets a report line ("on the allocation, no email found").
- [ ] **Step 2:** FAIL. **Step 3:** Implement with `nameKeys`. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: staff list from form emails and allocation names`.

### Task 4: CLI and end-to-end

**Files:** Create `tools/convert.mjs`; Modify `README.md` (one short section next to the reader's); Test `tests/unit/convert-cli.test.mjs`

**Interfaces — Consumes:** `convert`, `writeBook`/`readBook`, `parseFiles`, `SLOTS`.

- [ ] **Step 1: Write failing test:** write the invented raw files of Task 2 (with every course matched and every name found) to a temp dir under `os.tmpdir()`, run `node tools/convert.mjs --in <tmp>/raw --out <tmp>/out` with `execFile`; exit code 0; `parseFiles` on the six output files gives a School with the expected teacher count; `convert-report.txt` exists and ends with a line saying Start takes the files. A second run into the same `--out` exits non-zero and leaves files unchanged. A raw set with one unmatched choice still exits 0 and its report ends with the page's own refusal line.
- [ ] **Step 2:** FAIL. **Step 3:** Implement: usage line on missing flags; missing required raw file → one line, exit 1; `mkdir -p` out; each file written with one sheet `Fernhollow`; report printed and written. **Step 4:** PASS.
- [ ] **Step 5:** `npm run check` → ends `CHECK OK`.
- [ ] **Step 6:** Commit `feat: tools/convert.mjs turns raw files into the six`.
