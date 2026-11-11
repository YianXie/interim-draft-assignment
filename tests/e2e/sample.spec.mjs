import { test, expect } from "@playwright/test";
import { SLOTS } from "../../src/import.js";
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
