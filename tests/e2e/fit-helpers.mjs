// Shared by the browser tests that add fit.xlsx to the six.
import { expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIT } from "../../src/import.js";
import { readBook, writeBook } from "../../src/xlsx.js";
import { fitFile, readFitSchool } from "../unit/fit-fixture.mjs";
import { buildButton, schoolFiles } from "./helpers.mjs";

export { fitFile };
export const sevenFiles = (fit = fitFile) => [...schoolFiles(), fit];

// Through the file input; Build is unlocked when it returns.
export async function dropSeven(page, fit = fitFile) {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(sevenFiles(fit));
  await expect(buildButton(page)).toBeEnabled();
}

// The seven files read here, outside the page. T numbers are drawn afresh on every read, so a person is followed
// to the page by name, with names on, and from there to their fit rows by email.
let read = null;
export const fitFixture = () => (read ??= readFitSchool().then((school) => {
  const emailOf = new Map(school.teachers.map((t) => [t.name, t.email]));
  if (emailOf.size !== school.teachers.length) throw new Error("two teachers share a name");
  return {
    emailOf,
    rowsOf: new Map(school.teachers.map((t) => [t.email, t.fit])),
    courseId: new Map(school.courses.map((c) => [c.name, c.id])),
  };
}));

// The teacher's fit line, from the design: the course they are on now, two Facts at most with names on, Kinds only with names off.
export function lineFor(rows, cid, namesOn) {
  const here = cid ? rows.filter((r) => r.course === cid) : [];
  const others = rows.length - here.length;
  if (!here.length) return others ? `From their form: ${others} in the download` : null;
  const shown = namesOn ? here.slice(0, 2).map((r) => (r.kind === "Limitation" ? `Limitation: ${r.fact}` : r.fact)) : [...new Set(here.map((r) => r.kind))];
  const more = namesOn ? rows.length - Math.min(2, here.length) : others;
  return `From their form: ${shown.join(", ")}${more ? `, ${more} more in the download` : ""}`;
}

// Every teacher's expected line, from the Teachers tab with names on: { id: line or null }.
export async function expectedLines(page, namesOn) {
  const { emailOf, rowsOf, courseId } = await fitFixture();
  const rows = await page.locator("#main [data-row][data-teacher]").evaluateAll((els) =>
    els.map((e) => ({ id: e.dataset.teacher, name: e.children[0].textContent, course: e.children[1].textContent })));
  expect(rows.length).toBeGreaterThan(0);
  return Object.fromEntries(rows.map((r) => {
    const email = emailOf.get(r.name);
    expect(email, r.name).toBeTruthy();
    return [r.id, lineFor(rowsOf.get(email), r.course === "Not placed" ? null : courseId.get(r.course), namesOn)];
  }));
}

const dirs = [];
export const cleanUp = () => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
// A copy of fit.xlsx in a temp directory, under its own name. edit(rows) may change rows in place; row 0 is the header.
export async function variantFit(edit) {
  const [sheet] = await readBook(readFileSync(fitFile));
  edit(sheet.rows);
  const dir = mkdtempSync(join(tmpdir(), "interim-fit-"));
  dirs.push(dir);
  writeFileSync(join(dir, FIT), await writeBook([{ name: sheet.name, rows: sheet.rows }]));
  return join(dir, FIT);
}
// Columns D and E, Fact and Quote, of a fit file: nothing here may show with names off.
export async function factsAndQuotes(path) {
  const [sheet] = await readBook(readFileSync(path));
  return [...new Set(sheet.rows.slice(1).flatMap((r) => [r[3], r[4]]).filter(Boolean).map(String))];
}
