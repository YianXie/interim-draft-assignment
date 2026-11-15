# Fit file: design

Status: draft for the owner's review, 2026-11-15. Nothing built.

## Why

The Interim Office says a teacher's written answers (experience, skills, languages) matter as much to them as the ranked choices and certificates, which are all the draft uses today. The owner and the office agreed on "AI reads, office confirms, solver decides": a local model reads the answers, the office corrects what it found, and the page uses the corrected result. The owner chose how strongly it counts: a tie-break only.

## Goals

- A reader, run outside the page on a machine with a local model, turns the written answers in `round1.xlsx` and `singapore.xlsx` into `fit.xlsx`: one row per fact, tied to a course where the teacher tied it to one.
- The office checks and corrects `fit.xlsx` in Excel, then adds it on Start as an optional file.
- Among drafts that are equal on every existing priority, the page picks one that puts more teachers on a course they showed fit for, and otherwise moves as few people as possible.
- Each teacher's panel and the download show what was found.

## Not in this version

- Co-sponsor preferences (the Notable Priorities answer). The owner is still asking the office how they use them today.
- Facts with no course ("speaks Mandarin") changing the draft. Courses have no list of what helps, so these are shown only.
- A limitation ("afraid of heights") changing the draft. Shown only; the office decides.
- A screen in the page for confirming the reader's rows. Confirming happens in Excel.
- The final comments answers. Nothing is read from them.
- New kinds of To do item.

## Must not happen

- With no `fit.xlsx` added, anything behaves differently from today. Every existing check passes unchanged, and none is edited. `fixtures/expected.json` (`[1, 1654, 5]`) is unchanged.
- A fit row changes any earlier priority's value: short seats, last year's owed, the preference score, no-form placed. Each is pinned before the fit stage runs.
- A teacher's quote, or the reader's label for a fact, appears on screen, in the page, or in the download with names off. Quotes are the teacher's own words and can contain someone's name.
- The page sends anything anywhere. The reader is not part of the page and the page never calls a model.
- The reader puts a fact in `fit.xlsx` whose quote is not word for word in that teacher's answer.

## Constraints

- Everything in `docs/spec.md` still holds: invented data only, word and size budgets (`seed/measure.cjs`: a detail panel is at most 60 words), the forbidden-words check, the zero-outside-requests check, the names-off checks.
- The visible screens freeze on Fri 20 Nov for the demo. Work happens on a branch; when it merges is the owner's call.
- The model is not yet reliable: on 13 Nov `qwen3.5:9b` got about 14 of 20 invented answers fully right with each of three prompts (`tools/reader-test`). It invented nothing but missed facts. The design assumes misses, which is why the office confirms and why the full answers travel with the rows.

## Approaches

**How strongly a fit counts** (the owner chose)

| Option | Trade-off |
|---|---|
| **Tie-break, the last priority (chosen)** | Never costs any earlier priority anything; a wrong row costs little. Moves few people. |
| Above the preference score | Strong, but a mis-read row would change who gets their 1st choice. |
| Show only | Safest, but the draft ignores the answers. |

**How the rows reach the page** (the owner chose)

| Option | Trade-off |
|---|---|
| **`fit.xlsx`, confirmed in Excel, added on Start (chosen)** | Reuses the file checks and the optional-file pattern of last year's four; no new screen; the page stays offline. Confirming is in a spreadsheet. |
| Confirm on a new screen in the page | Nicer for the office; a whole new screen with its own budgets, and it cannot land before the freeze. |
| Extra columns in `staff.xlsx` | One row per teacher cannot hold several facts on several courses, and it breaks a fixed layout. |

**Where the tie-break sits** (my call, from a measurement)

On the invented school, with made-up fits on 15%, 30% and 50% of each teacher's ranked courses (three random sets each):

| Placement | Preference score | No-form placed | Teachers on a course they fit |
|---|---|---|---|
| After the score, before no-form | unchanged | one more in 4 of 9 runs | 0 to 7 more |
| **Last (chosen)** | unchanged | unchanged | 0 to 7 more |

**Moving as few people as possible** (my call, from the same measurement)

Adding any priority makes the solver pick a different one of the many equally good drafts, so 8 to 20 people moved even when no one gained a fit. A final step that keeps as many placements as possible from the draft built without `fit.xlsx` cut that to 0 when nothing was gained, and to 6 to 15 when 2 to 7 fits were gained (a fit usually needs a short chain of swaps to keep the score equal). It added about 0.2 seconds.

## The reader

A Node script, `tools/reader.mjs`, run by hand on the machine where Ollama is running. Node rather than Python so it can reuse `src/import.js` and `src/xlsx.js` (my call).

- **In:** the six files (it needs the forms for the answers and choices, `courses.xlsx` for names and codes, `staff.xlsx` to check emails). It refuses them as the page would.
- **What it reads:** "Enhancing Learning or Safety" in `round1.xlsx` and in `singapore.xlsx`. A teacher on both gets both answers read, each with the courses ranked on that form. Round 2 has no answers.
- **The model:** Ollama's chat API, temperature 0, fixed seed, thinking off. Address (default `http://127.0.0.1:11434`), model name and prompt file are settings, so moving to another machine or model changes no code. Starting prompt: `tools/reader-test/prompt_v3.txt`.
- **Checks on every reply:** strip a code fence; the reply must parse; each quote must be word for word in that answer; each course must be one this teacher ranked on that form. A row that fails is dropped and counted. A reply that cannot be read is retried once, then the teacher is listed as not read.
- **Out:** `fit.xlsx`, and a short summary in the terminal (teachers read, rows written, rows dropped, teachers not read).

