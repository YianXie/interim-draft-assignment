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
- Chrome opens the page on its own. If it doesn't, open Chrome and go to `http://127.0.0.1:4173`.

**Leave the Terminal window open** while you use the page. Closing it stops the page.

## 3. Try it

1. **Build a draft.** Click **Use sample data**, scroll down, then click **Build**.
2. **To do.** The list on the right is what still needs a person. Click through it, or use **Next**.
3. **Open a teacher.** Click **Teachers** at the top, then click a teacher. Read the **Why** line, then click **All options**.
4. **Move someone.** Click a course in their list. The move happens straight away.
5. **Undo.** Click **Undo**, at the bottom right of the page.
6. **Names.** Turn on **Show names** at the top. It is off at first, so the page shows T numbers instead of names.
7. **Search.** On **Teachers** or **Courses**, type part of a name or course in the search box.
8. **History.** Click **History** at the bottom right. **Restore** takes the draft back to how it was right after that line.
9. **Download.** Click **Download** at the top and open the file in Excel.
10. **Add forms later.** Real forms arrive in rounds, so try this too:
    1. **History**, then **Start over** at the bottom. This deletes the draft from Chrome.
    2. Click **Download sample data**. Double-click `sample-this-year.zip` in Downloads to unzip it.
    3. Click **Choose files** and pick only `courses.xlsx`, `staff.xlsx`, `returning.xlsx` and `round1.xlsx` (hold Command to pick several). Click **Build**.
    4. Click **Add forms** at the bottom right, choose `round2.xlsx`, then click **Add and place**. With the sample, Round 2 places nobody, so **History** shows "placed 0". That is expected.
    5. Do the same with `singapore.xlsx`. This one places 6.

## Good to know

- **One tab is simplest.** A second tab of the page follows the first, so changes in either are kept. If the bottom left ever says **Not saved**, reload the page; the last change may need doing again.
- **Show names is off at first**, and **Download** follows it: with names off, the workbook has T numbers only.
- **Moves happen in one click**, with no "are you sure". **Undo** at the bottom right takes the last one back.
- **A move that breaks a rule is allowed.** The options list warns before you click, for example "Full" or "No scuba certificate". Afterwards the **Courses** list shows it under Status, and the course's card marks the person in red.
- **Start over** is at the bottom of **History**.
- **File names must match exactly**, in lowercase: `courses.xlsx`, not `Courses.xlsx` or `courses (1).xlsx`. Unzip the sample zip first; the zip itself is not read.
- **One problem per file is shown at a time.** Fix it, add the file again, and the next one (if any) shows.
- The draft is saved in Chrome on this Mac, so it is still there after closing everything.

## 4. Stop it

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
| Bottom left says **Not saved** | Reload the page. Check the last change is there; if not, make it again. |
| A file row is red | Read the row: it names the file, the row and the problem. Fix it in Excel, save, and add it again. |

## Tell me

Please note what you expected, what happened, and anything you had to guess. A screenshot helps: press Shift-Command-4, then drag over the area.
