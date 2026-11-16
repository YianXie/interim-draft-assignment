# Later forms: design

Status: draft for the owner's review, 2026-11-16. To be built on branch `later-forms`; merging is the owner's call.

## Why

The office allocates International Round 1, then International Round 2, then Singapore. Since 2026-11-16 a draft can be built from Round 1 alone (`round2.xlsx` and `singapore.xlsx` are optional), but the later forms can only come in by Start over, which throws away every edit. The office spends most of its time on the Round 1 draft, so the later forms must be added on top of it.

## Goals

- On a built draft, **Add forms** takes `round2.xlsx`, `singapore.xlsx` or both, checks them like Start does, and places people from them.
- Whatever the draft is when the forms are added, it is the starting point, even if it breaks hard rules. Nothing is blocked. Broken rules keep showing as warnings, as they do after a move today.
- One new version in History, "Added Round 2 forms, placed 7". Undo takes the placements back.

## Decisions (owner, 2026-11-16)

1. **Everyone placed now stays where they are**, whether the solver or the office put them there and whether or not that breaks a rule.
2. **"Leave unplaced" does not stop the new solve, but a hand move to Not placed does** (changed 2026-11-16 after the final review). Anyone not on a course can be placed, except a teacher the office moved to Not placed by hand (not on a course and in `moved`): they stay off every course. After the solve, a teacher stays marked as left only if they are still unplaced and either sent none of the added forms or were moved to Not placed by hand.
3. **A course that already has sponsors and empty seats is filled first.** It counts like a returning-sponsor course today: fewest empty seats is the first priority.
4. **Undo takes back the placements only.** The added forms stay in the school, so cards and the download keep showing the new choices.

## How the new solve works

The kept sponsors are the teachers on a course when Add forms runs. They get no variables. For every other teacher and course the rules and priorities are the ones in `docs/spec.md`, with these changes:

- A course's free seats are its seats minus its kept sponsors. A course already at or over its seats gets nobody new.
- A **running course** is an offered course with at least one kept sponsor. It may stay short. Stage 1 minimises empty seats on running courses (this replaces "courses with a returning sponsor", which are all running already unless the office moved the sponsor off).
- An offered course with no kept sponsor runs with every seat filled, or not at all, as today.
- A returning sponsor who is not on a course was taken off it by the office, so the new solve treats them like anyone else.
- Last year's priority and the fit stages work as today, counted over the teachers who are not kept.
- With nobody forced, the model always has a solution: placing nobody new satisfies every row.

**The check before anything is shown.** `recheck` is run on the kept pairs alone and on all pairs. The result is accepted only if every problem in the second list was already in the first. So a broken rule the office made is allowed, and the solver can't add one. Otherwise the card shows one fixed line and nothing changes.

## Reading the forms

`readForms(school, files)` reads only `round2.xlsx` and `singapore.xlsx`, with the same header, sheet, email and row checks as Start, checked against the school's own teachers and course names. Any other name is refused with one line. A round that is already in the school is **replaced**: that round's choices are removed from every teacher, then the new file's are added. A teacher's `submitted` becomes true if they are in an added file and never goes back to false. The School keeps its current shape, with no new keys, so saved drafts from before this change still work.

## Screens

- Bottom line: an **Add forms** link next to History.
- The Add forms card (the `detail` budget, 60 words): its title, a row each for `round2.xlsx` and `singapore.xlsx` with the same description and status words as Start, Choose files, and one filled button, **Add and place** (it says **Placing** while working). Files can be dropped anywhere on the page while the card is open.
- On failure the card shows "Couldn't place anyone. Nothing changed."
- How it works, under "After the draft", gets one line: "Add forms brings in Round 2 or Singapore forms later. Everyone on a course stays; only open seats and unplaced teachers are worked out."

## Must not happen

- Anyone on a course before Add forms is on a different course after it.
- The new solve adds a broken rule that was not there before.
- Any existing check is loosened or edited, except that the Start and History counts may change because of the new link. `fixtures/expected*.json` is unchanged.
- A name or email appears with names off on the card, in History or in the download.
- The page sends anything anywhere.

## Not in this version

- Re-reading `round1.xlsx`, `courses.xlsx`, `staff.xlsx` or `returning.xlsx` into a built draft.
- `fit.xlsx` for answers in a Singapore file added later (the reader runs before Start).
- Undo taking the forms out again.

## Constraints

Everything in `docs/spec.md` and `CLAUDE.md` holds. The screens freeze on Fri 20 Nov for the demo, so this work stays on its branch until the owner merges it.
