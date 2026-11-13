import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, SLOTS, PAST_SLOTS } from "../../src/import.js";

const dir = new URL("../../fixtures/school/", import.meta.url);
const SHEET = "Fernhollow";
const [ALLOCATION, ROUND1, ROUND2, SINGAPORE] = PAST_SLOTS;
const ALLOCATION_HEADERS =
  "past-allocation.xlsx, row 1: headers must be exactly: Course Code, Course Name, Sponsor 1, Sponsor 2, and so on";
const choices = (n) => Array.from({ length: n }, (_, i) => `Choice ${i + 1}`);

const six = {};
for (const name of SLOTS) six[name] = (await readBook(new Uint8Array(await readFile(new URL(name, dir)))))[0].rows;
// Real rows from the invented school: staff rows are [email, name, certificates], course rows start [code, name].
const staff = six["staff.xlsx"].slice(1);
const courses = six["courses.xlsx"].slice(1);
const who = (i) => staff[i][0];
const named = (i) => staff[i][1];
const course = (i) => courses[i][1];

// A small past year. Staff 0: top 4. Staff 1: none. Staff 2: 5 to 7. Staff 3: top 4, on Round 2.
// Staff 4: placed, no form. Staff 5: a form, not placed. Everyone else: in no past file.
// Course 2 is written with stray spaces, differently in each file.
function validPast() {
  return {
    [ALLOCATION]: [
      ["Course Code", "Course Name", "Sponsor 1", "Sponsor 2"],
      [courses[0][0], course(0), named(0), named(1)],
      [courses[1][0], course(1), named(2)],
      [courses[2][0], ` ${course(2)}`, null, named(3)],
      [courses[3][0], course(3), named(4)],
      [courses[4][0], course(4)],
    ],
    [ROUND1]: [
      ["Email", ...choices(7)],
      [who(0), course(0), course(1)],
      [who(1), course(1), course(2)],
      [who(2), course(0), course(2), course(3), course(4), course(1)],
      [who(5), course(0)],
    ],
    [ROUND2]: [
      ["Email", ...choices(3)],
      [who(3), course(0), `${course(2)}  `],
    ],
    [SINGAPORE]: [
      ["Email", ...choices(5)],
      [who(0), course(1), course(2), course(0)],
    ],
  };
}

const book = (rows, sheet = SHEET) => writeBook([{ name: sheet, rows }]);
// edit(past, now) changes the rows before they are written; `only` picks which past files are added.
async function run({ edit, only = PAST_SLOTS, random } = {}) {
  const past = validPast();
  const now = structuredClone(six);
  edit?.(past, now);
  const files = [];
  for (const name of SLOTS) files.push({ name, bytes: await book(now[name]) });
  for (const name of only) files.push({ name, bytes: await book(past[name], past[name].sheetName) });
  return parseFiles(files, random);
}
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};
const lastYear = (school, i) => school.teachers.find((t) => t.email === who(i)).lastYear;
const byEmail = (school) => Object.fromEntries(school.teachers.map((t) => [t.email, t.lastYear]));
const none = { result: "none", rank: null, round: null };
const notFound = { result: "notFound", rank: null, round: null };
const noForm = { result: "noForm", rank: null, round: null };

test("six files alone: no past key, no lastYear key, no past slot lines", async () => {
  const out = await run({ only: [] });
  assert.deepEqual(Object.keys(out.school), ["school", "year", "courses", "teachers"]);
  assert.deepEqual(Object.keys(out.school.teachers[0]),
    ["id", "name", "email", "returning", "returningCourse", "submitted", "certificates", "prefs"]);
  assert.deepEqual(out.slots, Object.fromEntries(SLOTS.map((name) => [name, "ready"])));
  for (const name of PAST_SLOTS) assert.equal(name in out.slots, false, name);
});

