import { test, expect } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { readBook } from "../../src/xlsx.js";
import { buildDraft, dropSchool, variantSchool, watchPage } from "./helpers.mjs";
import { forbiddenIn } from "./words.mjs";

const dirs = [];
test.afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const staff = async () => {
  const [sheet] = await readBook(readFileSync("fixtures/school/staff.xlsx"));
  return sheet.rows.slice(1).map(([email, name]) => ({ email, name }));
};

async function goBuild(page, dir) { await dropSchool(page, dir); await buildDraft(page); }
// Presses Download and reads back what arrived. The press acts at once on the current switch.
async function download(page) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = new Uint8Array(readFileSync(await d.path()));
  return { name: d.suggestedFilename(), bytes, book: await readBook(bytes), zip: unzipSync(bytes) };
}
const sheetOf = (dl, name) => dl.book.find((s) => s.name === name).rows;
// Takes the first placed teacher off their course, through the screens.
async function moveOne(page) {
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.getByRole("button", { name: "Not placed", exact: true }).click();
}
const screenPairs = (page) => page.locator("#main [data-row][data-teacher]").evaluateAll((els) => els.map((e) => [...e.querySelectorAll("span")].map((s) => s.textContent)));

test("workbook equals the screen after moves", async ({ page }) => {
  await goBuild(page);
  await names(page).click();
  await moveOne(page);
  await tab(page, "Teachers").click();
  const screen = (await screenPairs(page)).sort();
  const dl = await download(page);
  const rows = sheetOf(dl, "Teachers");
  expect(rows[0]).toEqual(["Teacher", "Email", "Course", "Choice", "Why", "Status"]);
  expect(rows.slice(1).map((r) => [r[0], r[2] || "Not placed"]).sort()).toEqual(screen);
  expect(rows[1][5]).toBe("Not placed");
  const changes = sheetOf(dl, "Changes");
  expect(changes).toHaveLength(2);
  expect(changes[1][2]).toMatch(/^Moved .+ to not placed$/);
  // Courses: each course's sponsors are the ones the Courses tab lists.
  await tab(page, "Courses").click();
  const listed = await page.locator("#main [data-row][data-course]").evaluateAll((els) => els.map((e) => [e.querySelector("span").textContent, [...e.querySelectorAll(".pair span")].map((s) => s.textContent).sort()]));
  const courses = sheetOf(dl, "Courses");
  for (const [name, sponsors] of listed) {
    const r = courses.find((x) => x[1] === name);
    expect(r.slice(2, -1).filter(Boolean).sort()).toEqual(sponsors);
  }
});

test("names on, move, names off, download: no name or email in any raw XML part", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  await names(page).click();
  const on = await download(page);
  expect(on.name).toMatch(/with names\.xlsx$/);
  expect(strFromU8(on.zip["xl/sharedStrings.xml"])).toContain(people[0].name);
  await moveOne(page);
  await names(page).click();
  const off = await download(page);
  expect(off.name).toMatch(/T numbers\.xlsx$/);
  expect(Object.keys(off.zip).length).toBeGreaterThan(5);
  for (const [path, data] of Object.entries(off.zip)) {
    const text = strFromU8(data);
    for (const p of people) { expect(text, path).not.toContain(p.name); expect(text, path).not.toContain(p.email); }
  }
  expect(off.book.map((s) => s.name)).toEqual(["Courses", "Teachers", "Changes", "Note"]);
  expect(sheetOf(off, "Teachers")[0]).not.toContain("Email");
});

test("forbidden words are not in the workbook", async ({ page }) => {
  await goBuild(page);
  for (const on of [false, true]) {
    if (on) await names(page).click();
    const dl = await download(page);
    expect(forbiddenIn(dl.book.flatMap((s) => [s.name, ...s.rows.flat().map(String)]))).toEqual([]);
  }
});

test("file name contains invented", async ({ page }) => {
  await goBuild(page);
  expect((await download(page)).name).toBe("Fernhollow invented draft v1 T numbers.xlsx");
  await names(page).click();
  expect((await download(page)).name).toBe("Fernhollow invented draft v1 with names.xlsx");
  await moveOne(page);
  expect((await download(page)).name).toBe("Fernhollow invented draft v2 with names.xlsx");
});

test("the Download tooltip says which version the press gives", async ({ page }) => {
  await goBuild(page);
  const button = page.getByRole("button", { name: "Download", exact: true });
  await expect(button).toHaveAttribute("title", "Download with T numbers");
  expect((await download(page)).name).toContain("T numbers");
  await names(page).click();
  await expect(button).toHaveAttribute("title", "Download with names");
  expect((await download(page)).name).toContain("with names");
  await names(page).click();
  await expect(button).toHaveAttribute("title", "Download with T numbers");
});

test("a name such as O'Neil <b> and a course named =SUM(1) stay text in the file", async ({ page }) => {
  const CODE = 'C"><i>x';
  let courseName, courseCode;
  const dir = await variantSchool((file, rows) => {
    if (file === "courses.xlsx") { const r = rows.find((x) => x[4] === "Yes"); [courseCode, courseName] = r; r[0] = CODE; r[1] = "=SUM(1)"; }
    if (file === "staff.xlsx") rows[1][1] = "O'Neil <b>";
    if (file === "returning.xlsx") rows.slice(1).forEach((r) => { if (r[1] === courseCode) r[1] = CODE; });
    if (["round1.xlsx", "round2.xlsx", "singapore.xlsx"].includes(file)) {
      rows.slice(1).forEach((r) => r.forEach((c, i) => { if (c === courseName) r[i] = "=SUM(1)"; }));
    }
  });
  dirs.push(dir);
  await goBuild(page, dir);
  await names(page).click();
  const dl = await download(page);
  expect(sheetOf(dl, "Teachers").map((r) => r[0])).toContain("O'Neil <b>");
  expect(sheetOf(dl, "Courses").map((r) => [r[0], r[1]])).toContainEqual([CODE, "=SUM(1)"]);
  // The raw sheets: every cell is a string cell and nothing is a formula.
  for (const [path, data] of Object.entries(dl.zip)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(data);
    for (const m of xml.matchAll(/<c [^>]*>/g)) expect(m[0], path).toMatch(/ t="s"/);
    expect(xml).not.toMatch(/<f[ >]/);
  }
  expect(strFromU8(dl.zip["xl/sharedStrings.xml"])).toContain("<t>=SUM(1)</t>");
});

test("Download needs no network and the policy stays untouched", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await goBuild(page);
  await download(page);
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});
