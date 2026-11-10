# Interim Draft Assistant

A laptop-only demo. Six spreadsheets become an editable, explained allocation draft that you can move people around in and download to Excel.

It has only ever seen invented data: an invented school, invented people, invented preferences. It has never run on real data, so its drafts have not been compared with anything a real office placed. The placed count is a property of the invented data, not a result.

## What it needs

- A Mac with Chrome.
- Node 24 or newer. A default PATH may find an older Node; `start-demo.command` puts `/opt/homebrew/bin` first for that reason.

## Run it

- Double-click `start-demo.command`. It builds the page if needed, starts the server on `http://127.0.0.1:4173`, and opens it. Closing its window stops the server.
- Or in a terminal: `npm install`, `npm run build`, `npm run serve`, then open `http://127.0.0.1:4173`.

## Check it

- `npm run check` builds, runs the unit tests and the browser tests, and ends with `CHECK OK`.
- `npm run check:final` does the same with the browser tests repeated five times.
- `docs/hand-checks.md` lists the four checks done by hand.

## Things to know

- The page is blocked by its own policy from sending anything out. That covers the page only. Once a workbook is downloaded, it no longer applies.
- The draft and every edit are kept in this browser, unencrypted. The Show names switch changes what you see; the names are still in the browser.
- T numbers are pseudonymous, not anonymous.