test("ten good files: school.past and a lastYear on every teacher", async () => {
  const out = await run();
  assert.deepEqual(out.slots, Object.fromEntries([...SLOTS, ...PAST_SLOTS].map((name) => [name, "ready"])));
  assert.deepEqual(Object.keys(out.school), ["school", "year", "courses", "teachers", "past"]);
  assert.deepEqual(out.school.past, { unmatched: [] });
  assert.equal(out.school.teachers.length, 96);
  for (const t of out.school.teachers) {
    assert.deepEqual(Object.keys(t),
      ["id", "name", "email", "returning", "returningCourse", "submitted", "certificates", "prefs", "lastYear"]);
  }
  // Staff 0 listed the course 1st in Round 1 and 3rd on the Singapore form: Round 1 is the one shown.
  assert.deepEqual(lastYear(out.school, 0), { result: "top4", rank: 1, round: "Round 1" });
  assert.deepEqual(lastYear(out.school, 1), none);
  assert.deepEqual(lastYear(out.school, 2), { result: "5to7", rank: 5, round: "Round 1" });
  assert.deepEqual(lastYear(out.school, 3), { result: "top4", rank: 2, round: "Round 2" });
  assert.deepEqual(lastYear(out.school, 4), noForm);
  assert.deepEqual(lastYear(out.school, 5), notFound);
  assert.equal(out.school.teachers.filter((t) => t.lastYear === null).length, 90);
  // This year's reading is untouched by the past files.
  const alone = await run({ only: [], random: seq() });
  const withPast = await run({ random: seq() });
  assert.deepEqual(withPast.school.courses, alone.school.courses);
  assert.deepEqual(withPast.school.teachers.map(({ lastYear: _, ...t }) => t), alone.school.teachers);
});

test("one to three past files: the missing ones say file not added and school is null", async () => {
  for (const only of [[ALLOCATION], [ROUND1, SINGAPORE], [ROUND1, ROUND2, SINGAPORE], [ALLOCATION, ROUND1, ROUND2]]) {
    const out = await run({ only });
    assert.equal(out.school, null, only.join());
    for (const name of SLOTS) assert.equal(out.slots[name], "ready");
    for (const name of PAST_SLOTS) {
      assert.equal(out.slots[name], only.includes(name) ? "ready" : `${name}: file not added`);
    }
  }
});

test("past-allocation headers: Sponsor columns may be any number, but not zero and not out of order", async () => {
  const head = (...sponsors) => (past) => {
    past[ALLOCATION][0] = ["Course Code", "Course Name", ...sponsors];
  };
  const one = await run({
    edit: (past) => {
      past[ALLOCATION] = [["Course Code", "Course Name", "Sponsor 1"], [courses[0][0], course(0), named(0)]];
    },
  });
  assert.ok(one.school, JSON.stringify(one.slots));
  assert.deepEqual(lastYear(one.school, 0), { result: "top4", rank: 1, round: "Round 1" });
  const five = await run({ edit: head("Sponsor 1", "Sponsor 2", "Sponsor 3", "Sponsor 4", "Sponsor 5") });
  assert.ok(five.school, JSON.stringify(five.slots));
  const wrong = [
    head(),
    head("Sponsor 2", "Sponsor 1"),
    head("Sponsor 2"),
    head("Sponsor 1", "Sponsor 3"),
    head("Sponsor 1", null, "Sponsor 2"),
    head("Sponsor 1", "Sponsor 2", "Notes"),
    head("Sponsor"),
    (past) => (past[ALLOCATION][0] = ["Course Name", "Course Code", "Sponsor 1", "Sponsor 2"]),
    (past) => (past[ALLOCATION][0] = ["Code", "Course Name", "Sponsor 1", "Sponsor 2"]),
  ];
  for (const [i, edit] of wrong.entries()) {
    const out = await run({ edit });
    assert.equal(out.school, null, `wrong header ${i}`);
    assert.equal(out.slots[ALLOCATION], ALLOCATION_HEADERS, `wrong header ${i}`);
  }
});

