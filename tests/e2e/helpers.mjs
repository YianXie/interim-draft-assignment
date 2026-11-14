// Shared by every browser test. Collects page errors and CSP violations, with no fixed waits.
import { expect } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SLOTS } from "../../src/import.js";
import { readBook, writeBook } from "../../src/xlsx.js";
import { INSPECT, judge } from "./measure-source.mjs";

const watched = new WeakMap();

export function watchPage(page) {
  const problems = [];
  watched.set(page, problems);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  return {
    problems,
    // Call before page.goto so the listener is in place for the first load.
    async listenForCsp() {
      await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
    },
    csp: () => page.evaluate(() => window.__csp || []),
  };
}

export const schoolFiles = (dir = "fixtures/school") => SLOTS.map((f) => join(dir, f));
export const buildButton = (page) => page.getByRole("button", { name: /^Build/ });

// Through the file input; Build is unlocked when it returns.
export async function dropSchool(page, dir = "fixtures/school") {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(schoolFiles(dir));
  await expect(buildButton(page)).toBeEnabled();
}

export async function buildDraft(page) {
  await buildButton(page).click();
  await expect(page.locator("[data-result]")).toBeVisible({ timeout: 60_000 });
}

// Real drop events, one per list, all fired in the same moment.
export async function dropFiles(page, ...drops) {
  const payload = drops.map((paths) => paths.map((p) => ({ name: basename(p), bytes: [...readFileSync(p)] })));
  await page.evaluate((list) => {
    for (const files of list) {
      const dataTransfer = new DataTransfer();
      for (const f of files) dataTransfer.items.add(new File([new Uint8Array(f.bytes)], f.name));
      document.querySelector("[data-drop]").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    }
  }, payload);
}

// A copy of the six fixture files in a temp directory. edit(file, rows) may change rows in place.
export async function variantSchool(edit) {
  const dir = mkdtempSync(join(tmpdir(), "interim-variant-"));
  for (const file of SLOTS) {
    const [sheet] = await readBook(readFileSync(join("fixtures/school", file)));
    edit(file, sheet.rows);
    writeFileSync(join(dir, file), await writeBook([{ name: sheet.name, rows: sheet.rows }]));
  }
  return dir;
}

// Same window measure.cjs uses. Fails the test on any overBudget entry.
export async function measure(page, budgetName) {
  await page.setViewportSize({ width: 1366, height: 820 });
  const report = await page.evaluate(INSPECT);
  judge(report, budgetName, watched.get(page) || []);
  expect(report.overBudget, JSON.stringify(report)).toEqual([]);
  return report;
}

// Start holds a line about each file, so its word counts run over the first budget by design. Every other limit still holds.
const START_WAIVES = /^(words|maxWordsInRow) /;
export async function measureStart(page) {
  await page.setViewportSize({ width: 1366, height: 820 });
  const report = await page.evaluate(INSPECT);
  judge(report, "first", watched.get(page) || []);
  expect(report.overBudget.filter((x) => !START_WAIVES.test(x)), JSON.stringify(report)).toEqual([]);
  return report;
}

// Everything a person, or the words check, can read: page text, the four attributes, and live input values.
export function visibleStrings(page) {
  return page.evaluate(() => {
    const out = [document.body.innerText];
    document.querySelectorAll("*").forEach((el) => {
      for (const a of ["title", "aria-label", "placeholder", "value"]) { const v = el.getAttribute(a); if (v) out.push(v); }
      if (typeof el.value === "string" && el.value) out.push(el.value);
    });
    return out;
  });
}
