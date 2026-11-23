// tools/compare.mjs on the invented school: the solved draft against an "office" allocation made from it with known changes.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSchool } from "./school-fixture.mjs";
import { loadHighs, solveDraft } from "../../src/solver.js";
import { writeBook, readBook } from "../../src/xlsx.js";
import { SLOTS } from "../../src/import.js";
import { compare, readDraft, readOffice, builtWithOther } from "../../tools/compare/compare.mjs";
import { Mock } from "../../src/state.js";
import { toDraft } from "../../src/solver.js";
import { sheetsFor } from "../../src/export.js";

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL("../../tools/compare.mjs", import.meta.url));
const SIX = fileURLToPath(new URL("../../fixtures/school/", import.meta.url));

let school, pairs;
before(async () => {
  school = await readSchool();
  pairs = solveDraft(await loadHighs({}), school).pairs;
});

const teacher = (id) => school.teachers.find((t) => t.id === id);
// The download's Teachers sheet, with names on.
const draftSheets = (ps) => [{ name: "Teachers", rows: [["Teacher", "Email", "Course Code", "Course", "Choice", "Why", "Status"],
  ...school.teachers.map((t) => { const p = ps.find(([id]) => id === t.id); return [t.name, t.email, p ? p[1] : "", "", "", "", ""]; })] }];
// The office's layout: Trip Code, Course Name with the code in front, sponsors by name.
const officeRows = (ps) => {
  const by = new Map();
  for (const [t, c] of ps) by.set(c, [...(by.get(c) ?? []), teacher(t).name]);
  const n = Math.max(...[...by.values()].map((v) => v.length));
  return [["Trip Code", "Course Name", ...Array.from({ length: n }, (_, i) => `Sponsor ${i + 1}`)],
    ...[...by].map(([c, names]) => { const course = school.courses.find((x) => x.id === c); return [c, `${c} ${course.name}`, ...names, ...Array(n - names.length).fill("")]; })];
};
const value = (summary, label) => summary.find((r) => r[0] === label);

test("the same allocation on both sides agrees everywhere", () => {
  const report = [];
  const r = compare(school, readDraft(school, draftSheets(pairs), report), readOffice(school, officeRows(pairs), report));
  assert.deepEqual(report, []);
  assert.deepEqual(value(r.summary, "On the same course in both"), ["On the same course in both", pairs.length]);
  assert.deepEqual(value(r.summary, "Placed in both, on different courses"), ["Placed in both, on different courses", 0]);
  const d = value(r.summary, "Preference points (the draft's second measure)");
  assert.equal(d[1], d[2]);
  assert.deepEqual(value(r.summary, "Broken rules, all"), ["Broken rules, all", 0, 0]);
  // The choice table is all on its diagonal.
  for (let i = 1; i < r.cross.length - 1; i++) r.cross[i].slice(1, -1).forEach((v, j) => j + 1 !== i && assert.equal(v, 0));
});

// The page's own download, not a hand-typed sheet: a renamed column or sheet in export.js must fail here.
test("the page's download with names on is read, and its Files sheet agrees with the six alone", () => {
  Mock.init(school);
  Mock.build(toDraft(school, pairs));
  Mock.setNames(true);
  const sheets = sheetsFor(Mock);
  const report = [];
  assert.deepEqual([...readDraft(school, sheets, report)].sort(), pairs.map(([t, c]) => [t, c]).sort());
  assert.deepEqual(report, []);
  assert.deepEqual(builtWithOther(school, sheets), []);
});

