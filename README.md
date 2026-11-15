# Interim Draft Assistant

A laptop-only demo. Six spreadsheets become an editable, explained allocation draft that you can move people around in and download to Excel.

It has only ever seen invented data: an invented school, invented people, invented preferences. It has never run on real data, so its drafts have not been compared with anything a real office placed. The placed count is a property of the invented data, not a result.

## What it needs

- A Mac with Chrome.
- Node 24 or newer. A default PATH may find an older Node; `start-demo.command` puts `/opt/homebrew/bin` first for that reason.

## Run it

- Double-click `start-demo.command`. It builds the page if needed, starts the server on `http://127.0.0.1:4173`, and opens it. Closing its window stops the server.
- Or in a terminal: `npm install`, `npm run build`, `npm run serve`, then open `http://127.0.0.1:4173`.

## Last year's files

- Four more files may be dropped with the six: `past-allocation.xlsx`, `past-round1.xlsx`, `past-round2.xlsx` and `past-singapore.xlsx`.
- They are optional: all four or none.
- The file name picks the slot, so it must be exact.
- An invented set is in `fixtures/past`. Use sample data loads the six on the This year tab; on the Last year tab it loads these four, plus any of the six not added yet. Download sample data, beside it, saves the same files as a zip: the six on This year, the four on Last year.
- With them, each teacher's result last year is on their card, in the search and in the download. The draft also puts those who got none of their choices last year on a top-4 choice first, wherever the rules allow.

## Written answers

- `fit.xlsx` is an optional file on Start, after the six. It holds what the reader found in the written answers, checked by the office: one row per fact, tied to a course where the teacher tied it to one.
- The reader, `tools/reader.mjs`, is run by hand on a machine with Ollama running: `node tools/reader.mjs --dir <folder with the six>`. `--out`, `--host`, `--model` and `--prompt` change where it writes, which address and model it uses, and the prompt file. It drops any quote not word for word in the answer and ends with a one-line summary.
- The office checks and corrects every row in Excel before adding the file. The page never calls a model.
- With it, the draft uses fit only as the last tie-break. Each teacher's panel and the download show what was found.
- Use sample data and Download sample data stay the six. An invented `fit.xlsx` is in `fixtures/fit`; add it on Start by hand, as the office would.

## Check it

- `npm run check` builds, runs the unit tests and the browser tests, and ends with `CHECK OK`.
- `npm run check:final` does the same with the browser tests repeated five times.
- `docs/hand-checks.md` lists the four checks done by hand.

## Things to know

- The page is blocked by its own policy from sending anything out. That covers the page only. Once a workbook is downloaded, it no longer applies.
- The draft and every edit are kept in this browser, unencrypted. The Show names switch changes what you see; the names are still in the browser.
- T numbers are pseudonymous, not anonymous.
