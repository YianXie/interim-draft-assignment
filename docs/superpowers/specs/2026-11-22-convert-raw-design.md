# Converter for the office's raw files — short design

## Why

The owner has this year's raw form exports, course list, returning list and final allocation, and wants to see the
draft next to what the office placed. The page only reads its own layout (sheet `Fernhollow`, exact headers,
`@fernhollow.example`), and rewriting ~135 teachers' files by hand is slow and error-prone.

## Goal, non-goals, anti-goals

- Goal: one command turns the raw folder into the six files the page reads, plus a report of everything still to fill.
- Non-goals: comparing the draft with the final allocation; reading real layouts in the page; certificates.
- Anti-goals: any real data, real header text, real domain or real-year figure in the repo; a converter that guesses
  (a wrong name or course silently written in) instead of listing what it could not settle.

## Approaches

- **Script in `tools/`, run by hand (picked).** Like `tools/reader.mjs`: reads a folder, writes a folder. The page and
  its checks are untouched.
- Page reads raw files on Start: puts real layouts into the demo, which the spec keeps out.
- Fill-in Excel template: leaves the owner doing the copying the converter is meant to remove.

## Design

`node tools/convert.mjs --in <raw folder> --out <new folder>`; refuses if `--out` already holds any of the six. Reads and
writes only through `src/xlsx.js`; no network.

Raw files (same names as the page's): `courses.xlsx`, `returning.xlsx`, `round1.xlsx`, optional `round2.xlsx` and
`singapore.xlsx`, and `allocation.xlsx` (the final allocation). Columns are found by header, trimmed and case-insensitive,
by key words rather than whole question texts, so the real wording stays out of the code: Timestamp, Email Address,
First..Seventh Preference, the written answers (by single key words such as "enhance"), Prior Course;
Course Name, Vendor, Arrival City, Country; Trip Code, Course Name, Sponsor 1..n. Any other column is ignored.

- **Emails:** the part before `@` is kept and the domain becomes `fernhollow.example`, whatever the old domain.
  Two different addresses becoming one stops the run.
- **courses.xlsx:** Course Name is kept as written (e.g. "Great Ocean Road"). Course Code comes from the allocation:
  its Course Name with the leading Trip Code taken off is matched to the course name. No match leaves the code blank and
  listed. Seats = number of sponsors in the allocation, 2 if none. Type = Singapore when Country is Singapore, else
  International. Offered = Yes. Certificate blank. Arrival Country/City and Vendor Link are carried over.
- **Choices:** matched to a course by name, with or without a leading "Country —" (any dash), ignoring case and spacing,
  then written as the exact Course Name. Unmatched choices are kept as written and listed (file, row, text).
  Round 1's written answers are moved after the choices, under the page's headers.
- **returning.xlsx:** Prior Course copied as Course Code; codes not on this year's list are listed for a hand check.
- **Repeat submissions:** the row with the latest Timestamp is kept; dropped rows are listed.
- **staff.xlsx:** every email in any file. Name from the allocation: "First Last" → first letter + last name with spaces,
  hyphens and apostrophes removed, lower case. Exactly one matching email gives the name; none or several leaves it
  blank and listed. Certificates blank.
- **Report:** `convert-report.txt` in `--out`, also printed. It ends with the page's own reading of the output
  (`parseFiles`), so the owner sees whether Start will take the files, and which line it would show if not.

## Left to the builder

Exact key words per column; dash and spacing normalisation; report wording. Tests use only invented files, laid out
like the raw ones, with an invented old domain.

## Added 2026-11-23

- `allocation.xlsx` is optional: without it, Code and Seats columns in `courses.xlsx` are read if present (else codes blank and
  seats 2, listed), every course is offered, no `NOTRUN-n` codes are made, and staff names are blank with one report line.
- `--past` writes last year's four files from a year's raw folder with its allocation; `returning.xlsx` is not needed.
