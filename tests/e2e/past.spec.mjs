import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { PAST_SLOTS, SLOTS } from "../../src/import.js";
import { readBook, writeBook } from "../../src/xlsx.js";
import { pastFiles, readPastSchool } from "../unit/past-fixture.mjs";
import { buildButton, buildDraft, dropFiles, dropSchool, measure, schoolFiles, visibleStrings, watchPage } from "./helpers.mjs";
import { dropTen, tenFiles } from "./past-helpers.mjs";
import { forbiddenIn } from "./words.mjs";

const expected = JSON.parse(readFileSync("fixtures/expected-past.json", "utf8"));
const ORIGIN = "http://127.0.0.1:4173";
const ALLOCATION = PAST_SLOTS[0];
const TEACHERS = 96;

// The ten files read here, outside the page: last year's result by email, and what was written on the allocation and matched nobody.
// T numbers are drawn afresh on every read, so a person is followed from here to the page by email, with names on.
let read = null;
const fixture = () => (read ??= readPastSchool().then((school) => ({
  lastYear: new Map(school.teachers.map((t) => [t.email, t.lastYear])),
  unmatched: school.past.unmatched,
})));
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
const WORDS = { none: "none of their choices", notFound: "not on the allocation", noForm: "no form" };
const lineFor = (was) => (was ? `Last year: ${WORDS[was.result] ?? `${ORD[was.rank]} choice`}` : null);

// Every name, email and sponsor entry in the ten files: nothing here may show with names off.
async function hidden() {
  const rowsOf = async (path) => (await readBook(readFileSync(path)))[0].rows.slice(1);
  const out = new Set();
  for (const [email, name] of await rowsOf("fixtures/school/staff.xlsx")) out.add(email).add(name);
  for (const row of await rowsOf(pastFiles[0])) row.slice(2).filter(Boolean).forEach((entry) => out.add(entry));
  for (const path of pastFiles.slice(1)) for (const [email] of await rowsOf(path)) out.add(email);
  return [...out];
}

const dirs = [];
test.afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempFile = (name, bytes) => {
  const dir = mkdtempSync(join(tmpdir(), "interim-past-"));
  dirs.push(dir);
  writeFileSync(join(dir, name), bytes);
  return join(dir, name);
};
// A copy of last year's allocation in a temp directory. edit(rows) may change rows in place.
async function variantAllocation(edit) {
  const [sheet] = await readBook(readFileSync(pastFiles[0]));
  edit(sheet.rows);
  return tempFile(ALLOCATION, await writeBook([{ name: sheet.name, rows: sheet.rows }]));
}

const slot = (page, file) => page.locator(`[data-slot="${file}"]`);
const rightOf = (page, file) => slot(page, file).locator("span").nth(1);
const ready = (page) => page.locator("[data-slot]", { hasText: "ready" });
const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const search = (page) => page.getByPlaceholder("Search");
const teacherRows = (page) => page.locator("#main [data-row][data-teacher]");
const last = (page) => page.locator("#main [data-last]");
const emailShown = (page) => page.locator("#main [data-panel]").getByText(/@fernhollow\.example$/);
// Whole document as HTML, plus live input values, which outerHTML does not carry.
const domText = (page) => page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input")].map((i) => i.value).join("\n"));

