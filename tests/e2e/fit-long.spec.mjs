// An opened teacher stays inside the panel's 60 words when fit.xlsx gives two 3-word Facts on the course they are on.
// Invented data only: the fixture school, with a fit.xlsx written here.
import { test, expect } from "@playwright/test";
import { buildButton, buildDraft, measure, watchPage } from "./helpers.mjs";
import { cleanUp, sevenFiles, variantFit } from "./fit-helpers.mjs";
import { readFitSchool } from "../unit/fit-fixture.mjs";
import { pastFiles } from "../unit/past-fixture.mjs";

test.afterAll(cleanUp);

const TEACHERS = 96;
const names = (page) => page.getByRole("switch", { name: "Show names" });
const rows = (page) => page.locator("#main [data-row][data-teacher]");

// Every teacher gets two rows on every course they ranked, so whoever is placed on a ranked course has two Facts there.
async function longFit(second) {
  const school = await readFitSchool();
  return variantFit((sheet) => {
    sheet.splice(1);
    for (const t of school.teachers) {
      for (const course of new Set(t.prefs.map((p) => p.course))) {
        sheet.push([t.email, course, "Experience", "Level 2 climbing", "climbing"]);
        sheet.push([t.email, course, ...second]);
      }
    }
  });
}

async function measureEveryCard(page, files) {
  watchPage(page);
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(files);
  await expect(buildButton(page)).toBeEnabled();
  await buildDraft(page);
  await page.getByRole("tab", { name: "Teachers" }).click();
  await expect(rows(page)).toHaveCount(TEACHERS);
  await names(page).click();
  await expect(names(page)).toHaveAttribute("aria-checked", "true");
  const ids = await rows(page).evaluateAll((els) => els.map((e) => e.dataset.teacher));
  let twoFacts = 0;
  for (const id of ids) {
    await page.locator(`#main [data-teacher="${id}"]`).click();
    await expect(page.locator("#main .why")).toBeVisible();
    const fit = page.locator("#main [data-fit]");
    if ((await fit.count()) && /^From their form: Level 2 climbing, /.test(await fit.innerText())) twoFacts++;
    await expect(page.getByRole("button", { name: "All options" })).toBeVisible();
    await measure(page, "detail");
    await page.getByRole("button", { name: "Back" }).click();
  }
  expect(twoFacts).toBeGreaterThan(0);
}

for (const [label, second] of [
  ["two 3-word Facts", ["Skill", "Sea kayak leader", "kayak"]],
  ["two 3-word Facts, one a Limitation", ["Limitation", "Back of group", "group"]],
]) {
  test(`budgets: an opened teacher with ${label} on their course`, async ({ page }) => {
    test.setTimeout(240_000);
    await measureEveryCard(page, sevenFiles(await longFit(second)));
  });
  test(`budgets: an opened teacher with ${label} on their course and a last-year line`, async ({ page }) => {
    test.setTimeout(240_000);
    await measureEveryCard(page, [...sevenFiles(await longFit(second)), ...pastFiles]);
  });
}
