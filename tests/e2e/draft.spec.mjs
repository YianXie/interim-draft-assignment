import { test, expect } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { readBook } from "../../src/xlsx.js";
import { buildButton, buildDraft, dropFiles, dropSchool, measure, measureStart, schoolFiles, variantSchool, visibleStrings, watchPage } from "./helpers.mjs";
import { forbiddenIn } from "./words.mjs";

const expected = JSON.parse(readFileSync("fixtures/expected.json", "utf8"));
const TODO_COUNT = 11;

const staff = async () => {
  const [sheet] = await readBook(readFileSync("fixtures/school/staff.xlsx"));
  return sheet.rows.slice(1).map(([email, name]) => ({ email, name }));
};
const dirs = [];
const variant = async (edit) => { const d = await variantSchool(edit); dirs.push(d); return d; };
test.afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const badCourses = () => variant((file, rows) => { if (file === "courses.xlsx") rows[1][3] = "two"; });
const slot = (page, file) => page.locator(`[data-slot="${file}"]`);
const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const teacherIds = (page) => page.locator("#main [data-row][data-teacher]").evaluateAll((els) => els.map((e) => e.dataset.teacher));
// Whole document as HTML, plus live input values, which outerHTML does not carry.
const domText = (page) => page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input")].map((i) => i.value).join("\n"));
const expectNoPeople = async (page, people) => {
  const dom = await domText(page);
  for (const p of people) { expect(dom).not.toContain(p.name); expect(dom).not.toContain(p.email); }
};
async function goBuild(page) { await dropSchool(page); await buildDraft(page); }
const nextItem = (page) => page.getByRole("button", { name: "Next", exact: true }).click();
// Reaches a To do item of this kind by pressing Next.
async function toItem(page, text) {
  for (let i = 0; i < TODO_COUNT; i++) {
    if (await page.getByText(text).count()) return;
    await nextItem(page);
  }
  throw new Error(`no To do item shows ${text}`);
}
// Every screen of a built draft, with names left off. Calls check(where) at each stop; ends on Who asked.
async function walkDraft(page, check) {
  for (let i = 0; i < TODO_COUNT; i++) { await check(`To do ${i}`); await nextItem(page); }
  await tab(page, "Teachers").click();
  await check("Teachers");
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await check("Teacher");
  await page.getByRole("button", { name: "All options" }).click();
  await check("Move");
  // Taking a sponsor off a course leaves it short, which brings up the Could sponsor rows.
  await page.getByRole("button", { name: "Not placed", exact: true }).click();
  await check("Teacher, moved");
  await tab(page, /^To do/).click();
  await toItem(page, "Could sponsor");
  await check("Could sponsor");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await check("History");
  await tab(page, "Courses").click();
  await check("Courses");
  await page.locator("#main [data-row][data-course]").first().click();
  await check("Course");
  await page.getByRole("button", { name: /^Who asked/ }).click();
  await check("Who asked");
}

test("Build stays locked until all six files are ready", async ({ page }) => {
  await page.goto("/");
  await expect(buildButton(page)).toBeDisabled();
  const files = schoolFiles();
  for (let i = 0; i < files.length - 1; i++) {
    await page.locator('[data-k="files"]').setInputFiles(files[i]);
    await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(i + 1);
    await expect(buildButton(page)).toBeDisabled();
  }
  await page.locator('[data-k="files"]').setInputFiles(files[5]);
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(6);
  await expect(buildButton(page)).toBeEnabled();
});

test("files can arrive in two drops, and a re-dropped file replaces the old one", async ({ page }) => {
  const bad = await badCourses();
  const good = schoolFiles();
  await page.goto("/");
  await dropFiles(page, good.slice(0, 3));
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(3);
  await expect(buildButton(page)).toBeDisabled();
  await dropFiles(page, good.slice(3));
  await expect(buildButton(page)).toBeEnabled();

  await dropFiles(page, [join(bad, "courses.xlsx")]);
  await expect(slot(page, "courses.xlsx")).toContainText("seats must be");
  await expect(buildButton(page)).toBeDisabled();

  // Two drops in the same moment: the later one wins, whichever finished reading first.
  await dropFiles(page, [join(bad, "courses.xlsx")], [good[0]]);
  await expect(slot(page, "courses.xlsx")).toContainText("ready");
  await expect(buildButton(page)).toBeEnabled();
  await dropFiles(page, [good[0]], [join(bad, "courses.xlsx")]);
  await expect(slot(page, "courses.xlsx")).toContainText("seats must be");
  await expect(buildButton(page)).toBeDisabled();
});

