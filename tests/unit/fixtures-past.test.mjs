import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readBook } from "../../src/xlsx.js";
import { readPastSchool, pastFiles } from "./past-fixture.mjs";

const dir = new URL("../../fixtures/", import.meta.url);
const [ALLOCATION, ...FORMS] = pastFiles;
const LEFT = "Sponsor who left";
const choices = (n) => Array.from({ length: n }, (_, i) => `Choice ${i + 1}`);
const FORM_HEADERS = {
  "past-round1.xlsx": ["Email", ...choices(7)],
  "past-round2.xlsx": ["Email", ...choices(3)],
  "past-singapore.xlsx": ["Email", ...choices(5)],
};
// The six files and the expected values as they were before the past year was added.
const SCHOOL_SHA256 = {
  "courses.xlsx": "2cbe51c3924198b3cc80e193f5a7f31fbc69222c2057308baff95dff71abb323",
  "returning.xlsx": "e5119d15cc959fa26c16ba12f43712345f7651610123d1387b6981b4d1f63a51",
  "round1.xlsx": "781c374bed18a4023159e530d77e916ab53442f336279793b7c3594baac15c6b",
  "round2.xlsx": "427d114874b04c9eb045a3630d1420c96a9ec56d7ce8cf0840554a606edfbfc7",
  "singapore.xlsx": "1bdc6de97218f7cdef44fa4244746ccc13ffef0eb922ac1bc0f2c47a4cc82ba9",
  "staff.xlsx": "aa1093bf72a8b749368ab142e3147a5ccb370f7f054bf56c5cda161f1e7fd8ec",
};

const blank = (v) => v === null || v === undefined || v === "";
async function load(file) {
  return readBook(new Uint8Array(await readFile(file)));
}
async function table(file) {
  const [sheet] = await load(file);
  const [head, ...rows] = sheet.rows;
  return { head, rows: rows.filter((r) => r.some((c) => !blank(c))) };
}
const school = (name) => table(new URL(`school/${name}.xlsx`, dir));
const filled = (row, from) => row.slice(from).filter((c) => !blank(c));

test("the four past files have sheet Fernhollow and the agreed headers", async () => {
  for (const file of pastFiles) assert.equal((await load(file))[0].name, "Fernhollow", basename(file));
  const { head } = await table(ALLOCATION);
  assert.ok(head.length >= 3, "at least one Sponsor column");
  assert.deepEqual(head, ["Course Code", "Course Name", ...head.slice(2).map((_, i) => `Sponsor ${i + 1}`)]);
  for (const file of FORMS) assert.deepEqual((await table(file)).head, FORM_HEADERS[basename(file)], basename(file));
});

test("all past emails are on fernhollow.example", async () => {
  for (const file of FORMS) {
    const { rows } = await table(file);
    assert.ok(rows.length > 0, basename(file));
    for (const r of rows) assert.match(r[0], /^[a-z.]+@fernhollow\.example$/, basename(file));
  }
});

test("no gender or comment columns in the past files", async () => {
  for (const file of pastFiles) {
    const { head } = await table(file);
    for (const h of head) assert.doesNotMatch(h, /gender|comment/i, basename(file));
  }
});

test("every past name and course name already exists in fixtures/school", async () => {
  const staff = (await school("staff")).rows;
  const emails = new Set(staff.map((r) => r[0]));
  const names = new Set(staff.map((r) => r[1]));
  const courses = (await school("courses")).rows;
  const nameOf = new Map(courses.map((r) => [r[0], r[1]]));
  const courseNames = new Set(nameOf.values());

  const allocation = (await table(ALLOCATION)).rows;
  assert.ok(allocation.length > 0);
  for (const r of allocation) {
    assert.equal(r[1], nameOf.get(r[0]), `course ${r[0]} keeps its name`);
    for (const sponsor of filled(r, 2)) assert.ok(sponsor === LEFT || names.has(sponsor), `a sponsor of ${r[0]} is not on the staff list`);
  }
  for (const file of FORMS) {
    for (const r of (await table(file)).rows) {
      assert.ok(emails.has(r[0]), `${basename(file)}: an email is not on the staff list`);
      for (const c of filled(r, 1)) assert.ok(courseNames.has(c), `${basename(file)}: ${c}`);
    }
  }
});

test("the past year has every required case", async () => {
  const { teachers, past } = await readPastSchool();
  const count = (f) => teachers.filter(f).length;
  const got = (result) => (t) => t.lastYear !== null && t.lastYear.result === result;

  const noRecord = count((t) => t.lastYear === null);
  assert.ok(noRecord >= 6 && noRecord <= 10, `about 8 staff with no past record, found ${noRecord}`);
  const owed = count((t) => got("none")(t) && t.submitted && !t.returning);
  assert.ok(owed >= 8, `at least 8 with none, a form this year and not returning, found ${owed}`);
  for (const result of ["top4", "5to7", "noForm"]) assert.ok(count(got(result)) >= 3, result);
  assert.ok(count(got("notFound")) >= 1, "notFound");

  assert.deepEqual(past.unmatched, [LEFT]);
  const entries = (await table(ALLOCATION)).rows.flatMap((r) => filled(r, 2));
  assert.equal(entries.filter((e) => e === LEFT).length, 1);

  // A course listed on two past forms by the same person.
  const listed = new Set();
  let twice = 0;
  for (const file of FORMS) {
    const here = (await table(file)).rows.flatMap((r) => filled(r, 1).map((c) => `${r[0]}|${c}`));
    twice += here.filter((k) => listed.has(k)).length;
    for (const k of here) listed.add(k);
  }
  assert.ok(twice >= 1, "a course listed on two past forms by one person");
});

test("expected-past has four values and no spread", async () => {
  const e = JSON.parse(await readFile(new URL("expected-past.json", dir), "utf8"));
  assert.deepEqual(Object.keys(e).sort(), ["owed", "placedMax", "placedMin", "runningMax", "runningMin", "values"]);
  assert.equal(e.values.length, 4);
  assert.equal(e.placedMin, e.placedMax);
  assert.equal(e.runningMin, e.runningMax);
});

test("some owed teacher cannot be given a top-4 choice", async () => {
  const e = JSON.parse(await readFile(new URL("expected-past.json", dir), "utf8"));
  assert.ok(Number.isInteger(e.owed) && e.owed >= 1);
  assert.ok(e.values[1] < e.owed, `${e.values[1]} of ${e.owed} owed teachers are on a top-4 choice`);
});

test("fixtures/school and expected.json are untouched", async () => {
  for (const [name, sha] of Object.entries(SCHOOL_SHA256)) {
    const bytes = await readFile(new URL(`school/${name}`, dir));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, name);
  }
  const e = JSON.parse(await readFile(new URL("expected.json", dir), "utf8"));
  assert.deepEqual(e, { values: [1, 1366, 3], placedMin: 84, placedMax: 84, runningMin: 34, runningMax: 34 });
  assert.equal(e.values.length, 3);
});
