import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBook } from "../../src/xlsx.js";
import { buildButton, buildDraft, dropSchool, measure, schoolFiles, watchPage } from "./helpers.mjs";

const BUILD = 1; // The Build snapshot is always version 1.

const staff = async () => {
  const [sheet] = await readBook(readFileSync("fixtures/school/staff.xlsx"));
  return sheet.rows.slice(1).map(([email, name]) => ({ email, name }));
};
async function goBuild(page) { await dropSchool(page); await buildDraft(page); await savedAt(page, BUILD); }
const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });
const undo = (page) => page.getByRole("button", { name: "Undo" });
const history = (page) => page.getByRole("button", { name: "History" }).click();
const saved = (page) => page.locator("[data-saved]");
const savedAt = (page, v) => expect(saved(page)).toHaveAttribute("data-version", String(v));
const reloaded = async (page) => { await page.reload(); await expect(page.locator("[data-result]")).toBeVisible(); };

// Every teacher's row on the Teachers tab, as { T number: course name or Not placed }.
async function placements(page) {
  await tab(page, "Teachers").click();
  await expect(page.locator("#main [data-row][data-teacher]")).toHaveCount(96);
  return page.locator("#main [data-row][data-teacher]").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.teacher, e.children[1].textContent])));
}
const placedIds = (map, n) => Object.keys(map).filter((id) => map[id] !== "Not placed").slice(0, n);

// From the Teachers tab: moves one person to their first free option, then back to the list.
async function moveOne(page, id) {
  await page.locator(`#main [data-teacher="${id}"]`).click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.locator('#main [data-act="moveTo"]:not([data-c=""])').first().click();
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await page.getByRole("button", { name: "Back" }).click();
}
// The Build, then two moves. Returns the placements at each of the three versions.
async function buildAndTwoMoves(page) {
  await goBuild(page);
  const v1 = await placements(page);
  const [a, b] = placedIds(v1, 2);
  await moveOne(page, a);
  await savedAt(page, 2);
  const v2 = await placements(page);
  await moveOne(page, b);
  await savedAt(page, 3);
  return { v1, v2, v3: await placements(page) };
}

// How many records each store holds, read the way a second tab would.
const stored = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("interim-demo");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction(["upload", "snapshots"]);
    const upload = tx.objectStore("upload").count(), snapshots = tx.objectStore("snapshots").count();
    tx.oncomplete = () => { open.result.close(); resolve({ upload: upload.result, snapshots: snapshots.result }); };
  };
}));

test("nothing is stored before Build", async ({ page }) => {
  await dropSchool(page);
  expect(await stored(page)).toEqual({ upload: 0, snapshots: 0 });
});

test("reload shows the same draft with no re-upload", async ({ page }) => {
  await goBuild(page);
  const start = await placements(page);
  await moveOne(page, placedIds(start, 1)[0]);
  await savedAt(page, 2);
  const before = await placements(page);
  expect(before).not.toEqual(start);
  await reloaded(page);
  await expect(page.locator("[data-slot]")).toHaveCount(0);
  await expect(tab(page, /^To do/)).toHaveAttribute("aria-selected", "true");
  await expect(saved(page)).toHaveText("Saved in this browser");
  await savedAt(page, 2);
  expect(await placements(page)).toEqual(before);
});

test("reload right after Build, before any edit, shows the draft", async ({ page }) => {
  await goBuild(page);
  const before = await placements(page);
  await reloaded(page);
  await savedAt(page, BUILD);
  await expect(undo(page)).toHaveCount(0);
  expect(await placements(page)).toEqual(before);
});

test("an upload saved with no snapshots counts as nothing saved", async ({ page }) => {
  await goBuild(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("interim-demo");
    open.onsuccess = () => {
      const tx = open.result.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").clear();
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await expect(page.locator("[data-result]")).toHaveCount(0);
  await expect(buildButton(page)).toBeDisabled();
});

test("a load that fails never overwrites the saved draft", async ({ page }) => {
  // Not watchPage: the console error here is the expected result.
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("failRead")) IDBObjectStore.prototype.getAll = () => { throw new Error("stubbed read failure"); };
  });
  await goBuild(page);
  await moveOne(page, placedIds(await placements(page), 1)[0]);
  await savedAt(page, 2);
  const before = await placements(page);

  await page.evaluate(() => sessionStorage.setItem("failRead", "1"));
  await page.reload();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await expect.poll(() => errors.join("\n")).toContain("stubbed read failure");

  // A new Build and an edit in this session, then Start over: none of them may touch what is on disk.
  await dropSchool(page);
  await buildDraft(page);
  await moveOne(page, placedIds(await placements(page), 1)[0]);
  await expect(undo(page)).toBeVisible();
  await expect(saved(page)).toHaveText("");
  await expect(saved(page)).not.toHaveAttribute("data-version");
  await history(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  expect(await stored(page)).toEqual({ upload: 1, snapshots: 2 });

  await page.evaluate(() => sessionStorage.removeItem("failRead"));
  await reloaded(page);
  await savedAt(page, 2);
  await expect(saved(page)).toHaveText("Saved in this browser");
  expect(await placements(page)).toEqual(before);
});

