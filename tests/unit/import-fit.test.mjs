import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, SLOTS, FIT, KINDS, HEADERS } from "../../src/import.js";

const dir = new URL("../../fixtures/school/", import.meta.url);
const SHEET = "Fernhollow";
const HEAD = ["Email", "Course Code", "Kind", "Fact", "Quote"];

const sixBytes = await Promise.all(
  SLOTS.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) })),
);
const rowsOf = async (name) => (await readBook(sixBytes.find((f) => f.name === name).bytes))[0].rows.slice(1);
// Real rows from the invented school: staff rows start [email], course rows start [code].
const staff = await rowsOf("staff.xlsx");
const courses = await rowsOf("courses.xlsx");
const who = (i) => staff[i][0];
const code = (i) => courses[i][0];

// The same random source every time, so two parses give the same T numbers.
const fixedRandom = () => {
  let k = 0;
  return (n) => (k++ * 7) % n;
};

const fitFile = async (rows, head = HEAD) => ({ name: FIT, bytes: await writeBook([{ name: SHEET, rows: [head, ...rows] }]) });
const parseWith = async (rows, head) => parseFiles([...sixBytes, await fitFile(rows, head)], fixedRandom());
const teacher = (school, email) => school.teachers.find((t) => t.email === email);

test("the interface names fit.xlsx, its five kinds and its headers", () => {
  assert.equal(FIT, "fit.xlsx");
  assert.deepEqual(KINDS, ["Language", "Certificate", "Experience", "Skill", "Limitation"]);
  assert.deepEqual(HEADERS[FIT], HEAD);
});

test("without fit.xlsx the School is exactly as today", async () => {
  const a = await parseFiles(sixBytes, fixedRandom());
  const b = await parseFiles([...sixBytes], fixedRandom());
  assert.deepEqual(a, b);
  assert.ok(a.school);
  assert.equal("fit" in a.school, false);
  for (const t of a.school.teachers) assert.equal("fit" in t, false);
  assert.equal(FIT in a.slots, false);
});

test("fit.xlsx rows land on their teacher", async () => {
  const { school, slots } = await parseWith([[who(0), code(1), "Experience", "Climbing", "I am a climber"]]);
  assert.equal(slots[FIT], "ready");
  assert.equal(school.fit, true);
  assert.deepEqual(teacher(school, who(0)).fit, [{ course: code(1), kind: "Experience", fact: "Climbing", quote: "I am a climber" }]);
  for (const t of school.teachers) if (t.email !== who(0)) assert.deepEqual(t.fit, []);
});

test("fit.xlsx does not change anything else on the School", async () => {
  const plain = (await parseFiles(sixBytes, fixedRandom())).school;
  const { school } = await parseWith([[who(0), code(1), "Skill", "Knots", "I tie knots"]]);
  delete school.fit;
  for (const t of school.teachers) delete t.fit;
  assert.deepEqual(school, plain);
});

test("a blank Course Code is a general fact", async () => {
  const { school } = await parseWith([[who(0), null, "Language", "Speaks Malay", "I speak Malay"]]);
  assert.equal(teacher(school, who(0)).fit[0].course, null);
});

test("a blank Quote is kept as an empty string", async () => {
  const { school } = await parseWith([[who(0), code(0), "Certificate", "First aid", null]]);
  assert.equal(teacher(school, who(0)).fit[0].quote, "");
});

test("emails and codes are trimmed, emails lower-cased", async () => {
  const shouty = ` ${who(2).toUpperCase()} `;
  const { school, slots } = await parseWith([[shouty, ` ${code(1)} `, "Skill", " Painting ", " I paint "]]);
  assert.equal(slots[FIT], "ready");
  assert.deepEqual(teacher(school, who(2)).fit, [{ course: code(1), kind: "Skill", fact: "Painting", quote: "I paint" }]);
});

test("refusals give one plain line", async () => {
  const cases = [
    [
      [[who(0), code(0), "Skill", "Knots", ""]],
      ["Email", "Course", "Kind", "Fact", "Quote"],
      "fit.xlsx, row 1: headers must be exactly: Email, Course Code, Kind, Fact, Quote",
    ],
    [[["nobody.here@fernhollow.example", code(0), "Skill", "Knots", ""]], HEAD, "fit.xlsx, row 2: email is not on the staff list"],
    [[[who(0), "NOPE-99", "Skill", "Knots", ""]], HEAD, "fit.xlsx, row 2: course code is not on the course list"],
    [
      [[who(0), code(0), "skill", "Knots", ""]],
      HEAD,
      "fit.xlsx, row 2: kind must be Language, Certificate, Experience, Skill or Limitation",
    ],
    [[[who(0), code(0), "Skill", "  ", "I tie knots"]], HEAD, "fit.xlsx, row 2: fact is empty"],
    [[[who(0), code(0), "Skill", "Knots", "", "stray"]], HEAD, "fit.xlsx, row 2: value outside the headed columns"],
  ];
  for (const [rows, head, line] of cases) {
    const { school, slots } = await parseWith(rows, head);
    assert.equal(slots[FIT], line);
    assert.equal(school, null);
  }
});

test("the same email on many rows is allowed", async () => {
  const { school, slots } = await parseWith([
    [who(0), code(0), "Skill", "Knots", "I tie knots"],
    [who(0), code(1), "Limitation", "No heights", "I fear heights"],
    [who(0), null, "Language", "Speaks Malay", ""],
  ]);
  assert.equal(slots[FIT], "ready");
  assert.equal(teacher(school, who(0)).fit.length, 3);
});

test("another name still says not one of the six file names", async () => {
  const notes = { name: "notes.xlsx", bytes: (await fitFile([])).bytes };
  const { school, slots } = await parseFiles([...sixBytes, notes], fixedRandom());
  assert.equal(slots["notes.xlsx"], "notes.xlsx: not one of the six file names");
  assert.equal(school, null);
});