// Start with all ten read together. Only a School that carries last year can say how many entries were not matched.
async function startTen(page) {
  await dropTen(page);
  await expect(ready(page)).toHaveCount(10);
  await expect(rightOf(page, ALLOCATION)).toContainText("not matched");
}
async function goTen(page) {
  await startTen(page);
  await buildDraft(page);
}
// The number on the To do tab. The draft built from ten files is not the draft built from six.
async function todoCount(page) {
  const n = Number((await tab(page, /^To do/).innerText()).replace(/\D/g, ""));
  expect(n).toBeGreaterThan(1);
  return n;
}
const nextItem = (page) => page.getByRole("button", { name: "Next", exact: true }).click();
// Reaches a To do item of this kind by pressing Next.
async function toItem(page, text) {
  for (let i = await todoCount(page); i > 0; i--) {
    if (await page.getByText(text).count()) return;
    await nextItem(page);
  }
  throw new Error(`no To do item shows ${text}`);
}
async function teacherIds(page) {
  await tab(page, "Teachers").click();
  await expect(teacherRows(page)).toHaveCount(TEACHERS);
  return teacherRows(page).evaluateAll((els) => els.map((e) => e.dataset.teacher));
}
// Opens every teacher's card in turn, from the Teachers tab, and calls fn(id) on each.
async function eachCard(page, fn) {
  for (const id of await teacherIds(page)) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    await expect(page.locator("#main .why")).toBeVisible();
    await fn(id);
    await page.getByRole("button", { name: "Back" }).click();
  }
}
// Every screen last year reaches in a built draft. Calls check(where) at each stop; ends on Courses.
async function walk(page, check) {
  const n = await todoCount(page);
  for (let i = 0; i < n; i++) { await check(`To do ${i}`); await nextItem(page); }
  await tab(page, "Teachers").click();
  await check("Teachers");
  await search(page).fill("none of their");
  await check("Teachers, searched");
  await search(page).fill("");
  await eachCard(page, (id) => check(`Teacher ${id}`));
  await page.getByRole("button", { name: "History" }).click();
  await check("History");
  await tab(page, "Courses").click();
  await check("Courses");
}
// Each teacher's course and last-year line as their card shows them, by T number.
async function cards(page) {
  const out = {};
  await eachCard(page, async (id) => {
    out[id] = { course: await page.locator("#main .under").innerText(), line: (await last(page).count()) ? await last(page).innerText() : null };
  });
  return out;
}
// Presses Download and reads back what arrived.
async function download(page) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = new Uint8Array(readFileSync(await d.path()));
  return { name: d.suggestedFilename(), book: await readBook(bytes), zip: unzipSync(bytes) };
}
const sheetOf = (dl, name) => dl.book.find((s) => s.name === name).rows;
// Takes the first placed teacher off their course, through the screens.
async function moveOne(page) {
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.getByRole("button", { name: "Not placed", exact: true }).click();
}

test("ten files build the expected draft", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await goTen(page);
  const result = page.locator("[data-result]");
  await expect(result).toHaveAttribute("data-placed", String(expected.placedMin));
  await expect(result).toHaveAttribute("data-running", String(expected.runningMin));
  // The second value is what last year changes: those who got none of their choices, now on a 1st to 4th choice.
  const counts = sheetOf(await download(page), "Last year");
  expect(counts.find((r) => r[0] === "None")[counts[0].indexOf("Top 4")]).toBe(String(expected.values[1]));
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});

test("three of the four past files keep Build locked and say which is missing", async ({ page }) => {
  for (const missing of PAST_SLOTS) {
    await page.goto("/");
    await page.locator('[data-k="files"]').setInputFiles(tenFiles().filter((p) => basename(p) !== missing));
    await expect(slot(page, missing)).toHaveText(`${missing}: file not added`);
    await expect(page.locator("[data-slot]")).toHaveCount(10);
    await expect(ready(page)).toHaveCount(9);
    await expect(buildButton(page)).toBeDisabled();
  }
  await page.locator('[data-k="files"]').setInputFiles(pastFiles.at(-1));
  await expect(ready(page)).toHaveCount(10);
  await expect(buildButton(page)).toBeEnabled();
});

test("past files can arrive in a second drop, and a re-dropped allocation replaces the old one", async ({ page }) => {
  const { unmatched } = await fixture();
  const good = pastFiles[0];
  const allMatched = await variantAllocation((rows) => rows.forEach((r) => r.forEach((c, i) => { if (unmatched.includes(c)) r[i] = null; })));
  const twice = await variantAllocation((rows) => { rows[2][2] = rows[1][2]; });
  await page.goto("/");
  await dropFiles(page, schoolFiles());
  await expect(buildButton(page)).toBeEnabled();
  await dropFiles(page, pastFiles.slice(0, 2));
  await expect(ready(page)).toHaveCount(8);
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(2);
  await expect(buildButton(page)).toBeDisabled();
  await dropFiles(page, pastFiles.slice(2));
  await expect(ready(page)).toHaveCount(10);
  await expect(rightOf(page, ALLOCATION)).toHaveText(`ready, ${unmatched.length} not matched`);
  await expect(buildButton(page)).toBeEnabled();

  await dropFiles(page, [twice]);
  await expect(slot(page, ALLOCATION)).toHaveText(`${ALLOCATION}, row 3: sponsor appears twice in this file`);
  await expect(buildButton(page)).toBeDisabled();
  await dropFiles(page, [allMatched]);
  await expect(rightOf(page, ALLOCATION)).toHaveText("ready");
  await expect(buildButton(page)).toBeEnabled();

  // Two drops in the same moment: the later one wins, whichever finished reading first.
  await dropFiles(page, [twice], [good]);
  await expect(rightOf(page, ALLOCATION)).toHaveText(`ready, ${unmatched.length} not matched`);
  await expect(buildButton(page)).toBeEnabled();
  await dropFiles(page, [good], [twice]);
  await expect(slot(page, ALLOCATION)).toContainText("sponsor appears twice");
  await expect(buildButton(page)).toBeDisabled();
  await dropFiles(page, [good]);
  await expect(buildButton(page)).toBeEnabled();

  // A file with any other name still gets its own line, after the ten, and does not hold up Build.
  await dropFiles(page, [tempFile("notes.xlsx", "x")]);
  await expect(slot(page, "notes.xlsx")).toHaveText("notes.xlsx: not one of the six file names");
  expect(await page.locator("[data-slot]").evaluateAll((els) => els.map((e) => e.dataset.slot))).toEqual([...SLOTS, ...PAST_SLOTS, "notes.xlsx"]);
  await expect(buildButton(page)).toBeEnabled();
});

