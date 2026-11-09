# Interim Draft Assistant: December demo

Status: draft for the owner's review, 2026-11-09. This replaces the larger office-product design for now. The office trial comes after Catalyst and is a separate decision.

## Goal

A 5-minute live demo for the Catalyst final presentation (assumed week of 7 December 2026). It runs on the owner's laptop, on an invented school. It is an MVP, not a production site, and it has only ever seen invented data.

Demo story: drop six invented spreadsheets, press Build, see what needs a person, open any teacher's one-line reason, move a teacher the audience picks, Undo, flip names on and off, reload to show it was remembered, download Excel and find the change there.

## Hard rules for the build

- Invented data only. Never open `~/interim-private`, the Stable-Sponsors repository's `config/pseudonymize.yaml`, or any real file. No real-year figure goes in code, tests, slides or script.
- New private repository `interim-draft-assistant`, worked on from a separate Mac user that cannot read the private folder (the owner confirms this before the first run). Deny rules for the private folder and config are added before the first commit. Inside that user, node, npm, the check command and git in the repo are pre-approved before the first run. Permission checks are never switched off.
- Before the first run the owner, from their own account, copies the named files into `/Users/Shared/interim-seed/` and makes them readable. The agent's user takes files only from there. No folder permissions on the owner's account are widened.
- No check that already exists may be loosened without the owner's yes. Removing a check, or the part of one, that tests only a feature cut under the cut order is not loosening; note it in the final report. "Done" means the pasted output of `npm run check`.
- Stop any step at 1.5 times its hours and use the cut order below.
- Screen fixes follow one rule: rename or remove, never add a sentence.

## Stack

Plain JavaScript extending the approved mock, bundled with esbuild, served from `127.0.0.1` on a fixed port. No React, TypeScript, Worker or server code other than a static file server on `127.0.0.1`. Libraries pinned exactly: `highs` 1.15.4 (solver), `hucre` 1.3.0 behind one adapter file (read and write Excel; `write-excel-file` 4.1.1 is the fallback writer). The first element in `<head>` is a meta Content-Security-Policy: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'`. No inline scripts and no outside links. Tests: `node:test` for logic, Playwright for about 20 on-screen checks. The first job is installing Playwright and its browser.

Reused from `.superpowers/prototypes/` in the Stable-Sponsors folder, copying only named files: `mocks/flow.html`, `mocks/mock-lib.js`, `mocks/measure.cjs`, `s5-probe/scripts/stack.cjs` (the solver model), `s5-probe/scripts/stack_cpsat.py` (the separate solver), and the invented name lists in `mocks/make_sample.py`.

Never copy `sample-data.js` or `samples.js`, because their counts copy a real year, and don't copy `forms-lib.js`. Change `mock-lib.js` to `Mock.init(data)`, called after upload or after loading from IndexedDB. Delete the mock's routes `folder`, `forms`, `sample`, `problems`, `checks`, `how`, `summary` and `redo`; the new Start screen replaces the upload ones. Remove `gender`, `mixed` and `stay` from the copied `stack.cjs`, leaving exactly the three priorities below.

## The invented school

A new generator writes the six files from a fixed seed: Fernhollow Academy, 96 teachers, 40 courses (34 offered), about 20 returning sponsors, about 6 others with no form, one course needing a Scuba certificate, all emails on `fernhollow.example`. Do not reuse the prototypes' `typical` year profile, because its counts copy a real year. The sample must produce a To do list of 3 to 14 items that includes a short course, people with a form not placed, and the no-form group. The Scuba course has a returning sponsor and too few certified teachers who ranked it, and no one in the no-form group holds Scuba; this is the short course the demo shows, because any uncertified short course would be filled from the no-form group first. The sample also includes one returning sponsor whose course is not offered.

