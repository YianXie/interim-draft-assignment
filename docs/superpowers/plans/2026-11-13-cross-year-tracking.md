# Cross-Year Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office drops four optional past-year files next to the six; the page works out each teacher's result last year, gives those who got none of their choices a top-4 choice first, and shows last year on the card and in the download.

**Architecture:** A new pure module (`src/past.js`) turns last year's allocation and forms into one result per current teacher. `src/import.js` reads the four past files and attaches the results to the School. `src/solver.js` gains one stage between "short seats" and "preference score", present only when past files were read. `src/state.js`, `src/export.js` and `src/app.js` show the result. With no past files, every code path and every output is byte-for-byte today's.

**Tech Stack:** Plain JavaScript (ES modules), esbuild, `highs` 1.15.4, `hucre` 1.3.0 behind `src/xlsx.js`, `node:test`, Playwright. Python + OR-Tools via `uv` for the separate solver only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-cross-year-tracking-design.md` (read it first; `docs/spec.md` is the parent spec and its hard rules still hold).

## Global Constraints

- Branch `cross-year-tracking`. Never commit to `main`. Never push.
- Run everything with `export PATH=/opt/homebrew/bin:$PATH` first (Node 24 or newer).
- **No existing file under `tests/` is edited.** New checks go in new files. `fixtures/school/*` and `fixtures/expected.json` stay byte-identical (`git diff --stat main -- fixtures/school fixtures/expected.json tests/` must list only new files).
- `public/index.html`, `public/style.css`, `tests/e2e/measure-source.mjs`, `tests/e2e/lock.json`, `src/recheck.js`, `src/store.js`, `src/xlsx.js` are not changed.
- With no past files: a School has no `past` key, a teacher has no `lastYear` key, `solveDraft` returns three values, the workbook has today's sheets and columns.
- Invented data only. No new invented person or course names. The one unmatched sponsor entry is the literal label `Sponsor who left`.
- No name or email in any refusal line (file, row and problem only).
- Screen words: none of `tests/e2e/words.mjs` `FORBIDDEN`; budgets `first`, `list`, `detail` in `tests/e2e/measure-source.mjs` hold on every new or changed screen.
- A reason (`Mock.reason`) is never changed and never mentions last year.
- Solver input order stays by normalised email and course code, never by T number.
- "Done" for the branch is the pasted output of `npm run check` ending `CHECK OK`.

## Review Focus

1. **Sponsor cells that are not tidy:** blank cells between sponsors, a course row with no sponsors, a name in different case or with doubled spaces. Expected: blanks skipped, the row accepted, the name still matched. (Task 1 and Task 2 tests.)
2. **A course listed on more than one past form:** Expected: the rank from the earliest of Round 1, Round 2, Singapore that lists it, same as the card shows this year. (Task 1 test.)
3. **Past files arriving in a separate drop, or a corrected `past-allocation.xlsx` dropped again:** Expected: order does not matter and the later file replaces the earlier. (Task 6 browser test.)
4. **Reload after Build with past files:** Expected: the last-year line and the download column survive, with no re-upload. (Task 6 browser test.)
5. **Hand moves after Build:** Expected: the "Last year" sheet's this-year column follows the draft as it stands, and Undo puts it back. (Task 5 test.)

## File Structure

| File | Responsibility |
|---|---|
| `src/past.js` (new) | Names of the four past slots; pure `lastYearResults`; labels for a result. No xlsx, no DOM. |
| `src/import.js` | Reads and validates the four past files; attaches `school.past` and `teacher.lastYear`. |
| `src/solver.js` | The extra stage when `school.past` exists. |
| `src/state.js` | `Mock.past`, `Mock.lastYear`, `Mock.lastYearLine`, `Mock.thisYear`. |
| `src/export.js` | "Last year" column and sheet when `Mock.past()` is set. |
| `src/app.js` | Past rows on Start, the card line, the search text. |
| `tools/make_past.mjs` (new) | Writes `fixtures/past/*.xlsx` from its own seed. |
| `tools/expected.py` | `--past` flag: same model plus the stage, writes `fixtures/expected-past.json`. |
| `tests/unit/past-fixture.mjs` (new) | Helper: the ten fixture files parsed into a School. |
| `tests/unit/*.test.mjs`, `tests/e2e/past.spec.mjs`, `tests/e2e/past-helpers.mjs` (new) | New checks only. |

## Shared shapes (every task uses these names)

```js
// src/past.js
export const PAST_SLOTS = ["past-allocation.xlsx", "past-round1.xlsx", "past-round2.xlsx", "past-singapore.xlsx"];
export const PAST_FORMS = { "past-round1.xlsx": "Round 1", "past-round2.xlsx": "Round 2", "past-singapore.xlsx": "Singapore" };
// result is one of: "top4" | "5to7" | "none" | "notFound" | "noForm"
// teacher.lastYear = { result, rank, round } | null     (rank and round are null unless result is top4 or 5to7)
// school.past = { unmatched: string[] }                 (sponsor entries that matched nobody or two people, as written, trimmed)
export const RESULT_LABEL = { top4: "Top 4", "5to7": "5 to 7", none: "None", notFound: "Not found", noForm: "No form" };
```

"Displayed rank" everywhere means: the rank on the earliest of Round 1, Round 2, Singapore that lists the course. (This equals the highest-scoring listing, because 8 − rank + bonus never ties across rounds.) Top 4 is displayed rank 1 to 4; 5 to 7 is displayed rank 5 to 7.

---

### Task 1: Last year's result, as a pure function

**Files:**
- Create: `src/past.js`
- Test: `tests/unit/past.test.mjs`

**Interfaces:**
- Produces: `PAST_SLOTS`, `PAST_FORMS`, `RESULT_LABEL` as above, and

```js
// allocation: [{ course: string, sponsors: string[] }]        course = Course Name, sponsors as written
// forms: [{ email: string, course: string, rank: number, round: "Round 1"|"Round 2"|"Singapore" }]
// staff: [{ email: string, name: string }]                     this year's staff
// sent: string[]   every email with a row on any past form, even one with no choice filled in (optional, default [])
// returns { byEmail: Map<email, {result, rank, round}>, unmatched: string[] }
export function lastYearResults({ allocation, forms, staff, sent })
export const normName = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
```

`byEmail` has an entry only for staff who appear in a past form or matched a sponsor entry. "Sent a form" means the email is in `sent` or has at least one listing, the same as this year's reader, which counts a form row with every choice blank as sent.

- [ ] **Step 1: Write the failing tests** in `tests/unit/past.test.mjs`, on a made-up list inside the test (people `a@`, `b@` … on `fernhollow.example`, names `Pat One`, `Pat Two`, …; courses `C1`…`C4`). One test per line:

```js
test("placed on a 1st to 4th choice is top4, with rank and round")        // rank 4, Round 1 -> { result: "top4", rank: 4, round: "Round 1" }
test("placed on a 5th to 7th choice is 5to7")                              // rank 5 Singapore -> "5to7"; rank 7 Round 1 -> "5to7"
test("sent a form, placed on a course not on it, is none")                 // { result: "none", rank: null, round: null }
test("sent a form, not on the allocation, is notFound")
test("placed with no form is noForm")
test("in no past file has no entry")                                       // byEmail.has(email) === false
test("a course on two forms takes the rank from Round 1, then Round 2, then Singapore")
   // C1 ranked 6th in Round 1 and 2nd in Round 2 -> { result: "5to7", rank: 6, round: "Round 1" }
   // C1 ranked 3rd in Round 2 and 1st in Singapore -> { result: "top4", rank: 3, round: "Round 2" }
test("names match ignoring case and extra spaces")                         // "  pat   ONE " matches "Pat One"
test("a sponsor entry that matches nobody is unmatched, as written")       // unmatched deep-equals ["Sponsor who left"]
test("a name shared by two staff matches neither")                         // both stay out of 'placed'; entry is in unmatched; one with a form is notFound
test("blank sponsor entries are skipped")                                  // sponsors ["", "Pat One", "  "] -> one match, unmatched []
test("past emails not on this year's staff are ignored")
```

- [ ] **Step 2: Run** `node --test tests/unit/past.test.mjs`. Expected: FAIL, cannot find `src/past.js`.
- [ ] **Step 3: Implement `src/past.js`.** Imports nothing. `unmatched` keeps file order.
- [ ] **Step 4: Run** `node --test tests/unit/past.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: work out last year's result per teacher`.

---

### Task 2: Read the four past files

**Files:**
- Modify: `src/import.js`
- Test: `tests/unit/import-past.test.mjs`

**Interfaces:**
- Consumes: Task 1's `PAST_SLOTS`, `PAST_FORMS`, `lastYearResults`.
- Produces: `parseFiles(files, random)` unchanged in signature. `import.js` re-exports `PAST_SLOTS`. When any past slot file is in `files`:
  - `slots` gains a line for each of the four (`"ready"`, `"<file>: file not added"`, or a refusal), and `school` is `null` unless all ten are ready;
  - `school.past = { unmatched }` and every teacher gets `lastYear` (`null` when `byEmail` has no entry), added as the last key.
  
  When no past slot file is in `files`, the return value is exactly today's.

Rules for the files (each refusal is one line, `file, row N: problem`, never containing a name, email or cell value):

| File | Accept | Refuse with |
|---|---|---|
| all four | first sheet `Fernhollow` | `first sheet must be named Fernhollow` |
| `past-allocation.xlsx` | headers `Course Code`, `Course Name`, then `Sponsor 1`, `Sponsor 2`, … with at least `Sponsor 1` and no gaps | `headers must be exactly: Course Code, Course Name, Sponsor 1, Sponsor 2, and so on` |
| | course code and name present and unique | `course code is empty`, `course code appears twice`, `course name is empty`, `course name appears twice` |
| | a sponsor entry (by `normName`) at most once in the file | `a sponsor appears twice in this file` |
| | blank sponsor cells anywhere; a row with no sponsors | — |
| past form files | headers exactly as `round1.xlsx`, `round2.xlsx`, `singapore.xlsx` | the existing headers line |
| | emails as today (`email()` helper: non-empty, on `fernhollow.example`, once per file) | the existing lines |
| | any course text; an email not on this year's staff | — |

- [ ] **Step 1: Write the failing tests** in `tests/unit/import-past.test.mjs`. Build past workbooks in the test with `writeBook`, using real staff rows read from `fixtures/school/staff.xlsx` and course names from `fixtures/school/courses.xlsx`; start from a small valid set (`validPast()` returning rows for the four files) and edit it per test:

```js
test("six files alone: no past key, no lastYear key, no past slot lines")   // Object.keys(school) and Object.keys(school.teachers[0]) equal today's; no PAST_SLOTS key in slots
test("ten good files: school.past and a lastYear on every teacher")          // every teacher has own property lastYear; at least one top4, one none, one null
test("one to three past files: the missing ones say file not added and school is null")
test("past-allocation headers: Sponsor columns may be any number, but not zero and not out of order")
test("each allocation refusal gives file and row")                           // one assert per refusal line in the table
test("a past choice not on any course list is accepted")
test("a past email not on this year's staff is accepted and ignored")
test("a past email outside fernhollow.example is refused with file and row")
test("no name, email or course text reaches a past problem line")            // same style as the existing import test
test("T numbers do not change which teacher gets which lastYear")            // two random sources; compare by email
test("unmatched keeps the entries as written and in file order")                // at least three unmatched entries, not in alphabetical order
test("a past form row with every choice blank still counts as a form")       // placed -> none; not on the allocation -> notFound
test("past emails match this year's staff whatever their letter case or stray spaces")
```

- [ ] **Step 2: Run** `node --test tests/unit/import-past.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement in `src/import.js`.** Keep `SLOTS` as is. A file named in `PAST_SLOTS` is not "not one of the six file names". The six are parsed and cross-checked exactly as today; the past files are read after `staff.xlsx` is known, and `lastYearResults` is called only when all ten are ready. Pass it lower-cased, trimmed emails (the existing `normEmail`), trimmed course names, the round labels from `PAST_FORMS`, ranks as column numbers 1 to 7, and `sent` = the email of every row on the three past form files.
- [ ] **Step 4: Run** `node --test tests/unit/`. Expected: all pass, including every existing test unchanged.
- [ ] **Step 5: Commit** `feat: read last year's four files`.

---

### Task 3: The new priority in the solver

**Files:**
- Modify: `src/solver.js`
- Test: `tests/unit/solver-past.test.mjs`

**Interfaces:**
- Consumes: `school.past`, `teacher.lastYear.result`.
- Produces: `solveDraft(highs, school)` returns `{ status, values, pairs }` with `values = [short, owedTop4, score, noForm]` when `school.past` exists, and today's three values otherwise. `toInstance(school)` gains `owed`: `null` without `school.past`, else the ids of teachers with `lastYear.result === "none"` (in the instance's teacher order).
- Also export `displayedRank(prefs, courseId)` → the rank on the earliest of Round 1, Round 2, Singapore listing that course, or `null`.

The stage: maximise the number of placed pairs `(t, c)` where `t` is in `owed`, `t` is not fixed to a course as a returning sponsor, and `displayedRank(t.prefs, c)` is 1 to 4. It sits second: after "fewest short seats", before "highest preference score", each pinned before the next as today. If the stage has no terms its value is `0` and it is skipped, as the existing loop already does.

- [ ] **Step 1: Write the failing tests** in `tests/unit/solver-past.test.mjs`, on hand-made School objects (no files), using a helper `mk({ teachers, courses, past })`:

```js
test("without school.past there are three values and owed is null")
test("with school.past there are four values, the second counting owed teachers on a top-4 choice")
test("the owed teacher wins the seat even when it lowers the preference score")
   // courses X and Y, one seat each, no returning sponsors. Both teachers send Round 1 only.
   // A ranks X 1st and Y 7th. B ranks X 2nd and Y 5th. B.lastYear.result === "none".
   // without school.past: A on X, B on Y, values [0, 50, 0]
   // with school.past:    B on X, A on Y, values [0, 1, 47, 0]
test("fewest short seats still comes first")
   // a returning-sponsor course that would go short if the owed teacher took their top-4 elsewhere: assert values[0] is unchanged from the no-past solve
test("5to7, notFound, noForm and null are not owed")
test("an owed returning sponsor is not counted")
test("displayedRank takes Round 1 before Round 2 before Singapore")           // 6th in Round 1 + 2nd in Round 2 -> 6
test("an owed teacher whose only top-4 listing is in Round 2 behind a 6th in Round 1 is not helped onto that course by the stage")
test("values[1] equals a recount from pairs")
test("the draft passes recheck")
```

- [ ] **Step 2: Run** `node --test tests/unit/solver-past.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement in `src/solver.js`.** Add `owed` to `toInstance` and one entry to `stages` in `build` when `inst.owed !== null`. Do not change `OPTIONS`, `WEIGHTS`, `BONUS`, the rows, or the order of existing variables.
- [ ] **Step 4: Run** `node --test tests/unit/`. Expected: all pass; `tests/unit/solver.test.mjs` unchanged and green.
- [ ] **Step 5: Commit** `feat: place those who got none last year on a top-4 choice first`.

---

### Task 4: The invented past year and its expected values

**Files:**
- Create: `tools/make_past.mjs`, `fixtures/past/past-allocation.xlsx`, `fixtures/past/past-round1.xlsx`, `fixtures/past/past-round2.xlsx`, `fixtures/past/past-singapore.xlsx`, `fixtures/expected-past.json`, `tests/unit/past-fixture.mjs`
- Modify: `tools/expected.py`, `package.json` (add one script; `check` and `fixtures` unchanged)
- Test: `tests/unit/fixtures-past.test.mjs`, `tests/unit/solver-past-fixture.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `npm run fixtures:past` = `node tools/make_past.mjs && uv run --no-project --isolated --with ortools --with openpyxl tools/expected.py --past`
  - `fixtures/expected-past.json`: `{ "values": [short, owedTop4, score, noForm], "placedMin", "placedMax", "runningMin", "runningMax", "owed": <count of owed teachers the stage can count> }`
  - `tests/unit/past-fixture.mjs`: `export async function readPastSchool(random)` → the School from the ten files; `export const pastFiles` → the four paths.

`tools/make_past.mjs`: reads `fixtures/school/*.xlsx` through `src/xlsx.js` only; its own `mulberry32` and seed `20261113`; writes sheet `Fernhollow`. It reuses this year's people and course names and adds no new names. It builds the allocation by a simple fill (walk people in seeded order, give each their best-listed course with a free seat), never with the solver. It must produce, and print counts for:

- about 8 current staff with no past record at all;
- at least 8 teachers with result `none` who sent a form this year and are not returning sponsors;
- at least 3 each of `top4`, `5to7`, `noForm`; at least 1 `notFound`;
- one allocation entry `Sponsor who left`;
- a course listed on two past forms by at least one person.

`tools/expected.py --past`: with the flag, also read `fixtures/past/*.xlsx`, work out who is owed with its own code (shares nothing with `src/`), insert the stage second, and write `fixtures/expected-past.json` instead of `fixtures/expected.json`. Without the flag it behaves exactly as today.

- [ ] **Step 1: Write the failing tests.**

`tests/unit/fixtures-past.test.mjs`:
```js
test("the four past files have sheet Fernhollow and the agreed headers")
test("all past emails are on fernhollow.example")
test("no gender or comment columns in the past files")
test("every past name and course name already exists in fixtures/school")      // except the literal "Sponsor who left"
test("the past year has every required case")                                   // the counts in the list above, from readPastSchool()
test("expected-past has four values and no spread")                             // keys exactly: owed, placedMax, placedMin, runningMax, runningMin, values
test("some owed teacher cannot be given a top-4 choice")                        // expected.values[1] < expected.owed
test("fixtures/school and expected.json are untouched")                         // expected.json still { values: [1, 1366, 3], ... } with 3 values
```

`tests/unit/solver-past-fixture.test.mjs`:
```js
test("values equal the separate solver")                                        // solveDraft(highs, pastSchool).values deepEqual expected-past values
test("placed and running equal the separate solver")
test("the draft passes the re-check")
test("the draft differs from the draft built without the past files")
test("same people, different T numbers, same draft")
test("rows shuffled, same draft")
```

- [ ] **Step 2: Run** `node --test tests/unit/`. Expected: the two new files FAIL (no fixtures).
- [ ] **Step 3: Write `tools/make_past.mjs` and the `--past` branch of `tools/expected.py`, add the script, run** `npm run fixtures:past`. If "some owed teacher cannot be given a top-4 choice" or "the draft differs" fails, change how the generator picks who gets `none` (prefer people whose 1st to 4th choices this year are the most-asked courses) or raise their number, and rerun. Do not touch `SEED` in `tools/make_school.mjs`.
- [ ] **Step 4: Verify nothing old moved.** Run `uv run --no-project --isolated --with ortools --with openpyxl tools/expected.py` then `git status --short fixtures/` — `fixtures/expected.json` and `fixtures/school/` must show no change. Run `node --test tests/unit/`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: invented past year and its expected values`.

---

### Task 4b: A believable invented past year (added during the build)

Task 4's fixture needed 47 of 88 people with result `none` to meet the case "some owed teacher cannot be given a top-4 choice". Ruling: that case is dropped (see the amended design); the past year is regenerated to look ordinary, with this year's returning sponsors on their course last year and 10 to 14 `none`. The full brief is `.superpowers/sdd/2026-11-13-cross-year-tracking/task-4b-brief.md`; its test changes replace the two Task 4 tests named there.

---

### Task 5: Last year in the state and the download

**Files:**
- Modify: `src/state.js`, `src/export.js`
- Test: `tests/unit/lastyear.test.mjs`, `tests/unit/export-past.test.mjs`

**Interfaces:**
- Consumes: `readPastSchool` (Task 4), `RESULT_LABEL` (Task 1). State's existing `choice(tid, cid)` already is the displayed listing, so use it for `thisYear`.
- Produces, on `Mock`:

```js
past()            // D.past || null
lastYear(tid)     // teacher.lastYear || null
lastYearLine(tid) // "" when Mock.past() is null or lastYear is null; else exactly one of:
                  //   `Last year: ${ord(rank)} choice`      (top4, 5to7)
                  //   "Last year: none of their choices"    (none)
                  //   "Last year: not on the allocation"    (notFound)
                  //   "Last year: no form"                  (noForm)
thisYear(tid)     // from the draft as it stands: "notPlaced" | "returning" | "noForm" | "top4" | "5to7" | "notRanked"
```

- Download, only when `mock.past()` is set:
  - Teachers sheet: a `Last year` column directly after `Choice`, holding `RESULT_LABEL[result]` or `""`.
  - A sheet `Last year` after `Changes` (before `Note`): row 1 `["Last year", "Top 4", "5 to 7", "Not on their list", "Returning sponsor", "No form", "Not placed"]`; then one row per `Top 4`, `5 to 7`, `None`, `Not found`, `No form`, `No record`, each cell the count of teachers as text.
  - With names on, the sheet continues after one blank row with `["Not matched on last year's allocation"]` and one row per `past().unmatched` entry, then a blank row, `["Sent a form last year, not on the allocation"]` and one row per such teacher's label. With names off, neither block is written.
  - All cells through `cleanCell`, as today.

- [ ] **Step 1: Write the failing tests.**

`tests/unit/lastyear.test.mjs`:
```js
test("without past files every lastYearLine is empty and past() is null")      // on readSchool()
test("each result gives its exact line")                                        // one teacher of each result from readPastSchool()
test("no lastYearLine is longer than 6 words")
test("thisYear follows the draft, a move, and Undo")                            // move an owed teacher to Not placed -> "notPlaced"; undo -> back
test("reasons are the same with and without past files for a teacher on the same course")
test("no reason mentions last year")                                            // !/last year/i for every teacher, before and after 20 moves
```

`tests/unit/export-past.test.mjs`:
```js
test("with past files the sheets are Courses, Teachers, Changes, Last year (and Note with names off)")
test("Teachers has Last year after Choice, with the label or blank")
test("the Last year table counts every teacher exactly once")                   // sum of the 6x6 cells equals school.teachers.length
test("the table follows a move and Undo")
test("names on: the two lists are written; names off: neither, and no unmatched entry anywhere in the workbook")
test("no invented name or email in any part of a names-off workbook with past files")   // raw zip parts, same method as the existing export test
test("forbidden words are in no workbook string with past files")
test("every cell is a string cell and there are no formulas")
```

- [ ] **Step 2: Run** `node --test tests/unit/lastyear.test.mjs tests/unit/export-past.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Do not touch `reason`, `teacherFlags`, `summary`, or the sort order in `teachersSheet`.
- [ ] **Step 4: Run** `node --test tests/unit/`. Expected: all pass; `tests/unit/export.test.mjs` and `tests/unit/reasons.test.mjs` unchanged and green.
- [ ] **Step 5: Commit** `feat: last year on the teacher and in the download`.

---

### Task 6: The page

**Files:**
- Modify: `src/app.js`
- Create: `tests/e2e/past-helpers.mjs`
- Test: `tests/e2e/past.spec.mjs`

**Interfaces:**
- Consumes: `PAST_SLOTS` from `src/import.js`; `Mock.past`, `Mock.lastYearLine`.
- Produces: `tests/e2e/past-helpers.mjs`: `tenFiles()` (the six plus the four paths), `dropTen(page)` (goes to `/`, sets all ten on the file input, waits for Build enabled).

Page changes, and nothing else:

1. `addFiles`: a file named in `PAST_SLOTS` is parsed together with the six, not as a stray.
2. Start rows: the six, then the past slots that have a line, then strays. A ready past row looks like a ready six row. When `parsed.past.unmatched.length` is `n > 0`, the `past-allocation.xlsx` row's right-hand text is `ready, ${n} not matched`. The big line stays `Drop the six files here`. The sample button is unchanged.
3. `teacherBody`: directly after the `Why` paragraph, when `Mock.lastYearLine(id)` is not empty: `<p class="q" data-last>${esc(line)}</p>`.
4. `teachersHome`: `data-q` also carries `Mock.lastYearLine(t.id)`.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/past.spec.mjs` (use `watchPage`, `buildDraft`, `measure`, `visibleStrings`, `dropFiles` from the existing `helpers.mjs` by import; no fixed waits):

```js
test("ten files build the expected draft")                                      // data-placed equals expected-past placedMin
test("three of the four past files keep Build locked and say which is missing")
test("past files can arrive in a second drop, and a re-dropped allocation replaces the old one")
test("the allocation row shows how many were not matched, as a number only")    // row text has "not matched"; DOM does not contain "Sponsor who left"
test("a teacher card shows its last-year line, and the reason is unchanged")    // [data-last] visible for a teacher with a result; .why text has no "last year"
test("an unplaced teacher's To do item shows the line too")                     // when such an item exists with a result; skip with a clear message if the fixture has none
test("search for 'none of their' lists only those teachers")                   // visible rows count equals the number of result none
test("Start with all ten ready fits first")
test("every To do item fits first with past files")                             // count taken from the tab label, not a constant
test("every open teacher card fits detail with past files")
test("Teachers fits list with past files")
test("with names off no name, email or unmatched entry is in the DOM on any screen")   // Start (ten ready), To do items, Teachers, each card, History, Courses
test("names on, move, names off, download: no name, email or unmatched entry in any raw XML part")
test("forbidden words are gone on every past screen")
test("reload shows the same draft and last-year lines with no re-upload")
test("six files alone: no [data-last] anywhere and the workbook has no Last year column or sheet")
test("a full run with ten files makes zero outside requests")                   // same method as tests/e2e/network.spec.mjs
```

- [ ] **Step 2: Run** `npm run build && npx playwright test tests/e2e/past.spec.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the four changes in `src/app.js`.**
- [ ] **Step 4: Run** `npm run build && npx playwright test tests/e2e/past.spec.mjs`. Expected: all pass. If a card is over the `detail` budget of 60 panel words, shorten the lines in `Mock.lastYearLine` (and Task 5's test literals) to `Last year: ${ord(rank)}`, `Last year: none`, `Last year: not found`, `Last year: no form`; change nothing else to fit.
- [ ] **Step 5: Run the whole check:** `npm run check`. Expected: ends `CHECK OK`.
- [ ] **Step 6: Commit** `feat: last year on Start, the teacher card and search`.

---

### Task 6b: The last-year line on the opened card only (added during the build)

Task 6 as built was one word or more over the `first` budget on To do items for unplaced teachers. Ruling: the line shows on an opened teacher card only (see the amended design). The brief is `.superpowers/sdd/2026-11-13-cross-year-tracking/task-6b-brief.md`.

---

### Task 7: Whole-branch verification

**Files:** none new. Fixes only, each with a test in the owning task's test file.

- [ ] **Step 1:** `git diff --stat main -- tests/ fixtures/school fixtures/expected.json public/ src/recheck.js src/store.js src/xlsx.js` lists only added files under `tests/` and nothing else.
- [ ] **Step 2:** `npm run check:final` (browser checks five times). Expected: `CHECK OK`.
- [ ] **Step 3:** Walk the Review Focus list and the spec's "Must not happen" list; for each, name the test that pins it. Add any that is missing.
- [ ] **Step 4:** Paste the final `npm run check` output in the report. Commit any fixes as `fix: …`.
