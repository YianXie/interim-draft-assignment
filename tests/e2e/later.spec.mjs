// Add forms: round2.xlsx and singapore.xlsx brought into a built Round 1 draft. Everyone on a course stays.
import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { LATER } from "../../src/import.js";
import { readBook, writeBook } from "../../src/xlsx.js";
import { buildDraft, dropFiles, measure, schoolFiles, visibleStrings, watchPage } from "./helpers.mjs";
import { forbiddenIn } from "./words.mjs";

const dirs = [];
test.afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const four = () => schoolFiles().filter((p) => !LATER.some((n) => p.endsWith(n)));
const later = () => schoolFiles().filter((p) => LATER.some((n) => p.endsWith(n)));
const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const placed = (page) => page.locator("[data-result]").getAttribute("data-placed").then(Number);
const addButton = (page) => page.getByRole("button", { name: /^(Add and place|Placing)$/ });
const staff = async () => {
  const [sheet] = await readBook(readFileSync("fixtures/school/staff.xlsx"));
  return sheet.rows.slice(1).map(([email, name]) => ({ email, name }));
};
const domText = (page) => page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input")].map((i) => i.value).join("\n"));
const expectNoPeople = async (page, people) => {
  const dom = await domText(page);
  for (const p of people) { expect(dom).not.toContain(p.name); expect(dom).not.toContain(p.email); }
};
async function download(page) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = new Uint8Array(readFileSync(await d.path()));
  return { name: d.suggestedFilename(), bytes, book: await readBook(bytes), zip: unzipSync(bytes) };
}

async function buildRoundOne(page) {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(four());
  await buildDraft(page);
}
// Every teacher's course as the Teachers tab shows it, by T number.
async function placements(page) {
  await tab(page, "Teachers").click();
  const rows = await page.locator("#main [data-row][data-teacher]").evaluateAll((els) => els.map((e) => [e.dataset.teacher, e.querySelector('[data-cell="course"]').textContent]));
  return Object.fromEntries(rows);
}
const onCourse = (all) => Object.fromEntries(Object.entries(all).filter(([, c]) => c !== "Not placed"));
async function openCard(page) {
  await page.getByRole("button", { name: "Add forms", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add forms" })).toBeVisible();
}
const slot = (page, file) => page.locator(`#main [data-slot="${file}"]`);
async function addBoth(page, how = "drop") {
  await openCard(page);
  if (how === "drop") await dropFiles(page, later());
  else await page.locator('[data-k="later-files"]').setInputFiles(later());
  for (const f of LATER) await expect(slot(page, f)).toContainText("ready");
  await expect(addButton(page)).toBeEnabled();
  const was = await placed(page);
  await addButton(page).click();
  await expect(page.getByRole("heading", { name: "Add forms" })).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => placed(page)).toBeGreaterThan(was);
}
async function historyTop(page) {
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  const top = await page.locator("#main [data-row]").first().evaluate((r) => r.querySelector("span").lastChild.textContent.trim());
  await page.getByRole("button", { name: "Back" }).click();
  return top;
}
// Puts a teacher who is not placed onto a full course they hold any certificate for, which breaks the seats rule.
async function overfill(page) {
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  const row = page.locator('#main [data-act="moveTo"]').filter({ has: page.locator("small b", { hasText: /^Full(, they did not rank this)?$/ }) }).first();
  const course = (await row.evaluate((e) => e.firstChild.textContent)).trim();
  await row.click();
  return course;
}

test("Add forms on a Round 1 draft places people and nobody on a course moves", async ({ page }) => {
  const watch = watchPage(page);
  await buildRoundOne(page);
  const full = await overfill(page);
  await tab(page, "Courses").click();
  await expect(page.locator("#main [data-row][data-course]", { hasText: full })).toContainText("Over by 1");
  const was = await placed(page);
  const before = onCourse(await placements(page));
  await addBoth(page);
  expect(await placed(page)).toBeGreaterThan(was);
  const after = await placements(page);
  for (const [id, c] of Object.entries(before)) expect(after[id], id).toBe(c);
  await tab(page, "Courses").click();
  await expect(page.locator("#main [data-row][data-course]", { hasText: full })).toContainText("Over by 1");
  expect(await historyTop(page)).toMatch(/^Added Round 2 and Singapore forms, placed \d+$/);
  expect(watch.problems).toEqual([]);
});

test("someone moved to Not placed by hand is still not placed after Add forms", async ({ page }) => {
  const watch = watchPage(page);
  await buildRoundOne(page);
  const all = await placements(page);
  const id = Object.keys(onCourse(all))[0];
  await page.locator(`#main [data-teacher="${id}"]`).click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.locator('[data-k="np"]').click();
  await expect.poll(async () => (await placements(page))[id]).toBe("Not placed");
  await addBoth(page);
  expect((await placements(page))[id]).toBe("Not placed");
  expect(watch.problems).toEqual([]);
});

test("Undo after Add forms puts placements back and reload keeps the forms", async ({ page }) => {
  const watch = watchPage(page);
  await buildRoundOne(page);
  const was = await placed(page);
  const before = await placements(page);
  await addBoth(page, "choose");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => placed(page)).toBe(was);
  expect(await placements(page)).toEqual(before);
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  expect(await placed(page)).toBe(was);
  expect(await placements(page)).toEqual(before);
  // The forms stay: a Round 2 sender's card lists their Round 2 choices.
  const [sheet] = await readBook(readFileSync("fixtures/school/round2.xlsx"));
  const email = sheet.rows.slice(1).find((r) => r.slice(2).some((c) => c !== null && String(c).trim()))[1];
  const name = (await staff()).find((p) => p.email.toLowerCase() === String(email).trim().toLowerCase()).name;
  await names(page).click();
  await tab(page, "Teachers").click();
  await page.locator('[data-search="teachers"]').fill(name);
  await page.locator("#main [data-row][data-teacher]:visible").first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await expect(page.locator("#main .group", { hasText: "Round 2 choices" })).toBeVisible();
  expect(watch.problems).toEqual([]);
});

