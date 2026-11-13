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

test("the past year looks like an ordinary year", async () => {
  const { teachers, past } = await readPastSchool();
  const byEmail = new Map(teachers.map((t) => [t.email, t]));
  const result = (t) => (t.lastYear === null ? null : t.lastYear.result);
  const count = (r) => teachers.filter((t) => result(t) === r).length;
  const staff = (await school("staff")).rows;
  const courses = (await school("courses")).rows;
  const allocation = (await table(ALLOCATION)).rows;
  const sponsorsOf = new Map(allocation.map((r) => [r[0], filled(r, 2)]));
  const courseOf = new Map(allocation.flatMap((r) => filled(r, 2).map((name) => [name, r[1]]))); // sponsor name -> course name
  const forms = [];
  for (const file of FORMS) forms.push((await table(file)).rows);
  const sentPast = new Set(forms.flat().map((r) => r[0]));

  // 1. This year's returning sponsors were on that course last year. Most sent no form then; a few did.
  const returning = (await school("returning")).rows;
  for (const [email, code] of returning) {
    assert.ok((sponsorsOf.get(code) ?? []).includes(byEmail.get(email).name), `a returning sponsor of ${code} was not on it last year`);
  }
  const noFormThen = returning.filter(([email]) => result(byEmail.get(email)) === "noForm").length;
  assert.ok(noFormThen > returning.length / 2, `most returning sponsors sent no past form, found ${noFormThen} of ${returning.length}`);
  const formThen = returning.filter(([email]) => sentPast.has(email)).length;
  assert.ok(formThen >= 2, `at least 2 returning sponsors sent a past form, found ${formThen}`);

  // 2. Everyone on a course that needs a certificate holds it.
  const needing = courses.filter((r) => !blank(r[5]));
  assert.ok(needing.length >= 1 && needing.some((r) => sponsorsOf.has(r[0])), "the Scuba course ran last year");
  for (const [code, , , , , certificate] of needing) {
    const holders = new Set(staff.filter((r) => String(r[2] ?? "").split(";").map((c) => c.trim()).includes(certificate)).map((r) => r[1]));
    for (const name of sponsorsOf.get(code) ?? []) assert.ok(holders.has(name), `a sponsor of ${code} does not hold the ${certificate}`);
  }

  // 3. No course over its seats, at most 4 under, at least 84 of the 96 placed.
  for (const [code, , , seats] of courses) assert.ok((sponsorsOf.get(code) ?? []).length <= seats, `${code} is over its seats`);
  const under = courses.filter(([code, , , seats]) => (sponsorsOf.get(code) ?? []).length < seats).length;
  assert.ok(under <= 4, `at most 4 courses under their seats, found ${under}`);
  assert.equal(staff.length, 96);
  const placed = staff.filter((r) => courseOf.has(r[1])).length;
  assert.ok(placed >= 84, `at least 84 staff placed last year, found ${placed}`);

  // 4. A few staff are new: no past record at all.
  const noRecord = count(null);
  assert.ok(noRecord >= 7 && noRecord <= 9, `7 to 9 staff with no past record, found ${noRecord}`);

  // 5. None of their choices: 10 to 14, most of whom the new priority can help this year.
  const none = count("none");
  assert.ok(none >= 10 && none <= 14, `10 to 14 with none, found ${none}`);
  const owed = teachers.filter((t) => result(t) === "none" && t.submitted && !t.returning).length;
  assert.ok(owed >= 8, `at least 8 with none, a form this year and not returning, found ${owed}`);

  // 6. The other results.
  assert.ok(count("top4") >= 45, `at least 45 on a top-4 choice, found ${count("top4")}`);
  assert.ok(count("5to7") >= 6, `at least 6 on a 5th to 7th choice, found ${count("5to7")}`);
  assert.ok(count("noForm") >= 3, `at least 3 placed without a form, found ${count("noForm")}`);
  assert.ok(count("notFound") >= 1, "notFound");

  // 7. One sponsor entry that matches nobody.
  assert.deepEqual(past.unmatched, [LEFT]);
  assert.equal([...sponsorsOf.values()].flat().filter((e) => e === LEFT).length, 1);

  // 8. A course listed on two past forms by the same person, and someone whose result needs the earliest-form rule:
  // placed on a course they ranked 5th to 7th on the earlier form and 1st to 4th on a later one.
  const listed = new Map(); // email|course -> ranks, in the order Round 1, Round 2, Singapore
  for (const rows of forms) {
    for (const r of rows) {
      r.slice(1).forEach((c, i) => {
        if (!blank(c)) listed.set(`${r[0]}|${c}`, [...(listed.get(`${r[0]}|${c}`) ?? []), i + 1]);
      });
    }
  }
  assert.ok([...listed.values()].some((ranks) => ranks.length >= 2), "a course listed on two past forms by one person");
  const byRule = teachers.filter((t) => {
    const [first, ...later] = listed.get(`${t.email}|${courseOf.get(t.name)}`) ?? [];
    return first >= 5 && later.some((rank) => rank <= 4) && result(t) === "5to7";
  }).length;
  assert.ok(byRule >= 1, "someone placed on a course ranked 5th to 7th on the earlier form and 1st to 4th on a later one");
});

test("expected-past has four values and no spread", async () => {
  const e = JSON.parse(await readFile(new URL("expected-past.json", dir), "utf8"));
  assert.deepEqual(Object.keys(e).sort(), ["owed", "placedMax", "placedMin", "runningMax", "runningMin", "values"]);
  assert.equal(e.values.length, 4);
  assert.equal(e.placedMin, e.placedMax);
  assert.equal(e.runningMin, e.runningMax);
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
