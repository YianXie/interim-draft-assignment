import { test, expect } from "@playwright/test";
import { ORIGIN, buildDraft, dropSchool, visibleStrings, watchPage } from "./helpers.mjs";
import { forbiddenIn } from "./words.mjs";

const POLICY = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'`;

test("/docs has every section in its sidebar, the same policy, no outside requests and no forbidden words", async ({ page, context }) => {
  const watch = watchPage(page);
  await watch.listenForCsp();
  const seen = [];
  context.on("request", (r) => seen.push(r.url()));
  await page.goto("/docs");
  await expect(page.locator("h1")).toHaveText("Documentation");
  // The policy is the first element in head, as on the page itself.
  expect(await page.evaluate(() => { const m = document.head.firstElementChild; return m.httpEquiv === "Content-Security-Policy" && m.content; })).toBe(POLICY);
  for (const id of ["start", "files", "sample", "fit", "how", "rules", "priority", "after", "data", "words"]) {
    await expect(page.locator(`.docs-nav a[href="#${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await page.locator('.docs-nav a[href="#fit"]').click();
  await expect(page).toHaveURL(/#fit$/);
  await expect(page.locator("#fit h2")).toBeInViewport();
  expect(forbiddenIn(await visibleStrings(page))).toEqual([]);
  expect(seen.filter((u) => !u.startsWith(ORIGIN))).toEqual([]);
  expect(await watch.csp()).toEqual([]);
  expect(watch.problems).toEqual([]);
});

test("Start and the draft each link to /docs in a new tab, and Start no longer folds How it works", async ({ page }) => {
  await page.goto("/");
  const link = page.locator("[data-docs]");
  await expect(link).toHaveAttribute("href", "/docs");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByText("How it works")).toHaveCount(0);
  // A new tab, so files held on Start are not lost.
  const [docs] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
  await expect(docs.locator("h1")).toHaveText("Documentation");
  await docs.close();
  await dropSchool(page);
  await buildDraft(page);
  await expect(page.locator("#done [data-docs]")).toHaveAttribute("href", "/docs");
  await expect(page.locator("#done [data-docs]")).toHaveAttribute("target", "_blank");
});
