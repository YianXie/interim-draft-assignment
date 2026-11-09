import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readSchool } from "./school-fixture.mjs";
import { loadHighs, solveDraft } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

const ALL_CODES = ["ONE_COURSE", "RETURNING_MOVED", "NOT_RANKED", "CERTIFICATE", "OVER_SEATS", "UNDER_SEATS", "NOT_OFFERED"];
let school, pairs, courseOf, teacher, course;
before(async () => {
  school = await readSchool();
  pairs = solveDraft(await loadHighs({}), school).pairs;
  courseOf = new Map(pairs);
  teacher = new Map(school.teachers.map((t) => [t.id, t]));
  course = new Map(school.courses.map((c) => [c.id, c]));
});
const without = (t) => pairs.filter(([x]) => x !== t);
const has = (list, code) => list.some((f) => f.code === code);
const returningCourses = () => new Set(school.teachers.filter((t) => t.returning && t.returningCourse).map((t) => t.returningCourse));

const broken = {
  ONE_COURSE: () => {
    const [t, c] = pairs[0];
    const other = pairs.find(([, x]) => x !== c)[1];
    return [...pairs, [t, other]];
  },
  RETURNING_MOVED: () => {
    const t = school.teachers.find((x) => x.returning && x.returningCourse && courseOf.has(x.id));
    const other = school.courses.find((c) => c.running && c.id !== t.returningCourse).id;
    return [...without(t.id), [t.id, other]];
  },
  NOT_RANKED: () => {
    const t = school.teachers.find((x) => x.submitted && x.prefs.length && courseOf.has(x.id));
    const ranked = new Set(t.prefs.map((p) => p.course));
    const other = school.courses.find((c) => c.running && !ranked.has(c.id)).id;
    return [...without(t.id), [t.id, other]];
  },
  CERTIFICATE: () => {
    const c = school.courses.find((x) => x.running && x.needs);
    const t = school.teachers.find((x) => !x.certificates.includes(c.needs) && courseOf.has(x.id));
    return [...without(t.id), [t.id, c.id]];
  },
  OVER_SEATS: () => {
    const c = school.courses.find((x) => x.running && pairs.filter(([, id]) => id === x.id).length === x.seats);
    const extra = school.teachers.find((x) => !courseOf.has(x.id));
    return [...pairs, [extra.id, c.id]];
  },
  UNDER_SEATS: () => {
    const rc = returningCourses();
    const [t] = pairs.find(([, c]) => !rc.has(c));
    return without(t);
  },
  NOT_OFFERED: () => {
    const c = school.courses.find((x) => !x.running);
    const [t] = pairs[0];
    return [...without(t), [t, c.id]];
  },
};
for (const code of ALL_CODES) {
  test(`broken draft is rejected: ${code}`, () => {
    assert.ok(has(recheck(school, broken[code]()), code), code);
  });
}

test("a returning course may run short, others may not", () => {
  const rc = returningCourses();
  // INT-01 has a returning sponsor and runs at 1 of 2 in the draft; that passes.
  assert.equal(pairs.filter(([, c]) => c === "INT-01").length, 1);
  assert.deepEqual(recheck(school, pairs), []);
  // A full returning course that loses an ordinary teacher (not a sponsor) still passes.
  const full = [...rc].find((c) => pairs.filter(([, x]) => x === c).length === 2);
  const [drop] = pairs.find(([, c]) => c === full);
  const ordinary = { ...school, teachers: school.teachers.map((t) => (t.id === drop ? { ...t, returning: false, returningCourse: null } : t)) };
  assert.deepEqual(recheck(ordinary, without(drop)), []);
  // Any other course at 1 of 2 is a finding.
  const plain = school.courses.find((c) => c.running && c.seats === 2 && !rc.has(c.id) && pairs.some(([, x]) => x === c.id));
  const [t] = pairs.find(([, c]) => c === plain.id);
  assert.deepEqual(recheck(school, without(t)), [{ code: "UNDER_SEATS", id: plain.id }]);
});

test("a returning sponsor left unplaced is flagged", () => {
  const t = school.teachers.find((x) => x.returning && x.returningCourse && courseOf.get(x.id) === x.returningCourse);
  assert.ok(has(recheck(school, without(t.id)), "RETURNING_MOVED"));
  assert.deepEqual(recheck(school, without(t.id)).filter((f) => f.code === "RETURNING_MOVED"), [{ code: "RETURNING_MOVED", id: t.id }]);
});
