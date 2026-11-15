import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { FIT, SLOTS } from "../../src/import.js";
import { readBook } from "../../src/xlsx.js";
import { buildButton, buildDraft, dropFiles, dropSchool, measure, measureStart, schoolFiles, visibleStrings, watchPage } from "./helpers.mjs";
import { cleanUp, dropSeven, expectedLines, factsAndQuotes, fitFile, sevenFiles, variantFit } from "./fit-helpers.mjs";
import { forbiddenIn } from "./words.mjs";
import { pastFiles } from "../unit/past-fixture.mjs";

const ORIGIN = "http://127.0.0.1:4173";
const TEACHERS = 96;
const BAD_KIND = "Row 2: kind must be Language, Certificate, Experience, Skill or Limitation";

test.afterAll(cleanUp);

const slot = (page, file) => page.locator(`[data-slot="${file}"]`);
const rightOf = (page, file) => slot(page, file).locator("[data-line]");
const placeholder = (page) => page.locator(`[data-placeholder="${FIT}"]`);
const slotNames = (page) => page.locator("[data-slot]").evaluateAll((els) => els.map((e) => e.dataset.slot));
const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const search = (page) => page.getByPlaceholder("Search");
const teacherRows = (page) => page.locator("#main [data-row][data-teacher]");
const fitLine = (page) => page.locator("#main [data-fit]");
const back = (page) => page.getByRole("button", { name: "Back" }).click();
// Whole document as HTML, so every attribute, plus live input values, which outerHTML does not carry.
const domText = (page) => page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input")].map((i) => i.value).join("\n"));
const badKind = () => variantFit((rows) => { rows[1][2] = "Hobby"; });
// Every Fact made unique, so a Fact can be looked for without matching the course of the same name.
const markedFit = () => variantFit((rows) => rows.slice(1).forEach((r, i) => { r[3] = `Fact ${i + 1} ${r[3]}`; }));

async function goSeven(page, fit) {
  await dropSeven(page, fit);
  await buildDraft(page);
}
async function toTeachers(page) {
  await tab(page, "Teachers").click();
  await expect(teacherRows(page)).toHaveCount(TEACHERS);
}
// Each teacher's expected line, worked out from the Teachers tab with names on; leaves names on.
async function linesOn(page) {
  await toTeachers(page);
  if ((await names(page).getAttribute("aria-checked")) !== "true") await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  return { on: await expectedLines(page, true), off: await expectedLines(page, false) };
}
const openCard = async (page, id) => {
  await page.locator(`#main [data-teacher="${id}"]`).click();
  await expect(page.locator("#main .why")).toBeVisible();
};
// The line each listed teacher's card shows now, by T number.
async function shownLines(page, ids) {
  const out = {};
  for (const id of ids) {
    await openCard(page, id);
    out[id] = (await fitLine(page).count()) ? await fitLine(page).innerText() : null;
    await back(page);
  }
  return out;
}
async function download(page) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = new Uint8Array(readFileSync(await d.path()));
  return { name: d.suggestedFilename(), book: await readBook(bytes), zip: unzipSync(bytes) };
}
async function moveOne(page) {
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.getByRole("button", { name: "Not placed", exact: true }).click();
}

test("Start shows fit.xlsx as optional and Build does not wait for it", async ({ page }) => {
  await dropSchool(page);
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(6);
  expect(await slotNames(page)).toEqual(SLOTS);
  await expect(placeholder(page)).toBeVisible();
  await expect(placeholder(page)).toContainText("Optional: what the reader found in the answers, checked by the office");
  await expect(placeholder(page).locator("[data-line]")).toHaveText("file not added");
  // Right after the six, on the This year tab.
  await expect(page.locator(`[data-start-panel="now"] [data-slot="${SLOTS.at(-1)}"] + [data-placeholder="${FIT}"]`)).toHaveCount(1);
  await expect(buildButton(page)).toBeEnabled();
});

