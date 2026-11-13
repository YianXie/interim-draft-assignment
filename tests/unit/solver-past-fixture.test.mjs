import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSchool } from "./school-fixture.mjs";
import { readPastSchool } from "./past-fixture.mjs";
import { loadHighs, solveDraft, displayedRank } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

const expected = JSON.parse(await readFile(new URL("../../fixtures/expected-past.json", import.meta.url), "utf8"));
let highs, school, solved;
before(async () => {
  highs = await loadHighs({});
  school = await readPastSchool();
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
  assert.equal(solved.values.length, 4);
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

test("the draft differs from the draft built without the past files", async () => {
  const plain = await readSchool();
  const without = solveDraft(highs, plain);
  assert.equal(without.status, "Optimal");
  assert.equal(without.values.length, 3);
  assert.notDeepEqual(byEmail(school, solved.pairs), byEmail(plain, without.pairs));
});

test("the new priority puts more owed teachers on a top-4 choice than the six-file draft does", async () => {
  const plain = await readSchool();
  const without = solveDraft(highs, plain);
  assert.equal(without.status, "Optimal");
  const owed = school.teachers.filter((t) => t.lastYear !== null && t.lastYear.result === "none" && !t.returning);
  const top4 = (courseOf) => owed.filter((t) => {
    const rank = displayedRank(t.prefs, courseOf[t.email]);
    return rank !== null && rank <= 4;
  }).length;
  const withPast = top4(byEmail(school, solved.pairs));
  const withoutPast = top4(byEmail(plain, without.pairs));
  assert.equal(withPast, solved.values[1]);
  assert.ok(withPast > withoutPast, `${withPast} owed teachers on a top-4 choice with the past files, ${withoutPast} without`);
});

test("same people, different T numbers, same draft", async () => {
  const a = await readPastSchool(seeded(1));
  const b = await readPastSchool(seeded(2));
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
