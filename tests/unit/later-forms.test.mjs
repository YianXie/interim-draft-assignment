// readForms adds round2.xlsx or singapore.xlsx to a School that is already built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, readForms, SLOTS, HEADERS } from "../../src/import.js";

const dir = new URL("../../fixtures/school/", import.meta.url);
const ROUND2 = "round2.xlsx";
const SINGAPORE = "singapore.xlsx";
const fixture = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) });
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};
const LATER_NAMES = [ROUND2, SINGAPORE];
const form = async (name, rows) => ({ name, bytes: await writeBook([{ name: "Fernhollow", rows: [HEADERS[name], ...rows] }]) });
const row = (name, email, ...choices) => {
  const cells = Array(HEADERS[name].length).fill(null);
  cells[1] = email;
  choices.forEach((c, i) => { cells[2 + i] = c; });
  return cells;
};

const base = (await parseFiles(await Promise.all(SLOTS.filter((n) => !LATER_NAMES.includes(n)).map(fixture)), seq())).school;
const baseBefore = structuredClone(base);
const byEmail = (school) => new Map(school.teachers.map((t) => [t.email, t]));

test("adding both later forms gives the same choices as building with all six", async () => {
  const six = (await parseFiles(await Promise.all(SLOTS.map(fixture)), seq())).school;
  const out = await readForms(base, await Promise.all(LATER_NAMES.map(fixture)));
  assert.ok(out.school);
  assert.deepEqual(out.rounds, ["Round 2", "Singapore"]);
  const got = byEmail(out.school);
  for (const t of six.teachers) {
    const g = got.get(t.email);
    assert.deepEqual(g.prefs, t.prefs);
    assert.equal(g.submitted, t.submitted);
    assert.equal(g.id, byEmail(base).get(t.email).id);
  }
  assert.ok(out.senders.length > 0);
  assert.deepEqual(out.senders, [...out.senders].sort());
  assert.deepEqual(base, baseBefore);
});

test("a round already in the school is replaced", async () => {
  const files = [await fixture(ROUND2)];
  const once = await readForms(base, files);
  const twice = await readForms(once.school, files);
  assert.deepEqual(twice.school, once.school);
});

test("submitted never goes back to false", async () => {
  const [a, b] = base.teachers.filter((t) => !t.submitted);
  const course = base.courses.find((c) => c.kind === "International").name;
  const first = await readForms(base, [await form(ROUND2, [row(ROUND2, a.email, course)])]);
  assert.equal(byEmail(first.school).get(a.email).submitted, true);
  assert.equal(byEmail(first.school).get(a.email).prefs.length, 1);
  const second = await readForms(first.school, [await form(ROUND2, [row(ROUND2, b.email, course)])]);
  const ta = byEmail(second.school).get(a.email);
  assert.equal(ta.submitted, true);
  assert.equal(ta.prefs.some((p) => p.round === "Round 2"), false);
  assert.deepEqual(second.senders, [b.id]);
});

test("checks match Start", async () => {
  const [sheet] = await readBook((await fixture(ROUND2)).bytes);
  const wrongHead = { name: ROUND2, bytes: await writeBook([{ name: "Sheet1", rows: [["Mail", ...sheet.rows[0].slice(1)], ...sheet.rows.slice(1)] }]) };
  let out = await readForms(base, [wrongHead]);
  assert.equal(out.school, null);
  assert.match(out.slots[ROUND2], /^round2\.xlsx, row 1: headers must be exactly/);
  const course = base.courses[0].name;
  out = await readForms(base, [await form(ROUND2, [row(ROUND2, "nobody@fernhollow.example", course)])]);
  assert.equal(out.school, null);
  assert.match(out.slots[ROUND2], /^round2\.xlsx, row \d+: email is not on the staff list$/);
  out = await readForms(base, [await form(ROUND2, [row(ROUND2, base.teachers[0].email, "No Such Course")])]);
  assert.equal(out.school, null);
  assert.match(out.slots[ROUND2], /Choice 1 is not on the course list$/);
});

test("other names are refused", async () => {
  const out = await readForms(base, [await fixture("round1.xlsx")]);
  assert.equal(out.school, null);
  assert.equal(out.slots["round1.xlsx"], "round1.xlsx: only round2.xlsx and singapore.xlsx can be added to a draft");
});

test("no files gives no school", async () => {
  const out = await readForms(base, []);
  assert.equal(out.school, null);
  assert.deepEqual(out.slots, {});
});

test("base is not changed", () => {
  assert.deepEqual(base, baseBefore);
});
