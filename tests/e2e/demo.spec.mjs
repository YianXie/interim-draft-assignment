import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readBook } from "../../src/xlsx.js";
import { buildButton, dropSchool, buildDraft } from "./helpers.mjs";

const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });

// The demo story, in the order it is told, on a fresh browser profile.
test("the demo story end to end", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173", acceptDownloads: true });
  const page = await context.newPage();
  await dropSchool(page);
  await buildDraft(page);
  await expect(tab(page, /^To do/)).toHaveAttribute("aria-selected", "true");

  // Open a teacher's one-line reason.
  await tab(page, "Teachers").click();
  const row = page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first();
  const id = await row.getAttribute("data-teacher");
  await row.click();
  await expect(page.locator("#main .why")).toBeVisible();
  const reason = await page.locator("#main .why").innerText();
  await page.getByRole("button", { name: "All options" }).click();

  // Move to, Undo, move again.
  const moveTo = page.locator('#main [data-act="moveTo"]:not([data-c=""])');
  await moveTo.first().click();
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#main .why")).not.toContainText("Moved by the office");
  expect(await page.locator("#main .why").innerText()).toBe(reason);
  await page.getByRole("button", { name: "All options" }).click();
  await moveTo.first().click();
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await page.getByRole("button", { name: "Back" }).click();

  // Names on, names off, reload.
  await names(page).click();
  await expect(names(page)).toBeChecked();
  await names(page).click();
  await expect(names(page)).not.toBeChecked();
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  await expect(page.locator("[data-saved]")).toHaveAttribute("data-version", "4");
  await expect(buildButton(page)).toHaveCount(0);

  // Download and find the change.
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  expect(d.suggestedFilename()).toBe("Fernhollow invented draft v4 T numbers.xlsx");
  const book = await readBook(new Uint8Array(readFileSync(await d.path())));
  const changes = book.find((s) => s.name === "Changes").rows;
  expect(changes.map((r) => r[2]).slice(1)).toEqual([expect.stringContaining(`Moved ${id} to `), "Undid the last change", expect.stringContaining(`Moved ${id} to `)]);
  const [head, ...people] = book.find((s) => s.name === "Teachers").rows;
  const moved = people.find((r) => r[0] === id);
  expect(moved[head.indexOf("Why")]).toContain("Moved by the office");
  await context.close();
});
