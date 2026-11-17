# Hand checks

Seven checks that a browser test cannot do. Use invented data only.

## 1. Real Excel

1. Run the page, drop `fixtures/school`'s six files, press Build, press Download.
2. Open the workbook in an activated copy of Excel.
3. It must open with no repair prompt.
4. Edit one cell and save. That must work too. On the presenting user, view-only is enough.

## 2. Force-quit

1. Build, then make ten edits (moves, Leave unplaced).
2. Force-quit Chrome (Apple menu, Force Quit).
3. Reopen Chrome and the page. The draft is there with every edit, and no re-upload is asked for.

## 3. Drag from Finder

1. Open the folder of six files in Finder.
2. Select all six and drag them onto the drop zone.
3. All six are recognised and Build unlocks.

## 4. Fresh profile

1. Start Chrome with a new profile (or a guest window).
2. Double-click `start-server.command`.
3. Tell the demo story: drop, Build, open a teacher, Move to, Undo, move again, names on and off, reload, Download, find the change in the workbook.

## 5. Real Excel with last year's files

1. Drop the six and `fixtures/past`'s four, press Build, press Download.
2. Open the workbook in an activated copy of Excel.
3. It must open with no repair prompt, with its Last year column on the Teachers sheet and its Last year sheet.

## 6. Real Excel with `fit.xlsx`

1. Drop the six and `fixtures/fit/fit.xlsx`, press Build, press Download.
2. Open the workbook in an activated copy of Excel.
3. It must open with no repair prompt, with its From their form column on the Teachers sheet.

## 7. Real Excel after Add forms

1. Drop the four needed files (not `round2.xlsx` or `singapore.xlsx`) and press Build.
2. Add `round2.xlsx` and `singapore.xlsx` with Add forms, then press Download.
3. Open the workbook in an activated copy of Excel. It must open with no repair prompt.

Checks 5, 6 and 7 passed on 2026-11-16, on commit c64667f.
