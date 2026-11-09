import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, SLOTS } from "../../src/import.js";
import { readSchool } from "./school-fixture.mjs";

const dir = new URL("../../fixtures/school/", import.meta.url);
const SHEET = "Fernhollow";

async function load() {
  const out = {};
  for (const name of SLOTS) out[name] = (await readBook(new Uint8Array(await readFile(new URL(name, dir)))))[0].rows;
  return out;
}
async function run(edit, random) {
  const rows = await load();
  const names = {};
  edit?.(rows, names);
  const files = [];
  for (const name of SLOTS) {
    files.push({ name: names[name] ?? name, bytes: await writeBook([{ name: rows[name].sheetName ?? SHEET, rows: rows[name] }]) });
  }
  return parseFiles(files, random);
}
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};

test("six good files give the agreed school", async () => {
  const school = await readSchool();
  assert.equal(school.school, "Fernhollow Academy");
  assert.equal(school.year, "Interim 2028");
  assert.equal(school.teachers.length, 96);
  assert.equal(school.courses.length, 40);
  assert.equal(school.courses.filter((c) => c.running).length, 34);
  assert.deepEqual(Object.keys(school.courses[0]), ["id", "name", "kind", "seats", "running", "needs"]);
  assert.deepEqual(Object.keys(school.teachers[0]),
    ["id", "name", "email", "returning", "returningCourse", "submitted", "certificates", "prefs"]);
  const ids = new Set(school.courses.map((c) => c.id));
  for (const t of school.teachers) {
    for (const p of t.prefs) {
      assert.ok(ids.has(p.course));
      assert.ok(["Round 1", "Round 2", "Singapore"].includes(p.round));
    }
    if (t.returning) assert.ok(ids.has(t.returningCourse));
  }
  assert.ok(school.teachers.some((t) => t.returning));
  assert.ok(school.teachers.some((t) => !t.submitted));
  assert.ok(school.courses.some((c) => c.needs));
});

test("T numbers are unique T100..T999 and come from the random source", async () => {
  const a = await readSchool(seq());
  const ids = a.teachers.map((t) => t.id);
  assert.equal(new Set(ids).size, 96);
  for (const id of ids) assert.match(id, /^T[1-9]\d\d$/);
  // random(n) = 0 every time always takes the front of the pool
  const first = await readSchool(() => 0);
  assert.equal(first.teachers[0].id, "T100");
  const again = await readSchool(seq());
  assert.deepEqual(again.teachers.map((t) => t.id), ids);
  const last = await readSchool((n) => n - 1);
  assert.equal(last.teachers[0].id, "T999");
  const def = await readSchool();
  assert.equal(new Set(def.teachers.map((t) => t.id)).size, 96);
});

test("wrong file name is refused", async () => {
  const out = await run((_, names) => (names["staff.xlsx"] = "teachers.xlsx"));
  assert.equal(out.school, null);
  assert.match(out.slots["teachers.xlsx"], /^teachers\.xlsx: /);
  assert.match(out.slots["staff.xlsx"], /^staff\.xlsx: /);
});

test("sheet not named Fernhollow is refused", async () => {
  const out = await run((rows) => (rows["round2.xlsx"].sheetName = "Sheet1"));
  assert.equal(out.school, null);
  assert.equal(out.slots["round2.xlsx"], "round2.xlsx: first sheet must be named Fernhollow");
  assert.equal(out.slots["staff.xlsx"], "ready");
});

test("wrong header is refused with the file name", async () => {
  const out = await run((rows) => (rows["returning.xlsx"][0][1] = "Course"));
  assert.equal(out.school, null);
  assert.match(out.slots["returning.xlsx"], /^returning\.xlsx, row 1: headers must be exactly/);
});

test("email outside fernhollow.example is refused with file and row", async () => {
  const out = await run((rows) => (rows["staff.xlsx"][4][0] = "x.y@elsewhere.example"));
  assert.equal(out.school, null);
  assert.equal(out.slots["staff.xlsx"], "staff.xlsx, row 5: email is not on fernhollow.example");
});

