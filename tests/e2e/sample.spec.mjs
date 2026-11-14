import { test, expect } from "@playwright/test";
import { SLOTS, PAST_SLOTS } from "../../src/import.js";
import { buildButton, buildDraft, watchPage } from "./helpers.mjs";

test("Use sample data fills all six files and builds a draft", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample data" }).click();
  await expect(buildButton(page)).toBeEnabled();
  for (const name of SLOTS) await expect(page.locator(`[data-slot="${name}"]`)).toContainText("ready");
  await buildDraft(page);
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});

test("Use sample data on the Last year tab fills all ten files and builds a draft with last year", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await page.goto("/");
  await page.locator('[data-start-tab="past"]').click();
  await page.getByRole("button", { name: "Use sample data" }).click();
  await expect(buildButton(page)).toBeEnabled();
  for (const name of [...SLOTS, ...PAST_SLOTS]) await expect(page.locator(`[data-slot="${name}"]`)).toContainText("ready");
  await buildDraft(page);
  await page.locator('[data-tab="teachers"]').click();
  // Last year's results are in the search only when the past files were read.
  await page.locator('[data-search="teachers"]').fill("top 4");
  await expect(page.locator("#main [data-row][data-teacher]:visible").first()).toBeVisible();
  await page.locator("#main [data-row][data-teacher]:visible").first().click();
  await expect(page.locator("#main [data-last]")).toHaveText(/^Last year: /);
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});

test("Use sample data on the Last year tab never replaces a file already added", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles({ name: "courses.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(page.locator('[data-slot="courses.xlsx"] [data-line]')).toHaveText("Not a readable .xlsx file");
  await page.locator('[data-start-tab="past"]').click();
  await page.getByRole("button", { name: "Use sample data" }).click();
  for (const name of [...SLOTS.slice(1), ...PAST_SLOTS]) await expect(page.locator(`[data-slot="${name}"]`)).toContainText("ready");
  await expect(page.locator('[data-slot="courses.xlsx"] [data-line]')).toHaveText("Not a readable .xlsx file");
  await expect(buildButton(page)).toBeDisabled();
});