test("the allocation row shows how many were not matched, as a number only", async ({ page }) => {
  const { unmatched } = await fixture();
  expect(unmatched.length).toBeGreaterThan(0);
  await dropTen(page);
  await expect(rightOf(page, ALLOCATION)).toHaveText(`ready, ${unmatched.length} not matched`);
  for (const file of PAST_SLOTS.slice(1)) await expect(rightOf(page, file)).toHaveText("ready");
  // A ready past row looks like a ready row of the six.
  for (const file of PAST_SLOTS) await expect(slot(page, file)).toHaveClass(await slot(page, SLOTS[0]).getAttribute("class"));
  await expect(page.locator("[data-big]")).toHaveText("Drop the six files here");
  const dom = await domText(page);
  for (const entry of unmatched) expect(dom).not.toContain(entry);
});

test("a teacher card shows its last-year line, and the reason is unchanged", async ({ page }) => {
  test.setTimeout(120_000);
  const { lastYear } = await fixture();
  await goTen(page);
  await names(page).click();
  let shown = 0;
  await eachCard(page, async () => {
    const want = lineFor(lastYear.get(await emailShown(page).innerText()));
    await expect(last(page)).toHaveCount(want ? 1 : 0);
    if (want) {
      // Its own line, directly under the reason.
      await expect(page.locator("#main .why + [data-last]")).toBeVisible();
      await expect(last(page)).toHaveText(want);
      shown += 1;
    }
    await expect(page.locator("#main .why")).toHaveText(/^Why\s+\S/);
    await expect(page.locator("#main .why")).not.toContainText(/last year/i);
  });
  expect(shown).toBe([...lastYear.values()].filter(Boolean).length);
  expect(shown).toBeGreaterThan(0);
});

test("a To do item never shows the last-year line, and the same teacher's opened card does", async ({ page }) => {
  const { lastYear } = await fixture();
  await goTen(page);
  const n = await todoCount(page);
  // With names off a teacher's own item is headed by their T number, and only it carries a reason.
  const ids = [];
  for (let i = 0; i < n; i++) {
    await expect(last(page)).toHaveCount(0);
    if (await page.locator("#main [data-panel] .why").count()) ids.push(await page.locator("#main [data-panel] h2").innerText());
    await nextItem(page);
  }
  await tab(page, "Teachers").click();
  await names(page).click();
  let shown = 0;
  for (const id of ids) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    const want = lineFor(lastYear.get(await emailShown(page).innerText()));
    await expect(last(page)).toHaveCount(want ? 1 : 0);
    if (want) {
      await expect(last(page)).toBeVisible();
      await expect(last(page)).toHaveText(want);
      shown += 1;
    }
    await page.getByRole("button", { name: "Back" }).click();
  }
  expect(shown).toBeGreaterThan(0);
});