test("a refused file keeps Add and place locked and changes nothing", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "interim-later-"));
  dirs.push(dir);
  const [sheet] = await readBook(readFileSync("fixtures/school/round2.xlsx"));
  writeFileSync(join(dir, "round2.xlsx"), await writeBook([{ name: "Sheet1", rows: [["Mail", ...sheet.rows[0].slice(1)], ...sheet.rows.slice(1)] }]));
  const watch = watchPage(page);
  await buildRoundOne(page);
  const was = await placed(page);
  const before = await placements(page);
  await openCard(page);
  await expect(addButton(page)).toBeDisabled();
  await dropFiles(page, [join(dir, "round2.xlsx")]);
  await expect(slot(page, "round2.xlsx")).not.toContainText(/ready|file not added/);
  await expect(addButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Back" }).click();
  expect(await placed(page)).toBe(was);
  expect(await placements(page)).toEqual(before);
  expect(await historyTop(page)).toBe("First draft built from the forms");
  expect(watch.problems).toEqual([]);
});

test("names off: the card, History and the download hold no name or email", async ({ page }) => {
  const people = await staff();
  const watch = watchPage(page);
  await buildRoundOne(page);
  await openCard(page);
  await dropFiles(page, later());
  for (const f of LATER) await expect(slot(page, f)).toContainText("ready");
  await expectNoPeople(page, people);
  expect(forbiddenIn(await visibleStrings(page))).toEqual([]);
  await page.getByRole("button", { name: "Back" }).click();
  await addBoth(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expectNoPeople(page, people);
  expect(forbiddenIn(await visibleStrings(page))).toEqual([]);
  const dl = await download(page);
  expect(dl.name).toContain("T numbers");
  const raw = Object.values(dl.zip).map(strFromU8).join("\n");
  for (const p of people) { expect(raw).not.toContain(p.name); expect(raw).not.toContain(p.email); }
  const strings = dl.book.flatMap((s) => [s.name, ...s.rows.flat().filter((c) => c !== null).map(String)]);
  expect(forbiddenIn(strings)).toEqual([]);
  expect(strings).toContain("Added Round 2 and Singapore forms, placed " + (await addedCount(page)));
  expect(watch.problems).toEqual([]);
});
const addedCount = (page) => page.locator("#main [data-row]").first().evaluate((r) => r.querySelector("span").lastChild.textContent.trim().split(" ").at(-1));

// The budget steps run on measure's 1366x820 viewport, as in their own test; the wording checks run back on the default one.
test("the Add forms card fits the detail budget, says forms are not stored, and after Add and place each file says file not added again", async ({ page }) => {
  test.setTimeout(120_000);
  watchPage(page);
  await buildRoundOne(page);
  const viewport = page.viewportSize();
  const note = "Forms are read, never stored in this browser, so after Add and place each file says file not added again.";
  await measure(page, "first");
  await openCard(page);
  await measure(page, "detail");
  await page.setViewportSize(viewport);
  await expect(page.locator("#main [data-later-note]")).toHaveText(note);
  await page.setViewportSize({ width: 1366, height: 820 });
  await dropFiles(page, later());
  for (const f of LATER) await expect(slot(page, f)).toContainText("ready");
  await measure(page, "detail");
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "Back" }).click();
  await addBoth(page);
  await openCard(page);
  await expect(page.locator("#main [data-later-note]")).toHaveText(note);
  // With nothing added, a row is a placeholder, not a slot.
  for (const f of LATER) await expect(page.locator(`#main [data-placeholder="${f}"]`)).toContainText("file not added");
});