test("a bad file shows one plain line and Build stays locked", async ({ page }) => {
  await dropSchool(page);
  await page.locator('[data-k="files"]').setInputFiles(join(await badCourses(), "courses.xlsx"));
  await expect(slot(page, "courses.xlsx").locator("[data-line]")).toHaveText("Row 2: seats must be a positive whole number");
  await expect(buildButton(page)).toBeDisabled();
  await page.locator('[data-k="files"]').setInputFiles({ name: "notes.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(slot(page, "notes.xlsx")).toHaveText("notes.xlsx: not one of the six file names");
  await expect(buildButton(page)).toBeDisabled();
});

test("a stray file keeps its line but does not lock Build", async ({ page }) => {
  await page.goto("/");
  const payload = schoolFiles().map((p) => ({ name: basename(p), mimeType: "application/octet-stream", buffer: readFileSync(p) }));
  await page.locator('[data-k="files"]').setInputFiles([...payload, { name: "courses (1).xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") }]);
  await expect(slot(page, "courses (1).xlsx")).toHaveText("courses (1).xlsx: not one of the six file names");
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(6);
  await expect(buildButton(page)).toBeEnabled();
  await buildDraft(page);
});

test("reload before Build returns to an empty Start", async ({ page }) => {
  await dropSchool(page);
  await page.reload();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(0);
  await expect(buildButton(page)).toBeDisabled();
  await expect(page.locator("[data-result]")).toHaveCount(0);
});

test("Build gives the expected result", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await goBuild(page);
  const result = page.locator("[data-result]");
  await expect(result).toHaveAttribute("data-placed", String(expected.placedMin));
  await expect(result).toHaveAttribute("data-running", String(expected.runningMin));
  await expect(page.getByText("best draft found")).toBeVisible();
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});

test("a Build that cannot finish shows the one fixed line", async ({ page }) => {
  await page.route("**/highs.wasm", (route) => route.abort());
  await dropSchool(page);
  await buildButton(page).click();
  await expect(page.locator("[data-big]")).toHaveText("Couldn't build a draft. Reload and try again.", { timeout: 60_000 });
  await expect(page.locator("[data-result]")).toHaveCount(0);
});

test("big line equals the number of To do items", async ({ page }) => {
  await goBuild(page);
  const big = page.locator("[data-big]");
  await expect(big).toHaveText(`${TODO_COUNT} things need you`);
  const seen = new Set();
  for (let i = 0; i < TODO_COUNT; i++) {
    seen.add(await page.locator("#main h2").innerText());
    await nextItem(page);
  }
  expect(seen.size).toBe(TODO_COUNT);
  await tab(page, "Teachers").click();
  await expect(big).toHaveText(`${TODO_COUNT} things need you`);
  await tab(page, "Courses").click();
  await expect(big).toHaveText(`${TODO_COUNT} things need you`);
});

test("the no-form item shows the count and list, and Leave them unplaced, Undo and History work", async ({ page }) => {
  await goBuild(page);
  await toItem(page, /with no form$/);
  const count = parseInt(await page.locator("#main h2").innerText(), 10);
  await expect(page.locator("#main [data-row][data-teacher]")).toHaveCount(count);
  await page.getByRole("button", { name: "Leave them unplaced" }).click();
  await expect(page.locator("[data-big]")).toHaveText(`${TODO_COUNT - 1} things need you`);
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-big]")).toHaveText(`${TODO_COUNT} things need you`);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText("First draft built from the forms")).toBeVisible();
});

test("a teacher's card moves them, and the move screen has Not placed", async ({ page }) => {
  await goBuild(page);
  await tab(page, "Teachers").click();
  // T numbers are random, so the first row may be someone not placed, who has no Not placed link.
  const first = page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first();
  const id = await first.getAttribute("data-teacher");
  await first.click();
  await expect(page.getByRole("heading", { name: id })).toBeVisible();
  await page.getByRole("button", { name: "All options" }).click();
  await expect(page.getByRole("heading", { name: `Move ${id}` })).toBeVisible();
  await page.getByRole("button", { name: "Not placed", exact: true }).click();
  await expect(page.locator("#main .under")).toHaveText("Not placed");
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#main .under")).not.toHaveText("Not placed");
});

test("names are off at start and no invented name or email is in the DOM", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await walkDraft(page, () => expectNoPeople(page, people));
});

test("the switch shows names and hides them again", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  await tab(page, "Teachers").click();
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  expect(await domText(page)).toContain(people[0].name);
  await page.locator("#main [data-row][data-teacher]").first().click();
  await expect(page.getByText(/@fernhollow\.example$/)).toBeVisible();
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await expectNoPeople(page, people);
});

test("search by a name with names off finds nothing", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  await tab(page, "Teachers").click();
  const rows = page.locator("#main [data-row][data-teacher]:visible");
  await page.getByPlaceholder("Search").fill(people[0].name);
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No matches")).toBeVisible();
  await names(page).click();
  await expect(rows).toHaveCount(1);
  // Turning names off also clears what was typed, so no name stays in the search box.
  await names(page).click();
  await expect(page.getByPlaceholder("Search")).toHaveValue("");
  await expect(rows).toHaveCount(96);
  await expectNoPeople(page, people);
});

