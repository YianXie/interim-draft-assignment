import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSchool } from "./school-fixture.mjs";
import { readPastSchool } from "./past-fixture.mjs";
import { readFitSchool, readPastFitSchool } from "./fit-fixture.mjs";
import { loadHighs, solveDraft, toInstance } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

const json = async (name) => JSON.parse(await readFile(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const expected = await json("expected.json");
const expectedPast = await json("expected-past.json");
const expectedFit = await json("expected-fit.json");
const expectedPastFit = await json("expected-past-fit.json");

const seeded = (seed) => {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
};
const byEmail = (sch, pairs) => {
  const email = new Map(sch.teachers.map((t) => [t.id, t.email]));
  return Object.fromEntries(pairs.map(([t, c]) => [email.get(t), c]).sort());
};
// Teachers placed in the plain draft who are on another course, or none, in the fit draft.
const movedFrom = (plainPairs, pairs) => {
  const now = new Map(pairs);
  return plainPairs.filter(([t, c]) => now.get(t) !== c).length;
};
const sorted = (pairs) => pairs.map(([t, c]) => `${t}|${c}`).sort();

let highs, school, solved, plain, plainSolved;
before(async () => {
  highs = await loadHighs({});
  school = await readFitSchool(seeded(3));
  solved = solveDraft(highs, school);
  plain = await readSchool(seeded(3)); // the six alone, the same T numbers
  plainSolved = solveDraft(highs, plain);
});

test("without fit, values equal expected.json", () => {
  assert.equal(plainSolved.status, "Optimal");
  assert.equal(toInstance(plain).fits, null);
  assert.deepEqual(plainSolved.values, expected.values);
});

test("with fit, the first values equal today's and the fit value equals expected-fit.json", () => {
  assert.equal(solved.status, "Optimal");
  assert.equal(solved.values.length, 5);
  assert.deepEqual(solved.values.slice(0, 3), expected.values);
  assert.equal(solved.values[3], expectedFit.values[3]);
});

test("the keep value is placed minus moved from the plain draft", (t) => {
  assert.deepEqual(plain.teachers.map((x) => x.id), school.teachers.map((x) => x.id), "the same T numbers");
  const moved = movedFrom(plainSolved.pairs, solved.pairs);
  t.diagnostic(`moved from the plain draft: ${moved}`);
  assert.equal(solved.values[4], plainSolved.pairs.length - moved);
  assert.equal(solved.pairs.length, expected.placedMin);
});

test("with last year's files too", async (t) => {
  const s = await readPastFitSchool(seeded(5));
  const r = solveDraft(highs, s);
  assert.equal(r.status, "Optimal");
  assert.equal(r.values.length, 6);
  assert.deepEqual(r.values.slice(0, 4), expectedPast.values);
  assert.equal(r.values[4], expectedPastFit.values[4]);
  const p = solveDraft(highs, await readPastSchool(seeded(5)));
  const moved = movedFrom(p.pairs, r.pairs);
  t.diagnostic(`moved from the plain draft: ${moved}`);
  assert.equal(r.values[5], p.pairs.length - moved);
  assert.deepEqual(recheck(s, r.pairs), []);
});

test("recheck finds nothing wrong", () => {
  assert.deepEqual(recheck(school, solved.pairs), []);
});

test("the same files with different T numbers give the same draft", async () => {
  const a = await readFitSchool(seeded(1));
  const b = await readFitSchool(seeded(2));
  assert.notDeepEqual(a.teachers.map((t) => t.id), b.teachers.map((t) => t.id));
  const ra = solveDraft(highs, a), rb = solveDraft(highs, b);
  assert.deepEqual(ra.values, rb.values);
  assert.deepEqual(byEmail(a, ra.pairs), byEmail(b, rb.pairs));
});

test("rows that can change nothing leave the plain draft", () => {
  // A limitation and a general fact on everyone; a fit on a course a form teacher did not rank, which the rules never allow.
  const submitter = plain.teachers.find((t) => t.submitted && !t.returning);
  const unranked = plain.courses.find((c) => c.running && !submitter.prefs.some((p) => p.course === c.id));
  const teachers = plain.teachers.map((t) => ({
    ...t,
    fit: [
      ...plainSolved.pairs.filter(([id]) => id === t.id).map(([, c]) => ({ course: c, kind: "Limitation", fact: "f", quote: "q" })),
      { course: null, kind: "Skill", fact: "f", quote: "q" },
      ...(t.id === submitter.id ? [{ course: unranked.id, kind: "Experience", fact: "f", quote: "q" }] : []),
    ],
  }));
  const s = { ...plain, teachers, fit: true };
  assert.deepEqual(toInstance(s).fits, [`${submitter.id}|${unranked.id}`]);
  const r = solveDraft(highs, s);
  assert.equal(r.status, "Optimal");
  assert.deepEqual(r.values, [...expected.values, 0, plainSolved.pairs.length]);
  assert.deepEqual(sorted(r.pairs), sorted(plainSolved.pairs));
});

test("the same fact twice counts once", () => {
  const [tid, cid] = plainSolved.pairs[0];
  const row = { course: cid, kind: "Experience", fact: "f", quote: "q" };
  const teachers = plain.teachers.map((t) => ({ ...t, fit: t.id === tid ? [row, { ...row }, { ...row, kind: "Skill" }] : [] }));
  const s = { ...plain, teachers, fit: true };
  assert.deepEqual(toInstance(s).fits, [`${tid}|${cid}`]);
  const r = solveDraft(highs, s);
  assert.equal(r.values[3], 1);
});

test("fits are ordered by teacher email, then course code", () => {
  const fits = toInstance(school).fits;
  const email = new Map(school.teachers.map((t) => [t.id, t.email.trim().toLowerCase()]));
  const keys = fits.map((f) => { const [t, c] = f.split("|"); return [email.get(t), c]; });
  const order = [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  assert.deepEqual(keys, order);
  assert.equal(new Set(fits).size, fits.length);
});
