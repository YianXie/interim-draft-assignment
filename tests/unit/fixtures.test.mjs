import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook } from "../../src/xlsx.js";

const dir = new URL("../../fixtures/", import.meta.url);
// Laid out like the office's files. The forms start Timestamp, Email, then the choices, then the written answers.
const HEADERS = {
  courses: ["Course Code", "Course Name", "Type", "Seats", "Offered", "Certificate", "Arrival Country", "Arrival City", "Vendor Link"],
  staff: ["Email", "Name", "Certificates"],
  returning: ["Email", "Course Code"],
  round1: ["Timestamp", "Email", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Choice 5", "Choice 6", "Choice 7",
    "Enhancing Learning or Safety", "Notable Priorities", "Final Questions or Comments"],
  round2: ["Timestamp", "Email", "Choice 1", "Choice 2", "Choice 3"],
  singapore: ["Timestamp", "Email", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Choice 5",
    "Enhancing Learning or Safety", "Additional Comments or Questions"],
};
const FORMS = ["round1", "round2", "singapore"];
const CHOICES = { round1: 7, round2: 3, singapore: 5 };
const emailOf = (name, r) => (FORMS.includes(name) ? r[1] : r[0]);

async function load(name) {
  const book = await readBook(new Uint8Array(await readFile(new URL(`school/${name}.xlsx`, dir))));
  return book;
}
async function table(name) {
  const [sheet] = await load(name);
  const [head, ...rows] = sheet.rows;
  return { head, rows: rows.filter((r) => r.some((c) => c !== null && c !== undefined && c !== "")) };
}
const blank = (v) => v === null || v === undefined || v === "";

test("school has the agreed size", async () => {
  const staff = await table("staff");
  const courses = await table("courses");
  assert.equal(staff.rows.length, 96);
  assert.equal(courses.rows.length, 54);
  assert.equal(courses.rows.filter((r) => r[2] === "International").length, 44);
  assert.equal(courses.rows.filter((r) => r[4] === "Yes").length, 48);
  assert.equal(new Set(courses.rows.map((r) => r[1])).size, 54, "course names are unique");
});

test("most courses have 2 seats, one or two have 3, and the offered seats cover every teacher", async () => {
  const staff = await table("staff");
  const courses = await table("courses");
  const seats = courses.rows.map((r) => r[3]);
  assert.ok(seats.every((n) => n === 2 || n === 3), "every course has 2 or 3 seats");
  const threes = seats.filter((n) => n === 3).length;
  assert.ok(threes >= 1 && threes <= 2, `one or two courses with 3 seats, found ${threes}`);
  const offered = courses.rows.filter((r) => r[4] === "Yes").reduce((n, r) => n + r[3], 0);
  assert.ok(offered >= staff.rows.length, `${offered} offered seats for ${staff.rows.length} teachers`);
});

test("every file has sheet Fernhollow and exact headers", async () => {
  for (const [name, headers] of Object.entries(HEADERS)) {
    const book = await load(name);
    assert.equal(book[0].name, "Fernhollow", name);
    assert.deepEqual(book[0].rows[0], headers, name);
  }
});

test("all emails are on fernhollow.example", async () => {
  for (const name of ["staff", "returning", "round1", "round2", "singapore"]) {
    const { rows } = await table(name);
    assert.ok(rows.length > 0, name);
    for (const r of rows) assert.match(emailOf(name, r), /^[a-z.]+@fernhollow\.example$/, name);
  }
});

test("no gender columns anywhere", async () => {
  for (const name of Object.keys(HEADERS)) {
    const { head } = await table(name);
    for (const h of head) assert.doesNotMatch(h, /gender/i, name);
  }
});