// While Placing, the solver is still starting up, and the office can still move people. Holding back highs.wasm opens that gap
// without any wait: a move made in it must stand, so nobody placed by the office is put elsewhere by the added forms.
test("a move made while Placing stands", async ({ page }) => {
  const watch = watchPage(page);
  let gate = null;
  let hit;
  const reached = new Promise((r) => { hit = r; });
  await page.route("**/highs.wasm", async (route) => {
    if (gate) { hit(); await gate; }
    await route.continue();
  });
  await buildRoundOne(page);
  // A first add shows who the forms place; Undo puts everyone back, and the same solve gives the same placements.
  const before = await placements(page);
  await addBoth(page);
  const after = await placements(page);
  const [y, z] = Object.entries(after).find(([id, c]) => before[id] === "Not placed" && c !== "Not placed");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await placements(page))[y]).toBe("Not placed");

  let release;
  gate = new Promise((r) => { release = r; });
  await openCard(page);
  await dropFiles(page, later());
  for (const f of LATER) await expect(slot(page, f)).toContainText("ready");
  await addButton(page).click();
  await expect(addButton(page)).toHaveText("Placing");
  await reached;
  // Move them elsewhere while the solve waits.
  await tab(page, "Teachers").click();
  await page.locator(`#main [data-row][data-teacher="${y}"]`).click();
  await page.getByRole("button", { name: "All options" }).click();
  const row = page.locator('#main [data-act="moveTo"][data-c]:not([data-c=""])').filter({ hasNotText: z }).first();
  const w = (await row.evaluate((e) => e.firstChild.textContent)).trim();
  await row.click();
  await expect(page.locator(`#main [data-row][data-teacher="${y}"]`)).toHaveCount(0);
  release();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator("#main [data-row]").first()).toContainText(/Added Round 2 and Singapore forms, placed \d+$/);
  expect((await placements(page))[y]).toBe(w);
  expect(watch.problems).toEqual([]);
});

