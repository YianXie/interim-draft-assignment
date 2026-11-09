import { test, expect } from "@playwright/test";
import { watchPage } from "./helpers.mjs";

test("page loads the stub with no CSP complaint", async ({ page }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  await page.goto("/");
  await expect(page.getByText("Interim 2028")).toBeVisible();
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});