Before the expected results are written, and with all AI sessions closed, the owner checks every invented person and course name against the real lists and renames any match. The agent never sees the comparison, only the new names. The expected results (placed, courses running, each priority's value) are then computed once by a copy of `stack_cpsat.py` in `tools/`, a separate solver with the gender, mixed and stay parts removed, and committed as JSON. Python and OR-Tools are used for this one step only.

## The six files

Each is `.xlsx`, first sheet named `Fernhollow`, headers in row 1, exact wording. The file name picks the slot. That sheet name and the email domain guard against the owner's own mistake and are never described as security.

| File             | Columns                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `courses.xlsx`   | Course Code, Course Name, Type (International or Singapore), Seats, Offered (Yes or No), Certificate (blank means none) |
| `staff.xlsx`     | Email, Name, Certificates (separated by `;`)                                                                            |
| `returning.xlsx` | Email, Course Code                                                                                                      |
| `round1.xlsx`    | Email, Choice 1 to Choice 7 (course names)                                                                              |
| `round2.xlsx`    | Email, Choice 1 to Choice 3 (course names)                                                                              |
| `singapore.xlsx` | Email, Choice 1 to Choice 5 (course names)                                                                              |

No gender and no comment columns. A file that doesn't fit is refused with one plain line (file, row, problem), and all six must pass before Build unlocks. Any email outside `fernhollow.example` refuses that file.

T numbers are created once at upload with a secure random source, then stored. Solver input is ordered by normalised email and by course code, never by T number, so the same files give the same draft.

## The draft

`Build` runs the solver on the page; each priority is solved and pinned before the next.

Rules never broken: one course each; returning sponsors stay on their course (before calling `build`, clear `repeater` and `incumbent` for any returning sponsor whose course has Offered = No, so they are treated like any other teacher); teachers who sent a form only get courses they ranked; certificates; a course's seats are both its minimum and maximum, except that a course with a returning sponsor may run short.

Priorities: (1) fewest empty seats on courses with a returning sponsor; (2) highest preference score (7 down to 1 for choice number, plus 20 for Round 1, 10 for Round 2, 0 for Singapore, taking the best of each where a course was ranked twice); (3) fewest people who sent no form.

About 40 lines of plain code then re-check every rule. On failure the page shows one fixed message. The page says "best draft found", never "proven", "optimal" or "secure".

## Screens

The inline `<style>` block from `flow.html` moves as is to `style.css`; the only additions are rules for the drop zone. The glanceable limits are unchanged: first screen at most 80 words, of which at most 30 sit outside `data-rows`, one big line of at least 26 px, nothing under 15 px.

- **Start:** one drop zone, the words "Invented school", at most 80 words.
- **Tabs:** To do (opens first, one item at a time), Teachers, Courses. The big line says how many To do items are left.
- **To do items:** short or empty offered courses; people with a form not placed; one single group item for everyone with no form who isn't placed, with "Leave them unplaced".
- **Top bar:** the words "Invented school", Show names (off at start) and Download. **Bottom line:** "Saved in this browser", Undo.
- **Editing:** Move to (including Not placed), Move here on short courses, Leave unplaced, Undo. A move that breaks a rule shows a warning and stands.
- **Reason per teacher:** recomputed from the current draft, at most 20 words, names no other teacher. A moved teacher shows only "Moved by the office" and their choice. A running course with a free seat gets its own sentence, not "too few sponsors to run".
- **History:** a plain list with Restore, which writes a new version. Start over wipes everything.

Remove from the mock, with a search-based check that the words are gone: Open folder, Open your work folder, Change folder, Sample school, Draft summary, How this draft was made, Worth a check, Keep, Kept, Redo the rest, Swap, Reviewed, mixed, gender, proven, optimal, secure. The check searches, case-insensitively and as whole words, the visible text and `title`, `aria-label`, `placeholder` and `value` attributes on every screen, plus every workbook string, and not library or source code. Also delete the mixed-pair flag, the comment display and the mock's fake pause, and make `move()` stop marking people as kept.

Playwright does the real upload and reaches each screen, then evaluates the `INSPECT` script copied unchanged from `measure.cjs` and applies its `BUDGETS`. Any `overBudget` entry fails `npm run check`. Start and To do use `first`, Teachers and Courses use `list`, an open reason uses `detail`. The SHA-256 of the `BUDGETS` and `INSPECT` text is recorded at first commit and checked on every run.

## Saving

IndexedDB, loaded before page code starts: one record of the parsed upload (with names), one snapshot of the Build result, then one snapshot per edit. A snapshot holds who is placed where, who was moved by hand, who was left unplaced, and history entries as T numbers and course codes only. Words are built when shown or exported, so history follows the names switch. Reload shows the same draft with no re-upload.

## Download

One `.xlsx` that follows the switch, built from the current draft, plain values, strings always as text, named with "invented". Sheets: Courses (Course Code, Course Name, Sponsor 1..n, Status), Teachers (Teacher, Email, Course, Choice, Why, Status; with names off, Teacher is the T number and there is no Email column), Changes (dated, one row per edit). With names off, a Note sheet says T numbers are pseudonymous, not anonymous.

## Done means

- Build's placed count, courses and each priority's value equal the generator's expected values. One deliberately broken draft per rule is rejected.
- The same files, rows shuffled, with different T numbers, give the same draft person by person.
- Every reason is at most 20 words. Before and after a set of moves, a test recomputes from the draft alone each claim made (choice number and round, and whether each named course is full, not running, has a free seat or needs a missing certificate) and compares it with the reason's stated facts.
- With names off, no invented name or email is displayed or anywhere in the page's DOM, including attributes and input values, in the history list, or in the raw contents of the workbook, including after names on, move, names off.
- Ten edits survive force-quitting Chrome. Reload needs no re-upload.
- Zero outside requests over a full run with the network on. A test fetch and a test image to another address from the running page are both refused by the policy.
- `measure.cjs` and the forbidden-words check pass. Browser checks pass 5 runs in a row, with no fixed waits.
- By hand, in an activated copy of Excel: the invented workbook opens with no repair prompt, and a cell can be edited and saved. On the presenting user, view-only is enough.

## Calendar

| By         | Done                                                                                                | Agent h | Owner h |
| ---------- | --------------------------------------------------------------------------------------------------- | ------- | ------- |
| Wed 11 Nov | Office asked; separate Mac user; repo; mock running on localhost on a stub of ten invented teachers | 1       | 5       |
| Sun 15 Nov | Real draft on the approved page                                                                     | 5       | 2.5     |
| Wed 18 Nov | Real upload and real Excel                                                                          | 6       | 3       |
| Thu 19 Nov | Edits, Undo, History, saving                                                                        | 5       | 2       |
| Fri 20 Nov | Freeze everything visible; record; send the pack to the office                                      | 2       | 8       |
| Sun 6 Dec  | Invisible fixes until Mon 30 Nov; three timed rehearsals                                            | 3       | 12      |

Hours are estimates. **If late, drop in this order:** the History list (Undo and the Changes sheet stay); the Courses tab; Move here; detailed bad-file messages. Then stop cutting. If the core isn't working by 30 Nov, show the real parts live and, for the rest, the mock running on data from the new generator, said aloud as a design; never the prototypes' own sample data. **Optional, only on the owner's yes before Thu 19 Nov:** Redo the rest, 1 to 2 agent hours, and take it off the removed-words list.

## Office review and honest claims

The talk is a presentation under the office's terms, so the office reviews the pack, and silence is not approval. Ask by Wed 11 Nov, send on Fri 20 Nov, reply wanted by Wed 2 Dec. Building never waits. If there is no reply by Fri 4 Dec, ask Catalyst for a later slot; failing that, present only the general matching problem and method, with nothing from the office.

The pack states what is modelled on the real programme: rounds, Singapore courses, sheet layout, scoring and rules. On stage: "invented people and preferences, in a programme shaped like ours."

Present and record from the separate Mac user, with a one-click local server on a fixed port. Don't sign Excel into a school account there. Run the zero-requests check with the network on and show that result. Wi-Fi off only stops notifications.

Say: "This page is blocked from sending anything. Once you download the Excel file, that no longer covers it." Say: "This switch changes what you see. The names are still in this browser, unencrypted." Closing slide, not built: real form layouts, protected storage of names, any run on real data. Also: this build has never run on real data, so its drafts have not been compared with what the office placed; the office hasn't used it; T numbers are pseudonymous, not anonymous; the placed count is a property of invented data, not a result.