## `fit.xlsx`

First sheet `Fernhollow`, headers in row 1, as the six.

| Column | Holds |
|---|---|
| Email | the teacher, on `fernhollow.example` and on `staff.xlsx` |
| Course Code | the course the teacher tied the fact to, or blank for a general fact |
| Kind | Language, Certificate, Experience, Skill, or Limitation |
| Fact | the reader's short label, for example "Level 2 climbing" |
| Quote | the teacher's exact words; blank on a row the office added |

A second sheet, `Answers` (Email, Form, Answer), holds every answer read, so the office can spot what the reader missed and add a row. The page never reads it.

The office deletes wrong rows, fixes Course Code or Kind, and adds missed facts with Quote blank.

## On Start

`fit.xlsx` is an optional file on the This year tab, after the six, with a one-line description ("What the reader found in the written answers, checked by the office"). Build does not wait for it. Before it is added it shows as a placeholder in the same way as last year's files (`data-placeholder`), not as a seventh row, so the existing Start checks that count six rows and six "file not added" pass unchanged (my call). A file that doesn't fit is refused with one plain line (file, row, problem), as the six are: wrong sheet or headers, an email not on staff, a course code not in `courses.xlsx`, a Kind not in the five, an empty Fact. Start must stay inside its word budget; how is the builder's call.

## In the draft

A **fit** is a teacher and a course where the teacher has at least one row on that course whose Kind is not Limitation. A fit counts on any placement the rules already allow (my call). For a teacher who sent a form that means only courses they ranked, so a fit on an unranked course changes nothing. For a teacher with no form it can be any running course whose certificate they hold, so an office-added row can steer where a no-form teacher fills a seat. It never places more no-form teachers, because that priority is pinned first.

When `fit.xlsx` was added, Build:

1. Builds the draft exactly as today, with last year's priority if those files were added. Call it the plain draft.
2. Adds one priority after every existing one, whichever exist: most teachers on a course they fit.
3. Adds a last one: most teachers on the same course as in the plain draft.

Returning sponsors stay fixed as today. The same files give the same draft, because the plain draft does. `recheck.js` is unchanged: fit adds no rules. `tools/expected.py` gains the fit stage, so the fit value is computed independently. It does not compute the keep value (my call): there are many equally good plain drafts, the two solvers find different ones, and neither is wrong. The keep stage is checked by its own rule instead: the keep value equals the plain draft's placed count minus the teachers moved, and no earlier value changes.

## On screen

- **Teacher panel:** one extra line, like the Last year line, only when `fit.xlsx` was added and the teacher has rows. Names on: the Fact labels for the course they are on, then "N more in the download" if there are others. Names off: the Kinds for that course only ("From their form: Experience, Certificate"). No quote on screen in either case, to stay within the panel's 60 words.
- **The reason** is unchanged. A fit is a tie-break, not why someone is where they are, and the reason's facts-only checks stay as they are.
- **Teachers list search** finds a teacher by Fact with names on.
- Limitation rows show on the same line, marked as such, for the course they are on.

## In the download

- **Teachers sheet:** one column, "From their form", when `fit.xlsx` was added. Names on: every row for that teacher as "Fact (Course Code): quote". Names off: Kinds and course codes only.
- No new sheet; the office already has `fit.xlsx`.

## Saving

The fit rows are kept in the saved upload record, as last year's results are. Snapshots are unchanged.

## Test data

`tools/answers.mjs` already writes the invented answers and knows which skill it gave each teacher for which course. A new `tools/make_fit.mjs` writes `fixtures/fit/fit.xlsx` from that, deterministically, with no model involved, plus a few rows the office might add or get wrong (a general fact, a limitation, a fit on an unranked course). It lives in its own folder because `scripts/build.mjs` copies `fixtures/school/` into the sample. Use sample data and the sample download stay the six files (the owner's choice, 2026-11-15); in the demo the owner adds `fit.xlsx` on Start by hand, as the office would. Expected values for the fit build go in their own JSON file, with two cases: the six plus `fit.xlsx`, and the six plus last year's four plus `fit.xlsx` (my call; `expected.py` gains a `--fit` option alongside `--past`). The model's own output is tested only by `tools/reader-test`, by hand.

## Done means

- With `fit.xlsx`: the first values equal today's expected values; the fit value equals `tools/expected.py`'s; the keep value equals placed minus moved; the number of teachers moved from the plain draft is reported by the test. The same with last year's four added.
- Each refusal above gives its one line.
- With names off, no quote and no Fact appears in the DOM or the workbook, including after names on, move, names off.
- The reader, run on the invented school against a local model, writes a `fit.xlsx` the page accepts, and drops any row whose quote is not in the answer (tested with a stubbed model reply).
- `npm run check` passes.

## Left to the builder

- How the reader and the page share the form-reading code.
- Exact words on Start and the panel, within the budgets.
- How the plain draft's pins are reused when the fit and keep stages are added.