test("fit.xlsx ready, build, a teacher with a fit shows the line", async ({ page }) => {
  test.setTimeout(180_000);
  await dropSeven(page);
  await expect(placeholder(page)).toHaveCount(0);
  expect(await slotNames(page)).toEqual([...SLOTS, FIT]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await buildDraft(page);
  const want = await linesOn(page);
  const ids = Object.keys(want.on);
  const withLine = ids.filter((id) => want.on[id]);
  expect(withLine.length).toBeGreaterThan(0);
  // Every kind of line the fixture gives: Facts for their course, and only a count when none is for their course.
  expect(withLine.some((id) => !/^From their form: \d+ in the download$/.test(want.on[id]))).toBe(true);
  expect(await shownLines(page, ids)).toEqual(want.on);
  // Names off: Kinds only, on the same cards.
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  const off = await shownLines(page, withLine);
  expect(off).toEqual(Object.fromEntries(withLine.map((id) => [id, want.off[id]])));
  // Its own line, under the reason; the reason does not carry it.
  await openCard(page, withLine[0]);
  await expect(page.locator("#main .why + [data-fit]")).toBeVisible();
  await expect(page.locator("#main .why")).not.toContainText("From their form");
});

test("a To do item never shows the fit line", async ({ page }) => {
  await goSeven(page);
  const n = Number((await tab(page, /^To do/).innerText()).replace(/\D/g, ""));
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    await expect(fitLine(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
});

test("search finds a teacher by Fact with names on only", async ({ page }) => {
  await goSeven(page);
  const want = await linesOn(page);
  const rows = page.locator("#main [data-row][data-teacher]:visible");
  // "First aid" is a Fact with no course in the fixture, and no course is called that.
  await search(page).fill("first aid");
  await expect(rows).not.toHaveCount(0);
  const found = await rows.evaluateAll((els) => els.map((e) => e.dataset.teacher));
  expect(found.every((id) => want.on[id])).toBe(true);
  // The rows themselves do not change: name and course, as before.
  expect(await rows.first().locator("span").count()).toBe(2);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await search(page).fill("first aid");
  await expect(rows).toHaveCount(0);
});

test("a refused fit.xlsx locks Build with one line", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(sevenFiles(await badKind()));
  await expect(rightOf(page, FIT)).toHaveText(BAD_KIND);
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(6);
  await expect(buildButton(page)).toBeDisabled();
  // The good file, dropped again, unlocks it.
  await dropFiles(page, [fitFile]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await expect(buildButton(page)).toBeEnabled();
});

test("fit.xlsx dropped first, then the six", async ({ page }) => {
  await page.goto("/");
  await dropFiles(page, [fitFile]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await expect(buildButton(page)).toBeDisabled();
  await dropFiles(page, schoolFiles());
  await expect(page.locator("[data-slot]", { hasText: "ready" })).toHaveCount(7);
  await expect(buildButton(page)).toBeEnabled();
  await buildDraft(page);
  await toTeachers(page);
  const ids = await teacherRows(page).evaluateAll((els) => els.map((e) => e.dataset.teacher));
  let shown = 0;
  for (const id of ids.slice(0, 20)) {
    await openCard(page, id);
    shown += await fitLine(page).count();
    await back(page);
  }
  expect(shown).toBeGreaterThan(0);
});

test("fit.xlsx dropped first is held to the staff list once the six arrive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await dropFiles(page, [await variantFit((rows) => { rows[1][0] = "nobody.here@fernhollow.example"; })]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await dropFiles(page, schoolFiles());
  await expect(rightOf(page, FIT)).toHaveText("Row 2: email is not on the staff list");
  await expect(buildButton(page)).toBeDisabled();
});

test("reload keeps the fit line", async ({ page }) => {
  test.setTimeout(120_000);
  await goSeven(page);
  await expect(page.locator("[data-saved]")).toHaveAttribute("data-version", "1");
  const want = await linesOn(page);
  const ids = Object.keys(want.on).filter((id) => want.on[id]).slice(0, 12);
  const before = await shownLines(page, ids);
  expect(Object.values(before).every(Boolean)).toBe(true);
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  await expect(page.locator("[data-slot]")).toHaveCount(0);
  await toTeachers(page);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  expect(await shownLines(page, ids)).toEqual(before);
});

test("names off: no Fact or Quote anywhere in the page", async ({ page }) => {
  test.setTimeout(240_000);
  const fit = await markedFit();
  const secrets = await factsAndQuotes(fit);
  expect(secrets.length).toBeGreaterThan(100);
  const check = async (where) => {
    const dom = await domText(page);
    const seen = await visibleStrings(page);
    expect(secrets.filter((s) => dom.includes(s) || seen.some((x) => x.includes(s))), where).toEqual([]);
  };
  await dropSeven(page, fit);
  await check("Start, seven ready");
  await dropFiles(page, [await badKind()]);
  await expect(rightOf(page, FIT)).toHaveText(BAD_KIND);
  await check("Start, fit.xlsx refused");
  await dropFiles(page, [fit]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await buildDraft(page);
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await toTeachers(page);
  await check("Teachers");
  const ids = await teacherRows(page).evaluateAll((els) => els.map((e) => e.dataset.teacher));
  let lines = 0;
  for (const id of ids) {
    await openCard(page, id);
    lines += await fitLine(page).count();
    await check(`Teacher ${id}`);
    await back(page);
  }
  expect(lines).toBeGreaterThan(0);
  // With names on the Facts are there, so the check above can see them.
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  const domOn = await domText(page);
  expect(secrets.filter((s) => domOn.includes(s)).length).toBeGreaterThan(0);
  await search(page).fill("Fact 1 ");
  await expect(page.locator("#main [data-row][data-teacher]:visible")).not.toHaveCount(0);
  await search(page).fill("");
  // An edit made with names on leaves nothing behind once names are off again.
  await moveOne(page);
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await check("Names off again, on the moved teacher's card");
  await toTeachers(page);
  await check("Teachers, names off again");
  await page.getByRole("button", { name: "History" }).click();
  await check("History");
  await tab(page, /^To do/).click();
  await check("To do");
});

test("the download with names off holds no Fact or Quote", async ({ page }) => {
  const fit = await markedFit();
  const secrets = await factsAndQuotes(fit);
  await goSeven(page, fit);
  await names(page).click();
  const on = await download(page);
  expect(on.name).toMatch(/with names\.xlsx$/);
  expect(secrets.filter((s) => strFromU8(on.zip["xl/sharedStrings.xml"]).includes(s)).length).toBeGreaterThan(0);
  await moveOne(page);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  const off = await download(page);
  expect(off.name).toMatch(/T numbers\.xlsx$/);
  expect(Object.keys(off.zip).length).toBeGreaterThan(5);
  for (const [path, data] of Object.entries(off.zip)) {
    const text = strFromU8(data);
    expect(secrets.filter((s) => text.includes(s)), path).toEqual([]);
  }
  expect(off.book.find((s) => s.name === "Teachers").rows[0]).toContain("From their form");
});

test("budgets: Start with the fit row, and an opened teacher with a fit", async ({ page }) => {
  test.setTimeout(240_000);
  watchPage(page);
  await dropSchool(page);
  await expect(placeholder(page)).toBeVisible();
  await measureStart(page);
  await dropFiles(page, [await badKind()]);
  await expect(rightOf(page, FIT)).toHaveText(BAD_KIND);
  await measureStart(page);
  await dropFiles(page, [fitFile]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await measureStart(page);
  await buildDraft(page);
  const want = await linesOn(page);
  const withLine = Object.keys(want.on).filter((id) => want.on[id]);
  expect(withLine.length).toBeGreaterThan(0);
  for (const on of [true, false]) {
    if (!on) await names(page).click();
    await expect(names(page)).toHaveAttribute("aria-checked", String(on));
    for (const id of withLine) {
      await openCard(page, id);
      await expect(fitLine(page)).toHaveCount(1);
      await measure(page, "detail");
      await back(page);
    }
  }
});

test("budgets: Start with last year's four, without and with fit.xlsx", async ({ page }) => {
  watchPage(page);
  // The window the budgets are measured in, from the start, so Build is scrolled to in that window.
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles([...schoolFiles(), ...pastFiles]);
  await expect(buildButton(page)).toBeEnabled();
  // With last year's files in, an empty fit.xlsx row is not shown: Start is as it was.
  await expect(placeholder(page)).toHaveCount(0);
  await measureStart(page);
  await dropFiles(page, [fitFile]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await expect(buildButton(page)).toBeEnabled();
  await measureStart(page);
});

test("budgets: an opened teacher with a fit and a last-year line", async ({ page }) => {
  test.setTimeout(180_000);
  watchPage(page);
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles([...sevenFiles(), ...pastFiles]);
  await expect(buildButton(page)).toBeEnabled();
  await buildDraft(page);
  const want = await linesOn(page);
  const withLine = Object.keys(want.on).filter((id) => want.on[id]);
  let both = 0;
  for (const on of [true, false]) {
    if (!on) await names(page).click();
    await expect(names(page)).toHaveAttribute("aria-checked", String(on));
    for (const id of withLine) {
      await openCard(page, id);
      both += await page.locator("#main [data-last]").count();
      await measure(page, "detail");
      await back(page);
    }
  }
  expect(both).toBeGreaterThan(0);
});

test("no forbidden words and no outside requests", async ({ page, context }) => {
  test.setTimeout(180_000);
  const seen = [];
  page.on("request", (r) => seen.push(r.url()));
  context.on("request", (r) => seen.push(r.url()));
  const watch = watchPage(page);
  await watch.listenForCsp();
  const check = async (where) => expect(forbiddenIn(await visibleStrings(page)), where).toEqual([]);
  await dropSchool(page);
  await check("Start, fit.xlsx not added");
  await dropFiles(page, [await badKind()]);
  await expect(rightOf(page, FIT)).toHaveText(BAD_KIND);
  await check("Start, fit.xlsx refused");
  await dropFiles(page, [fitFile]);
  await expect(rightOf(page, FIT)).toHaveText("ready");
  await check("Start, seven ready");
  await buildDraft(page);
  const want = await linesOn(page);
  await check("Teachers, names on");
  await search(page).fill("first aid");
  await check("Teachers, searched");
  await search(page).fill("");
  const withLine = Object.keys(want.on).filter((id) => want.on[id]);
  for (const on of [true, false]) {
    if (!on) await names(page).click();
    await expect(names(page)).toHaveAttribute("aria-checked", String(on));
    for (const id of withLine) {
      await openCard(page, id);
      await check(`Teacher ${id}, names ${on ? "on" : "off"}`);
      await back(page);
    }
    const dl = await download(page);
    const cells = dl.book.flatMap((s) => [s.name, ...s.rows.flat()]).filter((c) => c !== null && c !== undefined).map(String);
    expect(forbiddenIn(cells), `workbook, names ${on ? "on" : "off"}`).toEqual([]);
  }
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((u) => !u.startsWith(ORIGIN))).toEqual([]);
});