test("a folder with files the draft was not built with, or without ones it was, is said", () => {
  const files = (past, fit) => [{ name: "Files", rows: [["File", "Added"], ...["past-allocation.xlsx", "past-round1.xlsx", "past-round2.xlsx", "past-singapore.xlsx"].map((f) => [f, past]), ["fit.xlsx", fit]] }];
  assert.deepEqual(builtWithOther(school, files("No", "No")), []);
  assert.deepEqual(builtWithOther({ ...school, fit: true }, files("No", "No")), ["the folder has fit.xlsx, but the draft was built without it: its measures count things the draft never saw"]);
  assert.deepEqual(builtWithOther(school, files("Yes", "No")), ["the draft was built with last year's files, but the folder does not have them: their measures are left out"]);
  assert.equal(builtWithOther({ ...school, past: { unmatched: [] }, fit: true }, files("Yes", "Yes")).length, 0);
  assert.equal(builtWithOther({ ...school, past: { unmatched: [] } }, files("No", "Yes")).length, 2);
  // An older download has no Files sheet: nothing can be said.
  assert.deepEqual(builtWithOther({ ...school, fit: true }, []), []);
});

test("points match the solver's second value", async () => {
  const report = [];
  const r = compare(school, readDraft(school, draftSheets(pairs), report), readOffice(school, officeRows(pairs), report));
  const expected = JSON.parse(await readFile(new URL("../../fixtures/expected.json", import.meta.url), "utf8"));
  assert.equal(value(r.summary, "Preference points (the draft's second measure)")[1], expected.values[1]);
});

test("an office that drops one teacher and misspells another is counted and reported", () => {
  const [gone, ...rest] = pairs;
  const rows = officeRows(rest);
  rows.push(["NOPE-1", "NOPE-1 Nowhere", "Somebody Else"]);
  const report = [];
  const r = compare(school, readDraft(school, draftSheets(pairs), report), readOffice(school, rows, report));
  assert.equal(value(r.summary, "Placed in the draft only")[1], 1);
  assert.equal(value(r.summary, "Teachers placed")[2], pairs.length - 1);
  assert.equal(report.length, 1);
  assert.match(report[0], /NOPE-1/);
  const line = r.teachers.find((row) => row[1] === teacher(gone[0]).email);
  assert.equal(line[4], "");
  assert.equal(line[5], "Not placed");
});

test("a sponsor named another way is matched by the school's email rule", () => {
  // The office writes first initial + last name in the email; the fixture writes first.last, so one teacher is changed here.
  const [first, ...rest] = pairs;
  const t = teacher(first[0]);
  const [given, ...family] = t.name.split(" ");
  const local = (given[0] + family.at(-1)).toLowerCase();
  const changed = { ...school, teachers: school.teachers.map((x) => (x.id === t.id ? { ...x, email: `${local}@fernhollow.example` } : x)) };
  const rows = officeRows(rest);
  rows.push([first[1], first[1], `${given[0]}. ${family.join(" ")}`]);
  const report = [];
  assert.equal(readOffice(changed, rows, report).get(t.id), first[1]);
  assert.deepEqual(report, []);
});

test("a download with names off is refused", () => {
  const sheets = [{ name: "Teachers", rows: [["Teacher", "Course Code"], ["T100", "X"]] }];
  assert.throws(() => readDraft(school, sheets, []), /names on/);
});

test("the command prints the summary and writes a new workbook, never over one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compare-"));
  await mkdir(join(dir, "six"));
  for (const name of SLOTS) await copyFile(join(SIX, name), join(dir, "six", name));
  await writeFile(join(dir, "draft.xlsx"), await writeBook(draftSheets(pairs)));
  await writeFile(join(dir, "office.xlsx"), await writeBook([{ name: "Sheet1", rows: officeRows(pairs.slice(1)) }]));
  const args = ["--six", join(dir, "six"), "--draft", join(dir, "draft.xlsx"), "--office", join(dir, "office.xlsx"), "--out", join(dir, "out.xlsx")];
  const { stdout } = await run(process.execPath, [TOOL, ...args]);
  assert.match(stdout, /Compared with the six only/);
  assert.match(stdout, /Teachers placed/);
  assert.match(stdout, /Every row was matched/);
  const out = await readBook(new Uint8Array(await readFile(join(dir, "out.xlsx"))));
  assert.deepEqual(out.map((s) => s.name), ["Summary", "Choices", "Teachers", "Courses", "To check"]);
  await assert.rejects(run(process.execPath, [TOOL, ...args]), (e) => e.code === 1 && /already exists/.test(e.stderr));
});