test("search for 'none of their' lists only those teachers", async ({ page }) => {
  const { lastYear } = await fixture();
  const none = [...lastYear.values()].filter((was) => was && was.result === "none").length;
  expect(none).toBeGreaterThan(0);
  await goTen(page);
  await tab(page, "Teachers").click();
  const rows = page.locator("#main [data-row][data-teacher]:visible");
  await expect(rows).toHaveCount(TEACHERS);
  await search(page).fill("none of their");
  await expect(rows).toHaveCount(none);
  // The rows themselves do not change: T number and course, as before.
  expect(await rows.first().locator("span").count()).toBe(2);
  for (const id of await rows.evaluateAll((els) => els.map((e) => e.dataset.teacher))) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    await expect(last(page)).toHaveText("Last year: none of their choices");
    await page.getByRole("button", { name: "Back" }).click();
  }
  await expect(rows).toHaveCount(none);
});

test("search finds the download's labels too", async ({ page }) => {
  const { lastYear } = await fixture();
  const withResult = (result) => [...lastYear.values()].filter((was) => was && was.result === result).length;
  await goTen(page);
  await tab(page, "Teachers").click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  const rows = page.locator("#main [data-row][data-teacher]:visible");
  await expect(rows).toHaveCount(TEACHERS);
  for (const [typed, result, n] of [["top 4", "top4", 52], ["5 to 7", "5to7", 7], ["not found", "notFound", 1], ["none", "none", 11]]) {
    expect(withResult(result), typed).toBe(n);
    await search(page).fill(typed);
    await expect(rows, typed).toHaveCount(n);
  }
  // The label is in the search text only: a row still shows its T number and course, nothing more.
  expect(await rows.first().locator("span").count()).toBe(2);
  expect(await page.locator("#main [data-rows]").innerText()).not.toMatch(/top 4|5 to 7|not found|none/i);
});

test("Build is in view once ten files are ready, on a short window", async ({ page }) => {
  const short = { width: 1366, height: 680 };
  await page.setViewportSize(short);
  await startTen(page);
  const box = await buildButton(page).boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(short.height);
});

test("six files alone never move the page, however short the window", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 360 });
  await dropSchool(page);
  const box = await buildButton(page).boundingBox();
  expect(box.y + box.height).toBeGreaterThan(360);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("Start with a past file refused fits first", async ({ page }) => {
  watchPage(page);
  await startTen(page);
  await dropFiles(page, [await variantAllocation((rows) => { rows[2][2] = rows[1][2]; })]);
  await expect(slot(page, ALLOCATION)).toHaveText(`${ALLOCATION}, row 3: sponsor appears twice in this file`);
  await measure(page, "first");
  await dropFiles(page, [await variantAllocation((rows) => { rows[2][5] = rows[1][2]; })]);
  await expect(slot(page, ALLOCATION)).toHaveText(`${ALLOCATION}, row 3: value outside the headed columns`);
  await measure(page, "first");
});

test("Start with all ten ready fits first", async ({ page }) => {
  watchPage(page);
  await startTen(page);
  await measure(page, "first");
});

test("Start with one past file missing fits first", async ({ page }) => {
  watchPage(page);
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(tenFiles().slice(0, -1));
  await expect(ready(page)).toHaveCount(9);
  await expect(page.locator("[data-slot]")).toHaveCount(10);
  await measure(page, "first");
});

test("every To do item fits first with past files", async ({ page }) => {
  watchPage(page);
  await goTen(page);
  const n = await todoCount(page);
  for (let i = 0; i < n; i++) { await measure(page, "first"); await nextItem(page); }
});