test("each allocation refusal gives file and row", async () => {
  const refused = async (file, edit, line) => {
    const out = await run({ edit });
    assert.equal(out.school, null, line);
    assert.equal(out.slots[file], line);
    for (const name of [...SLOTS, ...PAST_SLOTS]) if (name !== file) assert.equal(out.slots[name], "ready", line);
  };
  for (const file of PAST_SLOTS) {
    await refused(file, (past) => (past[file].sheetName = "Sheet1"), `${file}: first sheet must be named Fernhollow`);
  }
  await refused(ALLOCATION, (past) => (past[ALLOCATION][0] = ["Course Code", "Course Name"]), ALLOCATION_HEADERS);
  await refused(ALLOCATION, (past) => (past[ALLOCATION][2][0] = " "), "past-allocation.xlsx, row 3: course code is empty");
  await refused(ALLOCATION, (past) => (past[ALLOCATION][4][0] = courses[1][0]),
    "past-allocation.xlsx, row 5: course code appears twice");
  await refused(ALLOCATION, (past) => (past[ALLOCATION][3][1] = null), "past-allocation.xlsx, row 4: course name is empty");
  await refused(ALLOCATION, (past) => (past[ALLOCATION][5][1] = course(0)),
    "past-allocation.xlsx, row 6: course name appears twice");
  // The same person written two ways, on two courses.
  await refused(ALLOCATION, (past) => (past[ALLOCATION][5][2] = `  ${named(0).toUpperCase().replace(" ", "   ")} `),
    "past-allocation.xlsx, row 6: a sponsor appears twice in this file");
  // And twice on one course.
  await refused(ALLOCATION, (past) => (past[ALLOCATION][2][3] = named(2)),
    "past-allocation.xlsx, row 3: a sponsor appears twice in this file");
});

test("past form files give the existing lines for headers and emails", async () => {
  const line = async (file, edit) => {
    const out = await run({ edit });
    assert.equal(out.school, null);
    return out.slots[file];
  };
  assert.equal(await line(ROUND1, (past) => (past[ROUND1][0] = ["Email", ...choices(3)])),
    `past-round1.xlsx, row 1: headers must be exactly: Email, ${choices(7).join(", ")}`);
  assert.equal(await line(ROUND2, (past) => (past[ROUND2][0] = ["Email", ...choices(7)])),
    "past-round2.xlsx, row 1: headers must be exactly: Email, Choice 1, Choice 2, Choice 3");
  assert.equal(await line(SINGAPORE, (past) => (past[SINGAPORE][0][0] = "E-mail")),
    `past-singapore.xlsx, row 1: headers must be exactly: Email, ${choices(5).join(", ")}`);
  assert.equal(await line(ROUND2, (past) => (past[ROUND2][1][0] = "")), "past-round2.xlsx, row 2: email is empty");
  assert.equal(await line(ROUND1, (past) => past[ROUND1].push([` ${who(1).toUpperCase()}`, course(3)])),
    "past-round1.xlsx, row 6: email appears twice in this file");
});

