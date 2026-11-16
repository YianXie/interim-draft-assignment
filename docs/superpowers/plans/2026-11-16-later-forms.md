# Later Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a built, edited draft, add `round2.xlsx` and/or `singapore.xlsx` and place people from them, keeping everyone already on a course where they are, even where that breaks a rule.

**Architecture:** `readForms` merges the later forms into the stored School (same shape, same T numbers). `solveDraft` gets a third argument, the kept pairs: kept teachers get no variables, courses lose the seats they hold, and courses with a kept sponsor count as running for stage 1. A new `newProblems` in `recheck.js` accepts a result only if it adds no broken rule. `Mock.addForms` swaps in the new School and writes one snapshot. The upload is replaced in IndexedDB without clearing snapshots.

**Tech Stack:** Plain JS (ES modules), esbuild, HiGHS WASM, IndexedDB, `node:test`, Playwright. Independent check in `tools/expected.py` (OR-Tools CP-SAT, via `uv`).

**Spec:** `docs/superpowers/specs/2026-11-16-later-forms-design.md` (read it first; decisions 1–4 there are the owner's).

## Global Constraints

- Work on branch `later-forms`. Do not merge; the screens freeze Fri 20 Nov and merging is the owner's call.
- No existing check is loosened or edited, except for counts that change only because of the new **Add forms** link. `fixtures/expected*.json` stays unchanged.
- Words on screen, exactly: link `Add forms`; card title `Add forms`; button `Add and place` / `Placing`; failure `Couldn't place anyone. Nothing changed.`; History line `Added Round 2 forms, placed 7`, `Added Singapore forms, placed 3`, `Added Round 2 and Singapore forms, placed 9`.
- Never use a word from `tests/e2e/words.mjs` (notably **Keep / Kept**) in anything visible or in the workbook. Write "stays" instead.
- `src/recheck.js` imports nothing. `src/import.js` imports no Node modules. `src/xlsx.js` stays the only `hucre` importer.
- The School's keys are unchanged (`tests/unit/import-past.test.mjs` asserts them).
- Done means `npm run check` ending in `CHECK OK`, then `npm run check:final`. Playwright starts its own server, so stop anything on port 4173 first (or ask the owner to).

## Review Focus

1. **A kept draft that breaks rules** (a course over its seats, a teacher without the certificate, someone on a course they did not list, a teacher on a not-offered course, a returning sponsor moved off): Add and place still works, nobody kept moves, and the same warnings still show. *Task 2 test `kept pairs that break rules are left alone`; Task 5 e2e.*
2. **`round2.xlsx` added twice**: the second file replaces Round 2's choices; nobody moves; no doubled choices. *Task 1 test `a round already in the school is replaced`.*
3. **A placed teacher whose later form lists other courses**: they stay, and their card now says "Not on their list". This must not count as a new problem. *Task 3 test `a kept teacher who is now NOT_RANKED is not a new problem`.*
4. **Reload and Undo after adding**: reload shows the new choices and placements with no re-upload; Undo puts the placements back and the new choices stay. *Task 4 test `undo after addForms restores placements, school stays`; Task 5 e2e.*
5. **Names off**: the card, the History line and the Changes sheet hold no name or email. *Task 5 e2e reuses `expectNoPeople` and `forbiddenIn`.*

---

### Task 1: Read later forms into a built School

**Files:**
- Modify: `src/import.js` (pull the per-form cross-check out of `parseFiles` into a shared helper; add `readForms`)
- Test: `tests/unit/later-forms.test.mjs` (new)

**Interfaces:**
- Produces: `export const LATER = ["round2.xlsx", "singapore.xlsx"]`
- Produces: `export async function readForms(school, files) -> { school: School | null, slots: { [name]: "ready" | string }, rounds: string[], senders: string[] }`. `files` is `[{ name, bytes }]`. `rounds` is in Round 2, Singapore order, only the rounds added. `senders` holds the T numbers of every teacher with a row in an added file, sorted. On any refusal, `school` is null. The input `school` is never mutated (`structuredClone`).

- [ ] **Step 1: Write the failing tests** in `tests/unit/later-forms.test.mjs`. Build `base` with `parseFiles` from the four needed fixture files (`fixtures/school`, without `round2.xlsx` and `singapore.xlsx`) and a fixed `seq()` random.
  - `adding both later forms gives the same choices as building with all six`: `readForms(base, [round2, singapore])` gives `school` where, for each teacher by email, `prefs` and `submitted` deep-equal those from `parseFiles` of all six; every `id` equals `base`'s; `rounds` deep-equals `["Round 2", "Singapore"]`.
  - `a round already in the school is replaced`: adding `round2.xlsx` twice in a row gives the same school as adding it once.
  - `submitted never goes back to false`: add a Round 2 file listing teacher A, then a Round 2 file without A; A stays `submitted: true`, and A has no `Round 2` prefs.
  - `checks match Start`: a `round2.xlsx` whose sheet is `Sheet1` gives slot `"round2.xlsx: first sheet must be named Fernhollow"` and `school: null`; an email not on staff gives `/^round2\.xlsx, row \d+: email is not on the staff list$/`; a choice not on the course list gives `/Choice 1 is not on the course list$/`.
  - `other names are refused`: `round1.xlsx` gives slot `"round1.xlsx: only round2.xlsx and singapore.xlsx can be added to a draft"` and `school: null`.
  - `no files gives no school`: `readForms(base, [])` gives `school: null` and `slots` `{}`.
  - `base is not changed`: after any call, `base` deep-equals a `structuredClone` taken before it.

- [ ] **Step 2: Run and see them fail**
  Run: `node --test tests/unit/later-forms.test.mjs`
  Expected: FAIL, `readForms` is not exported.

- [ ] **Step 3: Implement.** Move the form branch of the cross-file loop in `parseFiles` into `function checkForm(file, rows, onStaff, byName)` (throws `Refusal`) and call it from both places, so the messages stay identical. In `readForms`, use `table()` + `readEmailRows()` per file, with `onStaff` and `byName` built from `school.teachers` / `school.courses`; for each added round, drop that round's prefs from every teacher, then push the new ones exactly as `parseFiles` does (same `rank`, `round`, course id from the name).

- [ ] **Step 4: Run the new tests and the whole unit suite**
  Run: `node --test tests/unit/`
  Expected: all pass, including the unchanged `import.test.mjs` and `optional-forms.test.mjs`.

- [ ] **Step 5: Commit** `feat: readForms adds Round 2 or Singapore forms to a built school`

### Task 2: Solver keeps a draft and builds on it

**Files:**
- Modify: `src/solver.js` (`toInstance`, `build`, `solveDraft`)
- Test: `tests/unit/solver-later.test.mjs` (new)

**Interfaces:**
- Consumes: `readForms` (Task 1) to make the test school.
- Produces: `solveDraft(highs, school, keep = null) -> { status, values, pairs }`. `keep` is `[[tid, cid], …]` for every teacher on a course now. With `keep` null, the behaviour is exactly today's (all of `solver.test.mjs`, `solver-past*.test.mjs` and the fit tests pass unchanged). With `keep`, `pairs` holds **only the new placements**. `values` has the same shape as without `keep`.
- `toInstance(school, keep)` adds `kept: [{ t, c }]`, sorted by teacher email and then course code.

- [ ] **Step 1: Write the failing tests.** Build `base` from the four needed files, solve it, `keep = pairs`; `later = readForms(base, [round2, singapore]).school`.
  - `without keep nothing changes`: `solveDraft(highs, school)` deep-equals `solveDraft(highs, school, null)` for the six-file fixture school.
  - `kept sponsors stay and new pairs follow every rule`: `r = solveDraft(highs, later, keep)`; `r.status === "Optimal"`; no tid in `r.pairs` is in `keep`; `newProblems(later, keep, [...keep, ...r.pairs])` is `[]` (it depends on Task 3, so in this task assert `recheck(later, [...keep, ...r.pairs])` holds no code other than ones `recheck(later, keep)` already has, compared by `code + id`).
  - `courses with a kept sponsor are filled first`: for every offered course with kept sponsors fewer than its seats, the count after (kept + new) is the most the free teachers who qualify for it allow. Pin it as a value: `r.values[0]` equals the empty seats on running courses counted from `[...keep, ...r.pairs]`.
  - `kept pairs that break rules are left alone`: change `keep` so that one course holds seats + 1, one teacher sits on the Scuba course without Scuba, and one returning sponsor is moved to a course they did not list. `solveDraft` is still `Optimal`, adds nobody to the over-full course, and puts none of those teachers in `r.pairs`.
  - `an unplaced returning sponsor is treated like anyone`: take a returning sponsor out of `keep`, and they are not forced onto their course (`r.status === "Optimal"` even when their course is full of kept sponsors).
  - `same files, shuffled, different T numbers, same new placements by email` (mirror the existing shuffle test in `solver.test.mjs`).

- [ ] **Step 2: Run and see them fail**
  Run: `node --test tests/unit/solver-later.test.mjs`
  Expected: FAIL (the kept teachers get placed again or move).

- [ ] **Step 3: Implement in `build(inst)`** when `inst.kept` is set:
  - Kept teachers get no variables. With `keep`, nobody is forced: unplaced repeaters are not added to `forced` or `repeaterOn`.
  - `keptOn(c)` = number of kept pairs on course `c`. If `keptOn(c) >= seats`, no variables for `c`.
  - `lockedCourses` = offered courses with `keptOn(c) > 0`. For those, the rows become `here + keptOn + s >= seats` and `here <= seats - keptOn`.
  - Offered courses with `keptOn(c) === 0` keep the `y` all-or-nothing rows.
  - The score, no-form, owed and fit stages are unchanged; they range over the variables that exist.

- [ ] **Step 4: Run the whole unit suite**
  Run: `node --test tests/unit/`
  Expected: all pass, with the existing solver tests unchanged.

- [ ] **Step 5: Commit** `feat: solver builds on a kept draft`

### Task 3: Accept only results that add no broken rule

**Files:**
- Modify: `src/recheck.js`
- Test: `tests/unit/recheck.test.mjs` (add tests, change none)

**Interfaces:**
- Produces: `export function newProblems(school, keptPairs, allPairs) -> [{ code, id }]`, the problems in `recheck(school, allPairs)` whose `code + "|" + id` is not in `recheck(school, keptPairs)`. Still imports nothing.

- [ ] **Step 1: Write the failing tests.**
  - `a broken kept draft with nothing added has no new problems`: an over-full course in `kept`, with `allPairs = kept`, gives `[]`.
  - `a new pair on a course without the certificate is a new problem`: gives `[{ code: "CERTIFICATE", id: tid }]`.
  - `a kept teacher who is now NOT_RANKED is not a new problem`.
  - `a new course left short is a new problem`: one new pair on an empty 2-seat course without a returning sponsor gives `UNDER_SEATS`.
  - `filling a short kept course removes a problem and adds none`: gives `[]`.
- [ ] **Step 2: Run and see them fail.** `node --test tests/unit/recheck.test.mjs`, which fails with `newProblems` not exported.
- [ ] **Step 3: Implement `newProblems`.**
- [ ] **Step 4: Run the unit suite and switch Task 2's test to `newProblems`.** `node --test tests/unit/` passes.
- [ ] **Step 5: Commit** `feat: newProblems lets a kept draft's broken rules stand`

### Task 4: Independent check of the new solve

**Files:**
- Create: `tools/make_later.mjs`, which writes `fixtures/later/kept.json` (`[{ "email", "course" }]`, sorted by email). These are the pairs `solveDraft` gives for the four needed files, plus three rule-breaking pairs from Task 2's test, written by email and course code.
- Modify: `tools/expected.py`, which accepts `--later` alone: reads the six school files and `kept.json`, applies the keep semantics from the spec ("How the new solve works"), and writes `fixtures/expected-later.json`. It shares no code with `src/`.
- Modify: `package.json`, adding `"fixtures:later": "node tools/make_later.mjs && uv run --python 3.14 --no-project --isolated --with ortools --with openpyxl tools/expected.py --later"`.
- Test: `tests/unit/solver-later-fixture.test.mjs`. `solveDraft(highs, later, keepFromJson)` has `values` deep-equal `expected-later.json`'s `values`, and placed count and courses running equal its `placed` / `running`.

**Interfaces:**
- Consumes: `readForms`, `solveDraft(…, keep)`.
- Produces: `fixtures/expected-later.json` with `{ "values": [short, score, noForm], "placed": n, "running": n }`, the same shape as `expected.json`.

- [ ] **Step 1: Write the fixture test.** It fails because `expected-later.json` is missing.
- [ ] **Step 2: Write `make_later.mjs` and the `--later` branch, then run `npm run fixtures:later`.** Expected: it prints the JSON, and `git diff fixtures/expected*.json` shows only the new file.
- [ ] **Step 3: Run** `node --test tests/unit/solver-later-fixture.test.mjs`. Expected: PASS. If the values differ, the JS model and the spec disagree: fix `src/solver.js`, never the JSON.
- [ ] **Step 4: Commit** `test: expected-later.json from CP-SAT checks the solve on a kept draft`

### Task 5: Mock, saving and the Add forms card

**Files:**
- Modify: `src/state.js` (`addForms`, the `describe` case), `src/store.js` (`replaceUpload`), `src/app.js` (bottom-line link, the `forms` frame, drop routing, `addLater()`), and the How it works line
- Modify: `CLAUDE.md` (one line under `src/import.js` and `src/solver.js` saying later forms are added on a built draft) and `README.md` if it lists the screens
- Test: `tests/unit/state.test.mjs` (add), `tests/e2e/later.spec.mjs` (new)

**Interfaces:**
- Consumes: `readForms`, `solveDraft(…, keep)`, `newProblems`.
- Produces: `Mock.addForms(school, pairs, rounds, senders)`. It swaps in `school` (like `init`, but without touching history), sets `placements[t] = c` for each new pair, removes from `left` everyone now placed and every unplaced teacher in `senders`, leaves `moved` alone, and appends the event `{ type: "forms", rounds, placed: pairs.length }`. `describe` gives `Added ${rounds.join(" and ")} forms, placed ${n}`.
- Produces: `replaceUpload(school)` in `store.js`, which puts the upload and does not clear snapshots.
- App flow in `addLater()`: `readForms` → `keep = placed pairs now` → `solveDraft(highs, school, keep)` → if not Optimal or `newProblems(...)` is not empty, show the failure line and change nothing → else `inOrder(() => replaceUpload(school))`, then `Mock.addForms(...)` (its snapshot is queued after, so a failed upload write stops the snapshot too) → pop the card.

- [ ] **Step 1: Write the failing unit tests** in `state.test.mjs`:
  - `addForms places the new pairs and nobody else moves`.
  - `undo after addForms restores placements, school stays`: after `Mock.undo()`, placements equal those before, and `Mock.teacher(id).prefs` still holds Round 2 entries.
  - `left is cleared for senders and the newly placed only`.
  - `describe a forms event`: gives the three exact strings in Global Constraints.
- [ ] **Step 2: Run and see them fail.** `node --test tests/unit/state.test.mjs`
- [ ] **Step 3: Implement `Mock.addForms`, `describe` and `replaceUpload`.** Run `node --test tests/unit/`, which passes.
- [ ] **Step 4: Write the failing e2e tests** in `tests/e2e/later.spec.mjs`, using `watchPage`, with no fixed waits:
  - `Add forms on a Round 1 draft places people and nobody on a course moves`. Drop the four needed files and Build. Move one teacher onto a full course (which breaks a rule). Record `[data-result]` `data-placed` and every placement. Open Add forms, drop `round2.xlsx` + `singapore.xlsx`, and both rows say `ready`. Press Add and place, then check that `data-placed` went up, every recorded placement is unchanged, the moved teacher still shows the full-course warning, and History's top line matches `/^Added Round 2 and Singapore forms, placed \d+$/`.
  - `Undo after Add forms puts placements back and reload keeps the forms`.
  - `a refused file keeps Add and place locked and changes nothing`: `round2.xlsx` on `Sheet1`.
  - `names off: the card, History and the download hold no name or email` (reuse `expectNoPeople` and the download helpers from `draft.spec.mjs`), plus `forbiddenIn` over the card and History.
  - `the Add forms card fits the detail budget` with `measure(page, "detail")`, and To do still fits `first` with the new link.
- [ ] **Step 5: Run and see them fail.** `npm run build && npx playwright test tests/e2e/later.spec.mjs`
- [ ] **Step 6: Implement the UI.** In `bottomLine()`, the link `<button class="link" data-act="open" data-to="forms" data-k="forms">Add forms</button>` goes before History. Add `forms: formsCard` to `frame`'s map; the card reuses `slotRow`'s markup over its own `laterSlots` / `laterHeld` (never Start's `slots` / `held`). In the window `drop` handler, when `phase === "draft"` and `top_()?.k === "forms"`, send the files to the card; otherwise do as today. The new `data-act`s are `addLater` and the card's file input `data-k="later-files"`. Add the How it works line from the spec.
- [ ] **Step 7: Run the whole check.** `npm run check` ends in `CHECK OK`. If an existing count changed only because of the new link, say which in the commit message; change nothing else in the old tests.
- [ ] **Step 8: Commit** `feat: Add forms brings Round 2 and Singapore forms into a built draft`

### Task 6: Final run

- [ ] **Step 1:** `npm run check:final` ends in `CHECK OK`.
- [ ] **Step 2:** Add one line to `docs/hand-checks.md`: in real Excel, the download after Add forms opens with no repair prompt.
- [ ] **Step 3: Commit** `docs: hand check for the download after Add forms`. Leave the branch unmerged for the owner.
