import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSchool } from "./school-fixture.mjs";
import { loadHighs, solveDraft, toDraft, toInstance } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

const expected = JSON.parse(await readFile(new URL("../../fixtures/expected.json", import.meta.url), "utf8"));
let highs, school, solved;
before(async () => {
  highs = await loadHighs({});
  school = await readSchool();
  solved = solveDraft(highs, school);
});

const seeded = (seed) => {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
};
const byEmail = (sch, pairs) => {
  const email = new Map(sch.teachers.map((t) => [t.id, t.email]));
  return Object.fromEntries(pairs.map(([t, c]) => [email.get(t), c]).sort());
};

test("values equal the separate solver", () => {
  assert.equal(solved.status, "Optimal");
  assert.deepEqual(solved.values, expected.values);
});

test("placed and running equal the separate solver", () => {
  assert.equal(solved.pairs.length, expected.placedMin);
  assert.equal(solved.pairs.length, expected.placedMax);
  const running = new Set(solved.pairs.map(([, c]) => c)).size;
  assert.equal(running, expected.runningMin);
  assert.equal(running, expected.runningMax);
});

test("the draft passes the re-check", () => {
  assert.deepEqual(recheck(school, solved.pairs), []);
});

test("toDraft maps every teacher to a course or null", () => {
  const draft = toDraft(school, solved.pairs);
  assert.equal(Object.keys(draft).length, school.teachers.length);
  assert.equal(Object.values(draft).filter((c) => c !== null).length, expected.placedMin);
});

test("same people, different T numbers, same draft", async () => {
  const a = await readSchool(seeded(1));
  const b = await readSchool(seeded(2));
  assert.notDeepEqual(a.teachers.map((t) => t.id), b.teachers.map((t) => t.id));
  const ra = solveDraft(highs, a), rb = solveDraft(highs, b);
  assert.deepEqual(ra.values, rb.values);
  assert.deepEqual(byEmail(a, ra.pairs), byEmail(b, rb.pairs));
});

test("rows shuffled, same draft", () => {
  const rnd = seeded(7);
  const shuffle = (xs) => { const o = [...xs]; for (let i = o.length - 1; i > 0; i--) { const j = rnd(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; };
  const shuffled = { ...school, teachers: shuffle(school.teachers).map((t) => ({ ...t, prefs: shuffle(t.prefs) })), courses: shuffle(school.courses) };
  const r = solveDraft(highs, shuffled);
  assert.deepEqual(r.values, solved.values);
  assert.deepEqual(byEmail(shuffled, r.pairs), byEmail(school, solved.pairs));
});

test("input is ordered by email and course code", () => {
  const inst = toInstance({ ...school, teachers: [...school.teachers].reverse(), courses: [...school.courses].reverse() });
  const email = new Map(school.teachers.map((t) => [t.id, t.email.trim().toLowerCase()]));
  const emails = inst.teachers.map((t) => email.get(t.id));
  assert.deepEqual(emails, [...emails].sort());
  const ids = inst.courses.map((c) => c.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(inst.weights, [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(inst.bonus, { "Round 1": 20, "Round 2": 10, Singapore: 0 });
});
