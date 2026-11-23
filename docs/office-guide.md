# Office guide: trying the Interim Draft Assistant

This is a demo. Its sample data is an invented school with invented teachers. Please try anything, break anything, and tell me what was unclear.

You need a Mac with macOS 13.5 or newer, Google Chrome, an internet connection the first time, and about 20 minutes.

## 1. Get it

1. On the [project's GitHub page](https://github.com/YianXie/interim-draft-assignment), click the green **Code** button, then **Download ZIP**.
2. Open your **Downloads** folder and double-click `interim-draft-assignment-main.zip`. A folder with the same name appears.
3. Move that folder somewhere easy to find, such as **Documents**.

## 2. Start it

**The first time**, start it from Terminal. The Mac blocks a double-click on files downloaded from the internet, and Terminal avoids that with no password.

1. Open **Terminal**: press Command-Space, type `Terminal`, and press Return.
2. Type `bash` and then a space. Type it yourself rather than copying it from this page.
3. Drag `start-server.command` from the folder into the Terminal window. Its location appears after `bash `.
4. Press Return.
5. If the Mac asks whether Terminal may access a folder, click **Allow**.

**Next time** (not now), just double-click `start-server.command` in the folder.

If you double-clicked it first and the Mac said "start-server.command" Not Opened, click **Done** (not Move to Trash), then follow the Terminal steps above. Another way is Apple menu > System Settings > Privacy & Security: scroll down, click **Open Anyway** (it shows for about an hour), then enter your password. On a school-managed Mac that may ask for an administrator or be blocked; the Terminal steps avoid that.

### What the Terminal window shows

A double-click opens a Terminal window; the first time, it is the window you typed in. That window is the server the page runs on.

- **The first time only**, it may say the Mac needs Node 24. Type `y` and press Return. It fetches Node into the folder; no password is needed.
- It then says "Getting the parts the page needs". This takes about a minute the first time.
- Chrome opens the page on its own. If it doesn't, open Chrome and go to `http://127.0.0.1:4173`. If the window says Google Chrome was not found, the page opened in another browser; install Chrome and use it, so the draft is always in one place.

**Leave the Terminal window open** while you use the page. Closing it stops the page.

## 3. Try it

1. **Build a draft.** Click **Use sample data**, scroll down, then click **Build**.
2. **To do.** The list on the right is what still needs a person. Click through it, or use **Next**.
3. **Open a teacher.** Click **Teachers** at the top, then click a teacher. Read the **Why** line, then click **All options**.
4. **Move someone.** Click a course in their list. The move happens straight away.
5. **Undo.** Click **Undo**, at the bottom right of the page.
6. **Names.** Turn on **Show names** at the top. It is off at first, so the page shows T numbers instead of names.
7. **Search.** On **Teachers** or **Courses**, type part of a name or course in the search box.
8. **History.** Click **History** at the bottom right. Each line shows its version (v1, v2, …), the day and the time. **Restore** takes the draft back to how it was right after that line.
9. **Download.** Click **Download** at the top and open the file in Excel.
10. **Add forms later.** Real forms arrive in rounds, so try this too:
    1. **History**, then **Start over** at the bottom. This deletes the draft from Chrome.
    2. Click **Download sample data**. Double-click `sample-this-year.zip` in Downloads to unzip it.
    3. Click **Choose files** and pick only `courses.xlsx`, `staff.xlsx`, `returning.xlsx` and `round1.xlsx` (hold Command to pick several). Click **Build**.
    4. Click **Add forms** at the bottom right, choose `round2.xlsx`, then click **Add and place**. With the sample, Round 2 places nobody, so **History** shows "placed 0". That is expected.
    5. Do the same with `singapore.xlsx`. This one places 6.

## 4. Use your own files

Try the sample first. Your own files work the same way, as long as each one is laid out as below. Nothing you load leaves this Mac: the page reads the files inside Chrome and cannot send anything anywhere.

### The files

Each file is an Excel `.xlsx` file. Only the first sheet is read. Row 1 holds the headers, spelled exactly as here and in this order. The easiest start is to click **Download sample data** and type over the sample files, keeping row 1.

| File | Needed? | Headers in row 1 |
| --- | --- | --- |
| `courses.xlsx` | Yes | Course Code, Course Name, Type, Seats, Offered, Certificate, Arrival Country, Arrival City, Vendor Link |
| `staff.xlsx` | Yes | Email, Name, Certificates |
| `returning.xlsx` | Yes | Email, Course Code |
| `round1.xlsx` | Yes | Timestamp, Email, Choice 1 to Choice 7, Enhancing Learning or Safety, Notable Priorities, Final Questions or Comments |
| `round2.xlsx` | Later is fine | Timestamp, Email, Choice 1 to Choice 3 |
| `singapore.xlsx` | Later is fine | Timestamp, Email, Choice 1 to Choice 5, Enhancing Learning or Safety, Additional Comments or Questions |

What goes under the headers:

- **Type** is International or Singapore. **Seats** is a whole number. **Offered** is Yes or No.
- **Certificate** is the certificate a course needs, or empty. In `staff.xlsx`, **Certificates** lists what a teacher holds, separated by `;` or commas, spelled as on the course list.
- **Email** is one address per row, and each person appears once per file. Every email on a form or in `returning.xlsx` must be in `staff.xlsx`.
- **Choices** are course names, spelled as in `courses.xlsx`. Round 1 and Round 2 take International courses; the Singapore form takes Singapore courses.
- `returning.xlsx` lists each sponsor going back to the course they ran, by course code.
- Timestamp, the written answers, Arrival Country, Arrival City and Vendor Link must have their headers, but the page reads nothing under them.

If `round2.xlsx` or `singapore.xlsx` is not ready yet, leave it out and bring it in later with **Add forms**.

### Last year's files (optional)

On Start, the **Last year** tab takes four more files: all four or none.

| File | Headers in row 1 |
| --- | --- |
| `past-allocation.xlsx` | Course Code, Course Name, Sponsor 1, Sponsor 2, and so on. Sponsors are written by name, as in `staff.xlsx`. |
| `past-round1.xlsx`, `past-round2.xlsx`, `past-singapore.xlsx` | The same as this year's three forms. |

With them, each teacher's card and the download show how they did last year, and anyone who got none of their choices last year is put on a 1st to 4th choice first, where the rules allow. A name on last year's list that matches nobody on this year's staff list is counted, never shown.

### What teachers wrote (optional)

`fit.xlsx` holds facts found in the written answers, such as a language spoken or a limitation, one row per fact: Email, Course Code (empty for a general fact), Kind, Fact, Quote. Kind is Language, Certificate, Experience, Skill or Limitation. Making this file needs the maintainer; every row should be checked by the office before it is added. The draft uses it only to choose between otherwise equal placements.

### Names and where they go

- After **Build**, what was read from the files (names, emails, certificates and choices) is saved in Chrome on this Mac, not encrypted, so anyone using this Chrome can see it. **History**, then **Start over**, deletes all of it.
- **Show names** only changes what is on screen. **Download** follows it: with names on, the workbook holds names and emails; with names off, T numbers only.
- A downloaded workbook is an ordinary file. Keep it where you would keep the allocation itself.

### Two things that need the maintainer

Turning the office's raw form exports into these files, and comparing a draft with the office's final allocation, are both done from Terminal for now. Ask the maintainer.

## Good to know

- **One tab is simplest.** A second tab of the page follows the first, so changes in either are kept. If the bottom left ever says **Not saved**, click **Download** first, then reload the page: the download holds every change, and the reload goes back to the last one that was saved.
- **Show names is off at first**, and **Download** follows it: with names off, the workbook has T numbers only.
- **Moves happen in one click**, with no "are you sure". **Undo** at the bottom right takes the last one back.
- **A move that breaks a rule is allowed.** The options list warns before you click, for example "Full" or "No scuba certificate". Afterwards a course that is over its seats, or has a sponsor without the certificate, is on **To do** until it is put right, and the download says so under Status.
- **Start over** is at the bottom of **History**.
- **The file name picks what a file is**: `courses.xlsx`, `staff.xlsx` and so on. Capital letters and a second download's `courses (1).xlsx` or `courses copy.xlsx` are fine; any other name is not read. A folder holding the files, or a zip of them such as the sample zip, can be dropped as it is.
- **A red file row shows its first problem**, and how many more rows need fixing. Fix them, add the file again, and the next problem (if any) shows.
- **`staff.xlsx` may say "1 certificate no course needs".** That is fine for a certificate like First Aid. If it should be one a course asks for, check its spelling matches `courses.xlsx`; otherwise those teachers are never placed on that course.
- The draft is saved in Chrome on this Mac, so it is still there after closing everything.

## 5. Stop it

Close the Chrome tab of the page, then close the Terminal window. If it asks, click **Terminate**. To start again later, double-click `start-server.command` again.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The Mac says "start-server.command" Not Opened | Click **Done**, then start it from Terminal as in step 2. |
| Chrome says "This site can't be reached" | The Terminal window was closed. Double-click `start-server.command` again. |
| Terminal says "The demo is already running" | It is already open in another Terminal window. Use the Chrome tab that is already open. |
| Terminal says "Could not get the parts" or "Could not reach nodejs.org" | Check the internet connection and double-click again. A school network may block it; try another network. |
| Terminal says something else is using the address | Quit the other program, or restart the Mac, then double-click again. |
| The page opens on an old draft | That is the draft saved from last time. **History**, then **Start over**, gives a fresh start. |
| Bottom left says **Not saved** | Changes made from now on are not being saved. Click **Download** to keep them in a workbook, then reload the page. Anything missing after the reload is in that workbook; make those changes again. |
| The page opens on Start, though a draft was saved | The draft is kept by the browser it was made in. Open `http://127.0.0.1:4173` in that browser, usually Chrome. |
| A file row is red | Read the row: it names the file, the row and the problem. Fix it in Excel, save, and add it again. |

## Tell me

Please note what you expected, what happened, and anything you had to guess. A screenshot helps: press Shift-Command-4, then drag over the area.