// The rounds held in the stored upload, read the way a second tab would.
const storedRounds = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("interim-demo");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const req = open.result.transaction("upload").objectStore("upload").get("school");
    req.onsuccess = () => { open.result.close(); resolve([...new Set(req.result.teachers.flatMap((t) => t.prefs.map((p) => p.round)))].sort()); };
  };
}));
async function addOne(page, file) {
  await openCard(page);
  await page.locator('[data-k="later-files"]').setInputFiles(later().filter((p) => p.endsWith(file)));
  await expect(slot(page, file)).toContainText("ready");
  await addButton(page).click();
  await expect(page.getByRole("heading", { name: "Add forms" })).toHaveCount(0, { timeout: 60_000 });
}

test("Add forms in a tab that cannot hear the first tab never replaces the forms the first tab added", async ({ page, context }) => {
  await buildRoundOne(page);
  const other = await context.newPage();
  // Never told about the first tab's save, as in a browser without BroadcastChannel: the store alone must refuse its write.
  await other.addInitScript(() => { delete window.BroadcastChannel; });
  await other.goto("/");
  await expect(other.locator("[data-result]")).toBeVisible();

  await addOne(page, "round2.xlsx");
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  const ours = await placements(page);
  await addOne(other, "singapore.xlsx");
  await expect(other.locator("[data-saved]")).toHaveText("Not saved");

  expect(await storedRounds(page)).toEqual(["Round 1", "Round 2"]);
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  expect(await placements(page)).toEqual(ours);
});

test("a save in another tab while this one is Placing stops the placing, and this tab then catches up and saves", async ({ page, context }) => {
  await buildRoundOne(page);
  const other = await context.newPage();
  let release;
  const held = new Promise((r) => { release = r; });
  await other.route("**/highs.wasm", async (route) => { await held; await route.continue(); });
  await other.goto("/");
  await expect(other.locator("[data-result]")).toBeVisible();
  await openCard(other);
  await other.locator('[data-k="later-files"]').setInputFiles(later().filter((p) => p.endsWith("round2.xlsx")));
  await expect(slot(other, "round2.xlsx")).toContainText("ready");
  await addButton(other).click();
  await expect(addButton(other)).toHaveText("Placing");

  // The first tab saves a change while the other is still Placing.
  await tab(page, "Teachers").click();
  const before = await placements(page);
  const mover = Object.keys(before).find((id) => before[id] !== "Not placed");
  await page.locator(`#main [data-teacher="${mover}"]`).click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.locator('#main [data-act="moveTo"]:not([data-c=""])').first().click();
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  await expect(page.locator("[data-saved]")).toHaveAttribute("data-version", "2");
  release();

  await expect(other.locator("[data-failed]")).toHaveText("Couldn't place anyone. Nothing changed.", { timeout: 60_000 });
  await expect(other.locator("[data-saved]")).toHaveAttribute("data-version", "2");
  await expect(other.locator("[data-saved]")).toHaveText("Saved in this browser");
  // Pressed again, it places on the newest draft and saves.
  await addButton(other).click();
  await expect(other.getByRole("heading", { name: "Add forms" })).toHaveCount(0, { timeout: 60_000 });
  await expect(other.locator("[data-saved]")).toHaveText("Saved in this browser");
  await expect(other.locator("[data-saved]")).toHaveAttribute("data-version", "3");
  expect(await storedRounds(page)).toEqual(["Round 1", "Round 2"]);
});

test("Add forms in one tab reaches another open tab, which can then add the next round", async ({ page, context }) => {
  await buildRoundOne(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("[data-result]")).toBeVisible();

  await addOne(page, "round2.xlsx");
  await expect(page.locator("[data-saved]")).toHaveText("Saved in this browser");
  await expect.poll(() => historyTop(other)).toMatch(/^Added Round 2 forms, placed \d+$/);
  await addOne(other, "singapore.xlsx");
  await expect(other.locator("[data-saved]")).toHaveText("Saved in this browser");
  expect(await storedRounds(page)).toEqual(["Round 1", "Round 2", "Singapore"]);
  await expect.poll(() => historyTop(page)).toMatch(/^Added Singapore forms, placed \d+$/);
  expect(await placements(page)).toEqual(await placements(other));
});
