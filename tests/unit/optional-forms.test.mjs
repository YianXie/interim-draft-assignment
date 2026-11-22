// round2.xlsx and singapore.xlsx are optional: the office allocates Round 1, then Round 2, then Singapore.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, SLOTS, HEADERS, OPTIONAL } from "../../src/import.js";
import { loadHighs, solveDraft } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

const dir = new URL("../../fixtures/school/", import.meta.url);
const ROUND2 = "round2.xlsx";
const SINGAPORE = "singapore.xlsx";
const fixture = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) });
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};
const withoutRound2 = async () => Promise.all(SLOTS.filter((n) => n !== ROUND2).map(fixture));
const emptyRound2 = async () => ({ name: ROUND2, bytes: await writeBook([{ name: "Fernhollow", rows: [HEADERS[ROUND2]] }]) });

let highs;
before(async () => { highs = await loadHighs({}); });

test("five files without round2.xlsx give a school, and round2.xlsx says optional", async () => {
  const out = await parseFiles(await withoutRound2(), seq());
  assert.ok(out.school);
  assert.equal(out.slots[ROUND2], OPTIONAL);
  for (const name of SLOTS.filter((n) => n !== ROUND2)) assert.equal(out.slots[name], "ready");
  assert.equal(out.school.teachers.length, 96);
  for (const t of out.school.teachers) for (const p of t.prefs) assert.notEqual(p.round, "Round 2");
  assert.ok(out.school.teachers.some((t) => t.prefs.some((p) => p.round === "Round 1")));
});

test("leaving round2.xlsx out is the same as a round2.xlsx with no forms", async () => {
  const five = await parseFiles(await withoutRound2(), seq());
  const six = await parseFiles([...(await withoutRound2()), await emptyRound2()], seq());
  assert.ok(six.school);
  assert.deepEqual(five.school, six.school);
  const a = solveDraft(highs, five.school), b = solveDraft(highs, six.school);
  assert.equal(a.status, "Optimal");
  assert.deepEqual(a.pairs, b.pairs);
  assert.deepEqual(recheck(five.school, a.pairs), []);
});

test("someone who sent only a Round 2 form counts as no form when round2.xlsx is left out", async () => {
  const all = await parseFiles(await Promise.all(SLOTS.map(fixture)), seq());
  const five = await parseFiles(await withoutRound2(), seq());
  const only2 = all.school.teachers.filter((t) => t.prefs.length && t.prefs.every((p) => p.round === "Round 2"));
  for (const t of only2) assert.equal(five.school.teachers.find((x) => x.email === t.email).submitted, false);
});

test("a round2.xlsx that is added but wrong still holds up Build", async () => {
  const [sheet] = await readBook((await fixture(ROUND2)).bytes);
  const bad = { name: ROUND2, bytes: await writeBook([{ name: "Sheet1", rows: [["Mail", ...sheet.rows[0].slice(1)], ...sheet.rows.slice(1)] }]) };
  const out = await parseFiles([...(await withoutRound2()), bad], seq());
  assert.equal(out.school, null);
  assert.match(out.slots[ROUND2], /^round2\.xlsx, row 1: column A should be "Timestamp"; headers must be exactly: Timestamp, Email, Choice 1, Choice 2, Choice 3$/);
});

test("the other four are still needed", async () => {
  for (const missing of SLOTS.filter((n) => n !== ROUND2 && n !== SINGAPORE)) {
    const out = await parseFiles(await Promise.all(SLOTS.filter((n) => n !== missing).map(fixture)), seq());
    assert.equal(out.school, null, missing);
    assert.equal(out.slots[missing], `${missing}: file not added`);
  }
});

const without = (...out) => Promise.all(SLOTS.filter((n) => !out.includes(n)).map(fixture));
const emptyForm = async (name) => ({ name, bytes: await writeBook([{ name: "Fernhollow", rows: [HEADERS[name]] }]) });

test("without singapore.xlsx: a school with no Singapore choices, same as a Singapore file with no forms", async () => {
  const five = await parseFiles(await without(SINGAPORE), seq());
  const six = await parseFiles([...(await without(SINGAPORE)), await emptyForm(SINGAPORE)], seq());
  assert.ok(five.school);
  assert.equal(five.slots[SINGAPORE], OPTIONAL);
  for (const t of five.school.teachers) for (const p of t.prefs) assert.notEqual(p.round, "Singapore");
  assert.deepEqual(five.school, six.school);
  const a = solveDraft(highs, five.school), b = solveDraft(highs, six.school);
  assert.equal(a.status, "Optimal");
  assert.deepEqual(a.pairs, b.pairs);
  assert.deepEqual(recheck(five.school, a.pairs), []);
});

test("Round 1 alone: both later forms left out still builds a checked draft", async () => {
  const four = await parseFiles(await without(ROUND2, SINGAPORE), seq());
  assert.ok(four.school);
  assert.equal(four.slots[ROUND2], OPTIONAL);
  assert.equal(four.slots[SINGAPORE], OPTIONAL);
  for (const t of four.school.teachers) for (const p of t.prefs) assert.equal(p.round, "Round 1");
  const a = solveDraft(highs, four.school);
  assert.equal(a.status, "Optimal");
  assert.deepEqual(recheck(four.school, a.pairs), []);
});