test("a To do item still fits first with past files once Undo is showing", async ({ page }) => {
  watchPage(page);
  await goTen(page);
  await toItem(page, /with no form$/);
  await page.getByRole("button", { name: "Leave them unplaced" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  // Undo is one more word on every item, and a teacher's own item is the fullest.
  const n = await todoCount(page);
  let own = 0;
  for (let i = 0; i < n; i++) {
    own += await page.locator("#main [data-panel] .why").count();
    await measure(page, "first");
    await nextItem(page);
  }
  expect(own).toBeGreaterThan(0);
});

test("every open teacher card fits detail with past files", async ({ page }) => {
  test.setTimeout(120_000);
  watchPage(page);
  await goTen(page);
  let shown = 0;
  await eachCard(page, async () => {
    shown += await last(page).count();
    await measure(page, "detail");
  });
  expect(shown).toBeGreaterThan(0);
});

test("Teachers fits list with past files", async ({ page }) => {
  watchPage(page);
  await goTen(page);
  await tab(page, "Teachers").click();
  await measure(page, "list");
  await search(page).fill("none of their");
  await measure(page, "list");
});

test("with names off no name, email or unmatched entry is in the DOM on any screen", async ({ page }) => {
  test.setTimeout(120_000);
  const secrets = await hidden();
  for (const entry of (await fixture()).unmatched) expect(secrets).toContain(entry);
  const check = async (where) => {
    const dom = await domText(page);
    expect(secrets.filter((s) => dom.includes(s)), where).toEqual([]);
  };
  await startTen(page);
  await check("Start, ten ready");
  await buildDraft(page);
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await walk(page, check);
});

test("names on, move, names off, download: no name, email or unmatched entry in any raw XML part", async ({ page }) => {
  const secrets = await hidden();
  const { unmatched } = await fixture();
  await goTen(page);
  await names(page).click();
  const on = await download(page);
  expect(on.name).toMatch(/with names\.xlsx$/);
  for (const entry of unmatched) expect(strFromU8(on.zip["xl/sharedStrings.xml"])).toContain(entry);
  await moveOne(page);
  await names(page).click();
  const off = await download(page);
  expect(off.name).toMatch(/T numbers\.xlsx$/);
  expect(Object.keys(off.zip).length).toBeGreaterThan(5);
  for (const [path, data] of Object.entries(off.zip)) {
    const text = strFromU8(data);
    expect(secrets.filter((s) => text.includes(s)), path).toEqual([]);
  }
  expect(off.book.map((s) => s.name)).toEqual(["Courses", "Teachers", "Changes", "Last year", "Note"]);
  expect(sheetOf(off, "Teachers")[0]).toEqual(["Teacher", "Course", "Choice", "Last year", "Why", "Status"]);
});

test("forbidden words are gone on every past screen", async ({ page }) => {
  test.setTimeout(120_000);
  const check = async (where) => expect(forbiddenIn(await visibleStrings(page)), where).toEqual([]);
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(tenFiles().slice(0, -1));
  await expect(ready(page)).toHaveCount(9);
  await check("Start, one past file missing");
  await page.locator('[data-k="files"]').setInputFiles(pastFiles.at(-1));
  await expect(rightOf(page, ALLOCATION)).toContainText("not matched");
  await check("Start, ten ready");
  await buildDraft(page);
  await walk(page, check);
  await names(page).click();
  await check("Names on");
});

test("reload shows the same draft and last-year lines with no re-upload", async ({ page }) => {
  test.setTimeout(120_000);
  const { lastYear } = await fixture();
  await goTen(page);
  await expect(page.locator("[data-saved]")).toHaveAttribute("data-version", "1");
  const before = await cards(page);
  expect(Object.values(before).filter((c) => c.line).length).toBe([...lastYear.values()].filter(Boolean).length);
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  await expect(page.locator("[data-slot]")).toHaveCount(0);
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  expect(await cards(page)).toEqual(before);
});

test("six files alone: no [data-last] anywhere and the workbook has no Last year column or sheet", async ({ page }) => {
  test.setTimeout(120_000);
  await dropSchool(page);
  expect(await page.locator("[data-slot]").evaluateAll((els) => els.map((e) => e.dataset.slot))).toEqual(SLOTS);
  for (const file of SLOTS) await expect(rightOf(page, file)).toHaveText("ready");
  await buildDraft(page);
  await walk(page, (where) => expect(page.locator("[data-last]"), where).toHaveCount(0));
  await tab(page, "Teachers").click();
  await search(page).fill("last year");
  await expect(page.locator("#main [data-row][data-teacher]:visible")).toHaveCount(0);
  for (const on of [false, true]) {
    if (on) await names(page).click();
    const dl = await download(page);
    expect(dl.book.map((s) => s.name)).toEqual(on ? ["Courses", "Teachers", "Changes"] : ["Courses", "Teachers", "Changes", "Note"]);
    expect(sheetOf(dl, "Teachers")[0]).not.toContain("Last year");
  }
});

test("a full run with ten files makes zero outside requests", async ({ page, context }) => {
  const seen = [];
  page.on("request", (r) => seen.push(r.url()));
  context.on("request", (r) => seen.push(r.url()));
  await goTen(page);
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.locator('#main [data-act="moveTo"]:not([data-c=""])').first().click();
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await names(page).click();
  await names(page).click();
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  await d.path();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((u) => !u.startsWith(ORIGIN))).toEqual([]);
});
