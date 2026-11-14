# Cross-year tracking: design

Status: built on branch `cross-year-tracking` on 2026-11-14. Awaiting the owner's review of the branch.

## Why

The Interim Office wants to see, for each teacher, how last year went (a top-4 choice, a 5th to 7th choice, or none of their choices), and to use it so that people who got none last year come first this year.

## Goals

- The office drops last year's files next to this year's six and gets, per teacher, last year's result.
- The draft gives teachers who got none of their choices last year a top-4 choice this year wherever the rules allow.
- The download shows last year next to this year so the office can count and filter in Excel.

## Not in this version

- More than one past year. Only last year is read.
- Real file layouts. Past files use the invented school's layouts, like the six.
- Fixing an unmatched name on screen. The office corrects the file and drops it again.
- Any change to the Use sample data button, the reasons, the kinds of To do item, or the rows of the Teachers list.

## Must not happen

- With no past files dropped, anything behaves differently from today. Every existing check passes unchanged, and none is edited.
- A name from last year's file appears on screen or in the page with names off.
- A reason says or hints that someone had priority. `state.js` already forbids this, so last year's result is shown as its own line on the teacher card, never inside the reason.

## Constraints from `docs/spec.md`

- Invented data only. Past files reuse the existing invented people and courses, so no new names need the owner's check.
- The existing six fixture files and `fixtures/expected.json` values `[1, 1366, 3]` are not regenerated.
- Word and size budgets (`measure.cjs`), the forbidden-words check and the zero-outside-requests check all apply to the new screens.
- Work happens on a branch, `cross-year-tracking`. `main` stays as it is for the 20 November freeze; merging is the owner's decision.

## Approaches

**Getting last year in**

| Option | Trade-off |
|---|---|
| **Four past files: the allocation and the three form files (chosen)** | Matches what the office has. The page works out the choice number itself. Needs name matching, because the allocation lists sponsors by name. |
| One compact history file (Email, Year, Result) | Simplest to read, but someone would have to work out each result by hand first. |
| Re-upload last year's download from this tool | No such file exists for past years. |

**Using it in the draft**

| Option | Trade-off |
|---|---|
| **A new priority above the preference score (chosen)** | Strong and easy to state. Fits how the solver already works: solve one priority, pin it, solve the next. Can lower the total preference score. |
| A new priority below the preference score | Never costs anyone else anything, but only breaks ties, so it rarely changes a draft. |
| Extra points in the preference score | Tunable, but no one can say why one person beat another. |
| Show only | No effect on the draft; the office does the balancing by hand. |

## The four past files

Optional, and all four or none. Each is `.xlsx`, first sheet `Fernhollow`, headers in row 1. The file name picks the slot.

| File | Columns |
|---|---|
| `past-allocation.xlsx` | Course Code, Course Name, Sponsor 1, Sponsor 2, … (as many Sponsor columns as the fullest course needs; cells hold names) |
| `past-round1.xlsx` | Email, Choice 1 to Choice 7 |
| `past-round2.xlsx` | Email, Choice 1 to Choice 3 |
| `past-singapore.xlsx` | Email, Choice 1 to Choice 5 |