test("teacher row order does not change when invented names change", async ({ page }) => {
  const renamed = await variant((file, rows) => {
    if (file !== "staff.xlsx") return;
    const list = rows.slice(1).map((r) => r[1]).reverse();
    rows.slice(1).forEach((r, i) => { r[1] = list[i]; });
  });
  for (const dir of ["fixtures/school", renamed]) {
    await dropSchool(page, dir);
    await buildDraft(page);
    await tab(page, "Teachers").click();
    const ids = await teacherIds(page);
    expect(ids).toHaveLength(96);
    expect(ids).toEqual([...ids].sort());
    // A built draft is remembered, so the second school needs a Start of its own.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.locator("[data-slot]")).toHaveCount(6);
  }
});

test("special characters show literally", async ({ page }) => {
  const CODE = 'C"><i>x';
  let courseName, courseCode;
  const dir = await variant((file, rows) => {
    if (file === "courses.xlsx") { const r = rows.find((x) => x[4] === "Yes"); [courseCode, courseName] = r; r[0] = CODE; r[1] = "=SUM(1)"; }
    if (file === "staff.xlsx") rows[1][1] = "O'Neil <b>";
    if (file === "returning.xlsx") rows.slice(1).forEach((r) => { if (r[1] === courseCode) r[1] = CODE; });
    if (["round1.xlsx", "round2.xlsx", "singapore.xlsx"].includes(file)) {
      rows.slice(1).forEach((r) => r.forEach((c, i) => { if (c === courseName) r[i] = "=SUM(1)"; }));
    }
  });
  await dropSchool(page, dir);
  await buildDraft(page);
  await names(page).click();
  await tab(page, "Teachers").click();
  await page.getByPlaceholder("Search").fill("O'Neil");
  await expect(page.locator("#main [data-row][data-teacher]:visible")).toContainText("O'Neil <b>");
  await expect(page.locator("#main b")).toHaveCount(0);
  await page.locator("#main [data-row][data-teacher]:visible").click();
  await expect(page.getByRole("heading", { name: "O'Neil <b>" })).toBeVisible();
  await tab(page, "Courses").click();
  await page.getByPlaceholder("Search").fill("=SUM(1)");
  await expect(page.locator("#main [data-row][data-course]:visible")).toContainText("=SUM(1)");
  await expect(page.locator("#main i")).toHaveCount(0);
  await page.locator("#main [data-row][data-course]:visible").click();
  await expect(page.getByRole("heading", { name: "=SUM(1)" })).toBeVisible();
});

test("forbidden words are gone on every screen", async ({ page }) => {
  const check = async (where) => expect(forbiddenIn(await visibleStrings(page)), where).toEqual([]);
  await page.goto("/");
  await check("Start");
  await dropSchool(page);
  await check("Start, ready");
  await buildDraft(page);
  await walkDraft(page, check);
  await names(page).click();
  await check("Names on");
  await page.getByRole("button", { name: "History" }).click();
  await check("History");
});

test("Invented school is shown on Start and in the top bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#main").getByText("Invented school")).toBeVisible();
  await expect(page.getByText("Interim 2028")).toBeVisible();
  await dropSchool(page);
  await buildDraft(page);
  await expect(page.locator("#top").getByText("Invented school")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
});

const SCREENS = [
  ["Start", "start", (page) => page.goto("/")],
  ["To do", "first", goBuild],
  ["Teachers", "list", async (page) => { await goBuild(page); await tab(page, "Teachers").click(); }],
  ["Courses", "list", async (page) => { await goBuild(page); await tab(page, "Courses").click(); }],
  ["Open reason", "detail", async (page) => { await goBuild(page); await tab(page, "Teachers").click(); await page.locator("#main [data-row][data-teacher]").first().click(); }],
];
for (const [screen, budget, reach] of SCREENS) {
  test(`${screen} fits ${budget}`, async ({ page }) => {
    watchPage(page);
    await reach(page);
    await expect(page.locator("#main").getByRole("heading").first()).toBeVisible();
    await (budget === "start" ? measureStart(page) : measure(page, budget));
  });
}

test("Start with all six ready fits first", async ({ page }) => {
  watchPage(page);
  await dropSchool(page);
  await measureStart(page);
});

test("every To do item fits first", async ({ page }) => {
  watchPage(page);
  await goBuild(page);
  for (let i = 0; i < TODO_COUNT; i++) { await measure(page, "first"); await nextItem(page); }
});

test("To do still fits first once Undo is showing", async ({ page }) => {
  watchPage(page);
  await goBuild(page);
  await toItem(page, /with no form$/);
  await page.getByRole("button", { name: "Leave them unplaced" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await measure(page, "first");
});

test("every open reason fits detail", async ({ page }) => {
  watchPage(page);
  await goBuild(page);
  await tab(page, "Teachers").click();
  for (const id of await teacherIds(page)) {
    await page.locator(`[data-teacher="${id}"]`).click();
    await expect(page.getByRole("heading", { name: id })).toBeVisible();
    await measure(page, "detail");
    await page.getByRole("button", { name: "Back" }).click();
  }
});
