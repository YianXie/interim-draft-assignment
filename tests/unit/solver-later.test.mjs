// The solver builds on a kept draft: everyone placed stays put, only free teachers and open seats are solved.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFiles, readForms, LATER, SLOTS } from "../../src/import.js";
import { loadHighs, solveDraft, toInstance } from "../../src/solver.js";
import { newProblems } from "../../src/recheck.js";
import { readSchool } from "./school-fixture.mjs";

const dir = new URL("../../fixtures/school/", import.meta.url);
const fixture = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) });
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};
const seeded = (seed) => {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
};
const byEmail = (sch, pairs) => {
  const email = new Map(sch.teachers.map((t) => [t.id, t.email]));
  return Object.fromEntries(pairs.map(([t, c]) => [email.get(t), c]).sort());
};
const qualifies = (t, c) => (!c.needs || t.certificates.includes(c.needs)) && (!t.prefs.length || t.prefs.some((p) => p.course === c.id));

const build = async (random) => {
  const base = (await parseFiles(await Promise.all(SLOTS.filter((n) => !LATER.includes(n)).map(fixture)), random)).school;
  const solved = solveDraft(highs, base);
  assert.equal(solved.status, "Optimal");
  const later = (await readForms(base, await Promise.all(LATER.map(fixture)))).school;
  assert.ok(later);
  return { base, keep: solved.pairs, later };
};

let highs, keep, later;
before(async () => {
  highs = await loadHighs({});
  ({ keep, later } = await build(seq()));
});

test("without keep nothing changes", async () => {
  const school = await readSchool(seq());
  assert.deepEqual(solveDraft(highs, school), solveDraft(highs, school, null));
});

test("toInstance lists kept pairs by teacher email, then course code", () => {
  const inst = toInstance(later, [...keep].reverse());
  const email = new Map(later.teachers.map((t) => [t.id, t.email.trim().toLowerCase()]));
  const keys = inst.kept.map((k) => email.get(k.t) + "|" + k.c);
  assert.equal(inst.kept.length, keep.length);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(toInstance(later).kept, undefined);
});

test("kept sponsors stay and new pairs follow every rule", () => {
  const r = solveDraft(highs, later, keep);
  assert.equal(r.status, "Optimal");
  assert.ok(r.pairs.length > 0);
  const kept = new Set(keep.map(([t]) => t));
  for (const [t] of r.pairs) assert.ok(!kept.has(t), t);
  assert.deepEqual(newProblems(later, keep, [...keep, ...r.pairs]), []);
});

test("courses with a kept sponsor are filled first", () => {
  const r = solveDraft(highs, later, keep);
  const all = [...keep, ...r.pairs];
  const count = (pairs, c) => pairs.filter(([, x]) => x === c).length;
  const running = later.courses.filter((c) => c.running && count(keep, c.id) > 0);
  const short = running.reduce((n, c) => n + Math.max(0, c.seats - count(all, c.id)), 0);
  assert.equal(r.values[0], short);
  const placed = new Set(all.map(([t]) => t));
  const free = later.teachers.filter((t) => !placed.has(t.id));
  for (const c of running) {
    if (count(all, c.id) >= c.seats) continue;
    for (const t of free) assert.ok(!qualifies(t, c), `${t.id} could fill ${c.id}`);
  }
});

test("kept pairs that break rules are left alone", () => {
  const placed = new Set(keep.map(([t]) => t));
  const free = later.teachers.filter((t) => !placed.has(t.id));
  const counts = new Map();
  for (const [, c] of keep) counts.set(c, (counts.get(c) ?? 0) + 1);
  const full = later.courses.find((c) => c.running && c.id !== "INT-01" && counts.get(c.id) === c.seats);
  const extra = free[0];
  const noScuba = free.find((t) => t !== extra && !t.certificates.includes("Scuba certificate"));
  const sponsor = later.teachers.find((t) => t.returning && t.returningCourse && keep.some(([x]) => x === t.id));
  const elsewhere = later.courses.find((c) => c.running && !c.needs && c.id !== sponsor.returningCourse && c.id !== full.id && !sponsor.prefs.some((p) => p.course === c.id));
  const changed = [
    ...keep.filter(([t]) => t !== sponsor.id),
    [extra.id, full.id], [noScuba.id, "INT-01"], [sponsor.id, elsewhere.id],
  ];
  const r = solveDraft(highs, later, changed);
  assert.equal(r.status, "Optimal");
  assert.ok(!r.pairs.some(([, c]) => c === full.id));
  for (const t of [extra, noScuba, sponsor]) assert.ok(!r.pairs.some(([x]) => x === t.id), t.id);
  assert.deepEqual(newProblems(later, changed, [...changed, ...r.pairs]), []);
});

test("an unplaced returning sponsor is treated like anyone", () => {
  const sponsor = later.teachers.find((t) => t.returning && t.returningCourse && keep.some(([x, c]) => x === t.id && c === t.returningCourse));
  const course = later.courses.find((c) => c.id === sponsor.returningCourse);
  const placed = new Set(keep.map(([t]) => t));
  const rest = keep.filter(([t]) => t !== sponsor.id);
  const filler = later.teachers.filter((t) => !placed.has(t.id)).slice(0, course.seats - rest.filter(([, c]) => c === course.id).length);
  const changed = [...rest, ...filler.map((t) => [t.id, course.id])];
  assert.equal(changed.filter(([, c]) => c === course.id).length, course.seats);
  const r = solveDraft(highs, later, changed);
  assert.equal(r.status, "Optimal");
  assert.ok(!r.pairs.some(([t, c]) => t === sponsor.id && c === course.id));
});

test("same files, shuffled, different T numbers, same new placements by email", async () => {
  const a = await build(seeded(1));
  const b = await build(seeded(2));
  assert.notDeepEqual(a.later.teachers.map((t) => t.id), b.later.teachers.map((t) => t.id));
  const rnd = seeded(7);
  const shuffle = (xs) => { const o = [...xs]; for (let i = o.length - 1; i > 0; i--) { const j = rnd(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; };
  const shuffled = { ...b.later, teachers: shuffle(b.later.teachers).map((t) => ({ ...t, prefs: shuffle(t.prefs) })), courses: shuffle(b.later.courses) };
  const ra = solveDraft(highs, a.later, a.keep), rb = solveDraft(highs, shuffled, shuffle(b.keep));
  assert.equal(ra.status, "Optimal");
  assert.deepEqual(ra.values, rb.values);
  assert.deepEqual(byEmail(a.later, ra.pairs), byEmail(b.later, rb.pairs));
});