- Past course names are compared only with `past-allocation.xlsx`, never with this year's course list, because courses change between years. A past choice naming a course that is not in the allocation file is accepted (the course did not run). *(Amended during the build, 2026-11-14: a past choice is compared with the allocation's course name ignoring case and extra spaces, as sponsor names are. Compared letter for letter, a choice typed in another letter case did not match, and the teacher read as None, which earns the new priority.)*
- Past emails must be on `fernhollow.example`. An email not on this year's staff list is ignored (the person left).
- A sponsor name is matched to this year's `staff.xlsx` by name, ignoring case and extra spaces. A name that matches nobody, or matches two people, is left unmatched and counted. No guessing.
- The same sponsor name on two past courses refuses the file with one plain line, as today. *(Amended during the build, 2026-11-14: the file is refused only when the repeated entry is one person, that is, it matches exactly one of this year's staff. A repeated entry that matches nobody, such as a placeholder written in two cells, or that matches two staff who share a name, is counted as not matched each time it appears. The rule is there to stop one person being on two courses, and a placeholder should not block the office.)*
- *(Amended during the build, 2026-11-14: a value in a past file outside the headed columns refuses the file with one plain line giving the row. Left unread, a sponsor typed one column too far right was lost without a word, and that teacher became Not found or lost their record.)*
- If one to three of the four are present, the missing ones show "file not added" and Build stays locked.

## Last year's result, per teacher

Worked out at upload and kept on the teacher in the saved upload record. Snapshots are unchanged.

| Result | When |
|---|---|
| Top 4 | Placed on a course they ranked 1st to 4th |
| 5 to 7 | Placed on a course they ranked 5th to 7th |
| None | Sent a form, and was placed on a course they did not rank |
| Not found | Sent a form, but their name is not on the allocation |
| No form | Placed, but sent no form |
| (no record) | Not in any past file |

Where a course was ranked on more than one form, the choice number is the one the page already shows for it: the listing with the highest preference score (`choice` in `state.js`), so a course ranked 6th in Round 1 and 2nd in Round 2 counts as 6th. The same rule is used for last year and for this year, so the card, the download and the priority never disagree. A Singapore 5th choice counts as "5 to 7".

"Not found" is deliberately separate from None. A misspelt or shared name on the allocation would otherwise look like "not placed" and quietly give someone priority. Not found is shown to the office and is never made up for.

## The new priority

When past files are present, the solver has four priorities:

1. Fewest empty seats on courses with a returning sponsor (unchanged).
2. **Most teachers whose result last year was None placed on a course that is a 1st to 4th choice this year, by the rule above.**
3. Highest preference score (unchanged).
4. Fewest people who sent no form (unchanged).

The rules that are never broken stay exactly as they are. Returning sponsors are fixed to their course and do not count in priority 2. Without past files the solver runs today's three priorities and returns today's three values.

## What the office sees

- **Start:** the past files appear as rows like the six. The allocation row also says how many names were not matched, as a number only.
- **Teacher card:** one extra line, for example "Last year: none of their choices", "Last year: 2nd choice", "Last year: no form", "Last year: not found on the allocation". No line when there is no record. The line is shown on an opened teacher card only, not on a To do item. *(Amended during the build, 2026-11-13: a To do item for an unplaced teacher is already within 2 or 3 words of the 80-word limit for that screen, so no last-year line fits there. The result is still one click away on the teacher's card, in the search and in the download.)*
- **Teachers list:** the rows do not change. The search box also matches last year's result, so typing "none" lists those teachers. *(Amended during the build, 2026-11-14: the search also matches the words the download uses for the result, "Top 4", "5 to 7", "None", "Not found" and "No form", so what the office reads in Excel finds the same teachers on screen. The rows still show nothing new.)* `teacherFlags` is not touched, so the download's row order stays as it is.
- **Download, only when past files were dropped:** the Teachers sheet gains a "Last year" column after "Choice". A new "Last year" sheet holds a small table counting teachers by last year's result against this year's (top 4, 5 to 7, not on their list, returning, no form, not placed). With names on, that sheet also lists the unmatched names and the teachers marked Not found, so the office can pair them up and correct the file.

## Fixtures and checks

- A new script writes the four past files from its own fixed seed, reading the existing six. It builds last year's allocation with a simple fill, not with the solver.
- The invented past year must look like an ordinary year: this year's returning sponsors are on their course last year; 10 to 14 teachers with None, at least 8 of whom sent a form this year; most others on a top-4 choice; one sponsor entry that matches nobody, written as a label that cannot be a person's name ("Sponsor who left"), so no new invented name needs the owner's check; one teacher who sent a past form and is not on the allocation (Not found). The draft with past files must differ from the draft without, with more of the None teachers on a top-4 choice. *(Amended during the build, 2026-11-13: the first version also required a None teacher who cannot be given a top-4 choice. With this year's six files that needs about 41 None teachers, which is not a believable year. Competition between None teachers is instead proven by the solver's own tests and a brute-force cross-check on small random schools.)*
- `tools/expected.py`'s separate solver gains the same priority and writes a second block of expected values for the ten-file case. It still shares no code with `src/`.
- New unit checks: each result in the table above; each refusal; name matching, including a name shared by two staff, tested on a small made-up list inside the test; the four values equal the separate solver's; rows shuffled and T numbers changed give the same draft; the new download column and sheet appear only with past files.
- New browser checks: ten files build and a teacher card shows its last-year line; Start with ten rows and the teacher card stay inside their budgets; with names off, no name from any of the ten files is in the page or the workbook; three of four past files keep Build locked.
- Done means the pasted output of `npm run check`, with every existing check untouched.

## Left to the builder

- Internal names, and where the new reading code lives.
- Exact wording of the new lines, inside the word budgets and the forbidden-words list.
- The seed and fill method for the invented past year, as long as the required cases above hold.

## For the office to confirm (defaults are in place; none blocks the build)

- The choice number alone sets the result, whatever the round.
- Only None is made up for, not "5 to 7".
- No form last year is not made up for.
- Someone who sent a form last year but is not on the allocation is shown as Not found and is not made up for.
- A course ranked on two forms counts by the listing the page shows (Round 1 first).
- The new priority sits above the preference score.