test("a past choice not on any course list is accepted", async () => {
  const out = await run({
    edit: (past) => {
      past[ROUND1][2][1] = "A course that did not run";
      past[SINGAPORE].push([who(4), "Another course that did not run"]);
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(lastYear(out.school, 1), none);
  assert.deepEqual(lastYear(out.school, 4), none);
});

test("a past email not on this year's staff is accepted and ignored", async () => {
  const base = await run({ random: seq() });
  const out = await run({
    random: seq(),
    edit: (past) => {
      past[ROUND1].push(["nobody.here@fernhollow.example", course(0)]);
      past[ROUND2].push(["nobody.here@fernhollow.example"]);
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school, base.school);
});

test("a past email outside fernhollow.example is refused with file and row", async () => {
  const out = await run({ edit: (past) => (past[ROUND1][2][0] = "x.y@elsewhere.example") });
  assert.equal(out.school, null);
  assert.equal(out.slots[ROUND1], "past-round1.xlsx, row 3: email is not on fernhollow.example");
  const second = await run({ edit: (past) => (past[SINGAPORE][1][0] = "@fernhollow.example") });
  assert.equal(second.slots[SINGAPORE], "past-singapore.xlsx, row 2: email is not on fernhollow.example");
});

test("no name, email or course text reaches a past problem line", async () => {
  const edits = [
    (past) => {
      past[ALLOCATION][5][2] = named(0);
      past[ROUND1][2][0] = "x.y@elsewhere.example";
      past[ROUND2].push([who(3), "A course that did not run"]);
      past[SINGAPORE][0][2] = "Second";
    },
    (past) => {
      past[ALLOCATION][5][1] = course(0);
      past[ROUND1][1][0] = null;
      past[ROUND2].sheetName = "Sheet1";
    },
    (past) => (past[ALLOCATION][4][0] = courses[1][0]),
    (past) => (past[ALLOCATION][0][3] = "Sponsor B"),
    (past) => (past[ALLOCATION][2][0] = null),
    (past) => (past[ALLOCATION][3][1] = ""),
  ];
  const lines = [];
  for (const edit of edits) {
    const out = await run({ edit });
    assert.equal(out.school, null);
    lines.push(...PAST_SLOTS.map((name) => out.slots[name]).filter((line) => line !== "ready"));
  }
  assert.equal(lines.length, 11);
  for (const line of lines) {
    for (const s of staff) assert.ok(!line.includes(s[0]) && !line.includes(s[1]), line);
    for (const c of courses) assert.ok(!line.includes(c[0]) && !line.includes(c[1]), line);
    for (const bad of ["elsewhere", "x.y", "did not run", "Second", "Sponsor B"]) assert.ok(!line.includes(bad), line);
    assert.match(line, /^past-[a-z0-9]+\.xlsx(, row \d+)?: /);
  }
});

test("T numbers do not change which teacher gets which lastYear", async () => {
  const a = await run({ random: seq() });
  const b = await run({ random: (n) => n - 1 });
  assert.notDeepEqual(a.school.teachers.map((t) => t.id), b.school.teachers.map((t) => t.id));
  assert.deepEqual(byEmail(a.school), byEmail(b.school));
  assert.deepEqual(a.school.past, b.school.past);
  assert.deepEqual(lastYear(b.school, 0), { result: "top4", rank: 1, round: "Round 1" });
});

test("unmatched keeps the entries as written and in file order", async () => {
  const out = await run({
    edit: (past, now) => {
      // Two of this year's staff now share a name, so that name matches neither.
      now["staff.xlsx"][7][1] = named(4);
      past[ALLOCATION][0].push("Sponsor 3");
      past[ALLOCATION][1].push("  Sponsor who left ");
      past[ALLOCATION][2].push("Another sponsor who left");
      past[ALLOCATION][5].push("LEFT in the summer");
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school.past, {
    unmatched: ["Sponsor who left", "Another sponsor who left", named(4), "LEFT in the summer"],
  });
  assert.notDeepEqual(out.school.past.unmatched, [...out.school.past.unmatched].sort());
  // Neither holder of the shared name is counted as placed.
  assert.equal(lastYear(out.school, 4), null);
  assert.equal(lastYear(out.school, 6), null);
  assert.deepEqual(lastYear(out.school, 0), { result: "top4", rank: 1, round: "Round 1" });
});

test("a past form row with every choice blank still counts as a form", async () => {
  const out = await run({
    edit: (past) => {
      past[ROUND1][2] = [who(1)];
      past[ROUND2].push([who(6), "", null, " "]);
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(lastYear(out.school, 1), none); // placed, blank form
  assert.deepEqual(lastYear(out.school, 6), notFound); // blank form, not on the allocation
  // Without those rows: placed with no form, and in no past file.
  const without = await run({ edit: (past) => past[ROUND1].splice(2, 1) });
  assert.deepEqual(lastYear(without.school, 1), noForm);
  assert.equal(lastYear(without.school, 6), null);
});

test("past emails match this year's staff whatever their letter case or stray spaces", async () => {
  const base = await run({ random: seq() });
  const out = await run({
    random: seq(),
    edit: (past) => {
      for (const file of [ROUND1, ROUND2, SINGAPORE]) {
        for (const row of past[file].slice(1)) row[0] = `  ${row[0].toUpperCase()} `;
      }
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school, base.school);
  assert.deepEqual(lastYear(out.school, 0), { result: "top4", rank: 1, round: "Round 1" });
});

test("cells past the last header are not read", async () => {
  const base = await run({ random: seq() });
  const out = await run({
    random: seq(),
    edit: (past) => {
      // An 8th choice on a 7-choice form, and a sponsor cell under no Sponsor column.
      past[ROUND1][2] = [who(1), course(1), course(2), null, null, null, null, null, course(0)];
      past[ALLOCATION][3] = [courses[2][0], course(2), null, named(3), named(5)];
    },
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school, base.school);
});
