import { test, expect } from "@playwright/test";
import { buildDraft, dropSchool } from "./helpers.mjs";

const ORIGIN = "http://127.0.0.1:4173";
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'">`;
// Nothing here is ever contacted: the address is reserved for documentation.
const OUTSIDE = "http://198.51.100.1/";

const tab = (page, name) => page.getByRole("tab", { name });
const names = (page) => page.getByRole("switch", { name: "Show names" });

test("a full run makes zero outside requests with the network on", async ({ page, context }) => {
  const seen = [];
  page.on("request", (r) => seen.push(r.url()));
  context.on("request", (r) => seen.push(r.url()));
  await dropSchool(page);
  await buildDraft(page);
  await tab(page, "Teachers").click();
  await page.locator("#main [data-row][data-teacher]", { hasNotText: "Not placed" }).first().click();
  await page.getByRole("button", { name: "All options" }).click();
  await page.locator('#main [data-act="moveTo"]:not([data-c=""])').first().click();
  await expect(page.locator("#main .why")).toContainText("Moved by the office");
  await names(page).click();
  await names(page).click();
  await page.reload();
  await expect(page.locator("[data-result]")).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  await d.path();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((u) => !u.startsWith(ORIGIN))).toEqual([]);
});

test("an outside fetch and an outside image are refused by the policy", async ({ page, context }) => {
  // The browser may log an attempt, but it must be stopped by the policy and nothing may come back.
  const answered = [], blocked = [];
  context.on("requestfinished", (r) => { if (!r.url().startsWith(ORIGIN)) answered.push(r.url()); });
  context.on("requestfailed", (r) => { if (!r.url().startsWith(ORIGIN)) blocked.push(r.failure().errorText); });
  await page.goto("/");
  await expect(page.getByText("Interim 2028")).toBeVisible();
  const result = await page.evaluate((url) => {
    const violations = [];
    document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    const fetched = fetch(url).then(() => "reached", () => "rejected");
    const imaged = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve("loaded");
      img.onerror = () => resolve("errored");
      img.src = url;
    });
    return Promise.all([fetched, imaged]).then(([fetch, image]) => ({ fetch, image, violations }));
  }, OUTSIDE);
  expect(result.fetch).toBe("rejected");
  expect(result.image).toBe("errored");
  expect(result.violations.filter((v) => v.startsWith("connect-src"))).toHaveLength(1);
  expect(result.violations.filter((v) => v.startsWith("img-src"))).toHaveLength(1);
  expect(blocked.filter((e) => e !== "csp")).toEqual([]);
  expect(answered).toEqual([]);
});

test("the policy is the first element in head", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const head = html.slice(html.search(/<head[ >]/));
  const afterHead = head.slice(head.indexOf(">") + 1).replace(/^\s*(<!--[\s\S]*?-->\s*)*/, "");
  expect(afterHead.startsWith(POLICY)).toBe(true);
});

test("no inline scripts and no outside links", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  await dropSchool(page);
  await buildDraft(page);
  await tab(page, "Teachers").click();
  await tab(page, "Courses").click();
  const found = await page.evaluate((origin) => {
    const bad = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.tagName === "SCRIPT" && !el.getAttribute("src")) bad.push("inline script");
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) bad.push(`${el.tagName} ${a.name}`);
        if (["src", "href"].includes(a.name) && /^(https?:)?\/\//i.test(a.value) && !a.value.startsWith(origin + "/")) bad.push(`${el.tagName} ${a.name}=${a.value}`);
      }
    });
    return bad;
  }, ORIGIN);
  expect(found).toEqual([]);
});