test("the saved line waits for the write, and versions land in order", async ({ page }) => {
  await goBuild(page);
  const start = await placements(page);
  const [a, b] = placedIds(start, 2);
  await expect(saved(page)).toHaveText("Saved in this browser");
  // A write transaction held open from a second connection: the page's own writes queue behind it.
  await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open("interim-demo");
    open.onsuccess = () => {
      const store = open.result.transaction("snapshots", "readwrite").objectStore("snapshots");
      window.__hold = true;
      const spin = () => { if (window.__hold) store.count().onsuccess = spin; };
      store.count().onsuccess = () => { spin(); resolve(); };
    };
  }));
  await moveOne(page, a);
  await moveOne(page, b);
  await expect(saved(page)).toHaveText("");
  await savedAt(page, BUILD);
  await page.evaluate(() => { window.__hold = false; });
  await savedAt(page, 3);
  await expect(saved(page)).toHaveText("Saved in this browser");
  expect(await stored(page)).toEqual({ upload: 1, snapshots: 3 });
});

/* The kill test drives a real Chromium on a real profile, because a Playwright context keeps nothing on disk. */
const BASE = "http://127.0.0.1:4173/";
let profile = null;
let live = null;

async function launch() {
  // Port 0 lets Chromium take any free port and write it here. A killed browser leaves its old file behind.
  const portFile = join(profile, "DevToolsActivePort");
  rmSync(portFile, { force: true });
  const child = spawn(chromium.executablePath(), ["--headless", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const gone = new Promise((resolve) => { child.once("exit", resolve); child.once("error", resolve); });
  live = { child, gone };
  let endpoint;
  await expect.poll(async () => {
    try {
      endpoint = `http://127.0.0.1:${readFileSync(portFile, "utf8").split("\n")[0]}`;
      return (await fetch(`${endpoint}/json/version`)).ok;
    } catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  return context.pages()[0] ?? context.newPage();
}
async function kill() {
  live.child.kill("SIGKILL");
  await live.gone;
  live = null;
}
test.afterEach(async () => {
  if (live) await kill();
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
  profile = null;
});

test("ten edits survive killing Chrome", async () => {
  test.setTimeout(180_000);
  profile = mkdtempSync(join(tmpdir(), "interim-kill-"));
  let page = await launch();
  await page.goto(BASE);
  await page.locator('[data-k="files"]').setInputFiles(schoolFiles());
  await expect(buildButton(page)).toBeEnabled();
  await buildDraft(page);
  await savedAt(page, BUILD);
  const start = await placements(page);
  const ids = placedIds(start, 10);
  expect(ids).toHaveLength(10);
  for (const [i, id] of ids.entries()) {
    await moveOne(page, id);
    await savedAt(page, BUILD + i + 1);
  }
  const before = await placements(page);
  for (const id of ids) expect(before[id]).not.toBe(start[id]);

  await kill();
  page = await launch();
  await page.goto(BASE);
  await expect(page.locator("[data-result]")).toBeVisible();
  await expect(page.locator("[data-slot]")).toHaveCount(0);
  await savedAt(page, BUILD + 10);
  expect(await placements(page)).toEqual(before);
});

test("undo works after a reload and the button goes at Build", async ({ page }) => {
  const { v1, v2 } = await buildAndTwoMoves(page);
  await reloaded(page);
  await undo(page).click();
  await savedAt(page, 4);
  expect(await placements(page)).toEqual(v2);
  await undo(page).click();
  await savedAt(page, 5);
  expect(await placements(page)).toEqual(v1);
  await expect(undo(page)).toHaveCount(0);
  await reloaded(page);
  await expect(undo(page)).toHaveCount(0);
  expect(await placements(page)).toEqual(v1);
});

test("restore writes a new version and Undo returns", async ({ page }) => {
  const { v1, v2, v3 } = await buildAndTwoMoves(page);
  await history(page);
  await expect(page.locator("#main [data-row]")).toHaveCount(3);
  await page.locator("#main [data-row]", { hasText: "First draft built from the forms" }).getByRole("button", { name: "Restore" }).click();
  await savedAt(page, 4);
  await expect(page.locator("#main [data-row]")).toHaveCount(4);
  await expect(page.locator("#main [data-row]").first()).toContainText("Restored version 1");
  expect(await placements(page)).toEqual(v1);
  // One step at a time: back to before the Restore, then through each move, and the button goes at Build.
  await undo(page).click();
  await savedAt(page, 5);
  expect(await placements(page)).toEqual(v3);
  await undo(page).click();
  await savedAt(page, 6);
  expect(await placements(page)).toEqual(v2);
  await undo(page).click();
  await savedAt(page, 7);
  expect(await placements(page)).toEqual(v1);
  await expect(undo(page)).toHaveCount(0);
});

test("with nothing left to undo there is no Undo", async ({ page }) => {
  await goBuild(page);
  await expect(undo(page)).toHaveCount(0);
  const start = await placements(page);
  await moveOne(page, placedIds(start, 1)[0]);
  await savedAt(page, 2);
  await undo(page).click();
  await savedAt(page, 3);
  await expect(undo(page)).toHaveCount(0);
  expect(await placements(page)).toEqual(start);
});

test("history shows T numbers after names on, move, names off", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  const id = placedIds(await placements(page), 1)[0];
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  await moveOne(page, id);
  await savedAt(page, 2);
  await history(page);
  const row = page.locator("#main [data-row]").first();
  await expect(row).not.toContainText(`Moved ${id} to`);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  await expect(row).toContainText(`Moved ${id} to`);
  const dom = await page.evaluate(() => document.documentElement.outerHTML);
  for (const p of people) { expect(dom).not.toContain(p.name); expect(dom).not.toContain(p.email); }
});

test("names are off after a reload", async ({ page }) => {
  const people = await staff();
  await goBuild(page);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  await reloaded(page);
  await expect(names(page)).toHaveAttribute("aria-checked", "false");
  const dom = await page.evaluate(() => document.documentElement.outerHTML);
  for (const p of people) { expect(dom).not.toContain(p.name); expect(dom).not.toContain(p.email); }
});

test("Start over wipes both stores and returns to Start", async ({ page }) => {
  await goBuild(page);
  await moveOne(page, placedIds(await placements(page), 1)[0]);
  await savedAt(page, 2);
  expect(await stored(page)).toEqual({ upload: 1, snapshots: 2 });
  await history(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
  await expect(page.locator("[data-result]")).toHaveCount(0);
  await expect(buildButton(page)).toBeDisabled();
  expect(await stored(page)).toEqual({ upload: 0, snapshots: 0 });
  await page.reload();
  await expect(page.locator("[data-slot]", { hasText: "file not added" })).toHaveCount(6);
});

// Opens the first placed teacher who chose their course on a form, on the Move screen.
async function moveScreenOfSomeoneWithAForm(page) {
  await tab(page, "Teachers").click();
  const rows = page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" });
  for (const id of await rows.evaluateAll((els) => els.map((e) => e.dataset.teacher))) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    await expect(page.locator("#main .why")).toBeVisible();
    if (/^Why\s+Their /.test(await page.locator("#main .why").innerText())) {
      await page.getByRole("button", { name: "All options" }).click();
      await expect(page.getByRole("heading", { name: `Move ${id}` })).toBeVisible();
      return id;
    }
    await page.getByRole("button", { name: "Back" }).click();
  }
  throw new Error("nobody placed from a form");
}

test("a move that breaks a rule warns and stands", async ({ page }) => {
  await goBuild(page);
  const id = await moveScreenOfSomeoneWithAForm(page);
  const row = page.locator('#main [data-act="moveTo"]', { hasText: "They did not rank this" }).first();
  await expect(row).toBeVisible();
  const course = await row.evaluate((el) => el.firstChild.textContent);
  await row.click();
  await expect(page.locator("#main .under")).toHaveText(course);
  await expect(page.locator("#main .why")).toContainText("Moved by the office. Not on their list.");
  await savedAt(page, 2);
  await reloaded(page);
  expect((await placements(page))[id]).toBe(course);
});

test("every Move screen, with its warnings, fits detail", async ({ page }) => {
  test.setTimeout(120_000);
  watchPage(page);
  await goBuild(page);
  for (const id of Object.keys(await placements(page))) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    await page.getByRole("button", { name: "All options" }).click();
    await expect(page.getByRole("heading", { name: `Move ${id}` })).toBeVisible();
    await measure(page, "detail");
    await tab(page, "Teachers").click();
  }
});