test("the Scuba course has one returning sponsor, the only Scuba holder", async () => {
  const courses = await table("courses");
  const scuba = courses.rows.filter((r) => !blank(r[5]));
  assert.equal(scuba.length, 1);
  const [code, , , , offered, cert] = scuba[0];
  assert.equal(offered, "Yes");
  const holders = (await table("staff")).rows.filter((r) => String(r[2] ?? "").split(";").map((s) => s.trim()).includes(cert));
  assert.equal(holders.length, 1);
  const returning = (await table("returning")).rows;
  const sponsors = returning.filter((r) => r[1] === code);
  assert.equal(sponsors.length, 1);
  assert.equal(sponsors[0][0], holders[0][0]);
});

test("one returning sponsor is on a not-offered course and sent a form", async () => {
  const courses = await table("courses");
  const notOffered = new Set(courses.rows.filter((r) => r[4] === "No").map((r) => r[0]));
  const returning = (await table("returning")).rows.filter((r) => notOffered.has(r[1]));
  assert.equal(returning.length, 1);
  const email = returning[0][0];
  let forms = 0;
  for (const name of FORMS) forms += (await table(name)).rows.filter((r) => r[1] === email).length;
  assert.ok(forms >= 1);
});

// dd/mm/yyyy h:mm:ss, read as a UTC time in milliseconds.
const STAMP = /^(\d\d)\/(\d\d)\/(\d{4}) ([1-9]?\d):(\d\d):(\d\d)$/;
const when = (s) => {
  const [, d, m, y, h, mi, se] = s.match(STAMP).map(Number);
  return Date.UTC(y, m - 1, d, h, mi, se);
};
const DAY = 86400000;

test("every form row has a timestamp in dd/mm/yyyy h:mm:ss, in the order the forms were sent", async () => {
  for (const name of FORMS) {
    const { rows } = await table(name);
    for (const r of rows) assert.match(r[0], STAMP, name);
    const times = rows.map((r) => when(r[0]));
    for (const t of times) assert.equal(new Date(t).toISOString().slice(0, 7), "2027-09", name);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `${name} rows are in the order sent`);
  }
});

test("Round 2 forms come one to two weeks after the same teacher's Round 1", async () => {
  const round1 = new Map((await table("round1")).rows.map((r) => [r[1], when(r[0])]));
  const both = (await table("round2")).rows.filter((r) => round1.has(r[1]));
  assert.ok(both.length >= 10, "enough people sent both");
  for (const r of both) {
    const days = (when(r[0]) - round1.get(r[1])) / DAY;
    assert.ok(days >= 6 && days <= 18, `${days.toFixed(1)} days between Round 1 and Round 2`);
  }
  const latest = Math.max(...round1.values());
  for (const r of (await table("round2")).rows) assert.ok(when(r[0]) > latest, "Round 2 opens after Round 1 closes");
});

test("each form's written answers sit after its choices, and name one of the teacher's own courses", async () => {
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  for (const name of ["round1", "singapore"]) {
    const { head, rows } = await table(name);
    const n = CHOICES[name];
    const enhancing = head.indexOf("Enhancing Learning or Safety");
    assert.equal(enhancing, 2 + n, name);
    for (const r of rows) {
      const picks = r.slice(2, 2 + n).filter((c) => !blank(c));
      assert.ok(words(r[enhancing]) >= 35 && words(r[enhancing]) <= 70, `${name}: ${words(r[enhancing])} words`);
      assert.ok(picks.some((c) => r[enhancing].includes(c)), `${name}: the answer names one of the teacher's choices`);
    }
    // The other answers are optional: most are filled in, some are blank, as on a real form.
    for (const col of head.slice(enhancing + 1)) {
      const filled = rows.filter((r) => !blank(r[head.indexOf(col)])).length;
      assert.ok(filled > rows.length / 2 && filled < rows.length, `${name}: ${col} filled ${filled} of ${rows.length}`);
    }
  }
});

test("every course has an arrival country, an arrival city and a placeholder vendor link", async () => {
  const { rows } = await table("courses");
  for (const [code, , type, , , , country, city, link] of rows) {
    assert.ok(!blank(country) && !blank(city), code);
    if (type === "Singapore") assert.deepEqual([country, city], ["Singapore", "Singapore"], code);
    assert.equal(link, `https://example.com/vendors/${code.toLowerCase()}`, code);
  }
});