test("form email not on the staff list is refused", async () => {
  const out = await run((rows) => (rows["round1.xlsx"][3][0] = "nobody.here@fernhollow.example"));
  assert.equal(out.school, null);
  assert.equal(out.slots["round1.xlsx"], "round1.xlsx, row 4: email is not on the staff list");
});

test("choice not on the course list is refused with file and row", async () => {
  const out = await run((rows) => (rows["singapore.xlsx"][2][3] = "Underwater Basket Weaving"));
  assert.equal(out.school, null);
  assert.equal(out.slots["singapore.xlsx"], "singapore.xlsx, row 3: Choice 3 is not on the course list");
});

test("same email twice in one file is refused", async () => {
  const out = await run((rows) => rows["round2.xlsx"].push([...rows["round2.xlsx"][1]]));
  assert.equal(out.school, null);
  assert.match(out.slots["round2.xlsx"], /^round2\.xlsx, row \d+: email appears twice in this file$/);
});

test("returning code not on the course list is refused", async () => {
  const out = await run((rows) => (rows["returning.xlsx"][2][1] = "ZZ-99"));
  assert.equal(out.school, null);
  assert.equal(out.slots["returning.xlsx"], "returning.xlsx, row 3: course code is not on the course list");
});

test("seats not a positive whole number is refused", async () => {
  for (const bad of [0, -1, 2.5, "three", null]) {
    const out = await run((rows) => (rows["courses.xlsx"][5][3] = bad));
    assert.equal(out.school, null, String(bad));
    assert.equal(out.slots["courses.xlsx"], "courses.xlsx, row 6: seats must be a positive whole number");
  }
});

test("a returning sponsor on a not-offered course is treated like anyone else", async () => {
  const base = await readSchool();
  const closed = new Set(base.courses.filter((c) => !c.running).map((c) => c.id));
  const rows = await load();
  const row = rows["returning.xlsx"].slice(1).find((r) => closed.has(r[1]));
  assert.ok(row, "fixture has a returning sponsor on a not-offered course");
  const t = base.teachers.find((x) => x.email === row[0]);
  assert.equal(t.returning, false);
  assert.equal(t.returningCourse, null);
  assert.equal(t.submitted, true);
  const offeredRows = rows["returning.xlsx"].slice(1).filter((r) => !closed.has(r[1])).length;
  assert.equal(base.teachers.filter((x) => x.returning).length, offeredRows);
});

test("blank choices are skipped and ranks keep their column number", async () => {
  const out = await run((rows) => {
    rows["round2.xlsx"][1][1] = "";
    rows["round2.xlsx"][1][2] = null;
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  const rows = await load();
  const t = out.school.teachers.find((x) => x.email === rows["round2.xlsx"][1][0]);
  const r2 = t.prefs.filter((p) => p.round === "Round 2");
  assert.deepEqual(r2.map((p) => p.rank), [3]);
  const course = out.school.courses.find((c) => c.name === rows["round2.xlsx"][1][3]);
  assert.equal(r2[0].course, course.id);
});

test("no name or email reaches a problem line beyond the bad value's file and row", async () => {
  const staff = (await load())["staff.xlsx"].slice(1);
  const out = await run((rows) => {
    rows["staff.xlsx"][4][0] = "x.y@elsewhere.example";
    rows["round1.xlsx"][3][0] = "nobody.here@fernhollow.example";
    rows["returning.xlsx"][2][1] = "ZZ-99";
    rows["singapore.xlsx"][2][3] = "Underwater Basket Weaving";
  });
  for (const line of Object.values(out.slots)) {
    for (const s of staff) {
      assert.ok(!line.includes(s[0]) && !line.includes(s[1]), line);
    }
    for (const bad of ["elsewhere", "nobody.here", "ZZ-99", "Underwater"]) assert.ok(!line.includes(bad), line);
  }
});
