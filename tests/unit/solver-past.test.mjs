import { test, before } from "node:test";
import assert from "node:assert/strict";
import { loadHighs, solveDraft, toInstance, displayedRank } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";

let highs;
before(async () => {
  highs = await loadHighs({});
});

// Made-up schools, used only here. No files.
const none = { result: "none", rank: null, round: null };
const top4 = { result: "top4", rank: 1, round: "Round 1" };
const course = (id, seats, running = true) => ({ id, name: `Course ${id}`, kind: "Local", seats, running, needs: null });
const listed = (courseId, rank, round = "Round 1") => ({ course: courseId, rank, round });
// lastYear left out means the key is absent, as it is with six files.
const teacher = (id, { prefs = [], lastYear, returningCourse = null, email = id.toLowerCase() } = {}) => ({
  id, name: id, email: `${email}@fernhollow.example`, returning: returningCourse !== null, returningCourse,
  submitted: prefs.length > 0, certificates: [], prefs, ...(lastYear === undefined ? {} : { lastYear }),
});
const mk = ({ teachers, courses, past }) => ({ school: "Made up", year: "Made up", courses, teachers, ...(past ? { past } : {}) });
const PAST = { unmatched: [] };
const placed = (r) => Object.fromEntries(r.pairs);

// Courses X and Y, one seat each. A ranks X 1st and Y 7th, B ranks X 2nd and Y 5th, both in Round 1.
// A on X and B on Y scores 27 + 23 = 50. B on X and A on Y scores 26 + 21 = 47.
const twoForOne = ({ past, b = none, bPrefs = [listed("X", 2), listed("Y", 5)] } = {}) => mk({
  courses: [course("X", 1), course("Y", 1)],
  teachers: [
    teacher("A", { prefs: [listed("X", 1), listed("Y", 7)], lastYear: null }),
    teacher("B", { prefs: bPrefs, lastYear: b }),
  ],
  past,
});

// A returning-sponsor course R, a course that is not offered, a no-form teacher, and four owed teachers after one seat on X.
const mixed = () => mk({
  courses: [course("N", 1, false), course("R", 2), course("X", 1), course("Y", 1), course("Z", 2)],
  teachers: [
    teacher("A", { prefs: [listed("X", 1), listed("Y", 2), listed("Z", 3)], lastYear: none }),
    teacher("B", { prefs: [listed("X", 1), listed("Z", 5)], lastYear: none }),
    teacher("C", { prefs: [listed("X", 1), listed("Z", 6)], lastYear: none }),
    teacher("D", { prefs: [listed("Y", 1), listed("Z", 2)], lastYear: top4 }),
    teacher("E", { lastYear: { result: "noForm", rank: null, round: null } }),
    teacher("F", { prefs: [listed("R", 6), listed("R", 1, "Round 2"), listed("X", 3, "Singapore")], lastYear: none }),
    teacher("S", { prefs: [listed("R", 1)], lastYear: none, returningCourse: "R" }),
  ],
  past: PAST,
});

// The count the second value stands for, worked out here without the solver's own helper.
const recount = (school, pairs) => {
  const byId = new Map(school.teachers.map((t) => [t.id, t]));
  const shown = (t, c) => {
    for (const round of ["Round 1", "Round 2", "Singapore"]) {
      const ranks = t.prefs.filter((p) => p.course === c && p.round === round).map((p) => p.rank);
      if (ranks.length) return Math.min(...ranks);
    }
    return null;
  };
  return pairs.filter(([tid, c]) => {
    const t = byId.get(tid);
    if (!t.lastYear || t.lastYear.result !== "none" || (t.returning && t.returningCourse)) return false;
    const rank = shown(t, c);
    return rank !== null && rank <= 4;
  }).length;
};

test("without school.past there are three values and owed is null", () => {
  const school = twoForOne();
  assert.equal("past" in school, false);
  assert.equal(toInstance(school).owed, null);
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.equal(r.values.length, 3);
});

test("with school.past there are four values, the second counting owed teachers on a top-4 choice", () => {
  const school = twoForOne({ past: PAST });
  assert.deepEqual(toInstance(school).owed, ["B"]);
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.equal(r.values.length, 4);
  assert.equal(r.values[1], 1);
});

test("the owed teacher wins the seat even when it lowers the preference score", () => {
  const without = solveDraft(highs, twoForOne());
  assert.deepEqual(without.values, [0, 50, 0]);
  assert.deepEqual(placed(without), { A: "X", B: "Y" });
  const withPast = solveDraft(highs, twoForOne({ past: PAST }));
  assert.deepEqual(withPast.values, [0, 1, 47, 0]);
  assert.deepEqual(placed(withPast), { A: "Y", B: "X" });
});

test("fewest short seats still comes first", () => {
  // R has a returning sponsor and two seats. Only O can take the second, and O's top-4 choice is X.
  const school = (seats, past) => mk({
    courses: [course("R", seats), course("X", 1)],
    teachers: [
      teacher("O", { prefs: [listed("X", 1), listed("R", 5)], lastYear: none }),
      teacher("S", { lastYear: null, returningCourse: "R" }),
    ],
    past,
  });
  const without = solveDraft(highs, school(2));
  assert.deepEqual(without.values, [0, 23, 0]);
  const withPast = solveDraft(highs, school(2, PAST));
  assert.equal(withPast.values[0], without.values[0]);
  assert.deepEqual(withPast.values, [0, 0, 23, 0]);
  assert.deepEqual(placed(withPast), { O: "R", S: "R" });
  // With one seat on R nothing goes short either way, and O gets X.
  const free = solveDraft(highs, school(1, PAST));
  assert.deepEqual(free.values, [0, 1, 27, 0]);
  assert.deepEqual(placed(free), { O: "X", S: "R" });
});

test("5to7, notFound, noForm and null are not owed", () => {
  const notOwed = [
    { result: "5to7", rank: 6, round: "Round 1" },
    { result: "notFound", rank: null, round: null },
    { result: "noForm", rank: null, round: null },
    top4,
    null,
  ];
  for (const b of notOwed) {
    const school = twoForOne({ past: PAST, b });
    assert.deepEqual(toInstance(school).owed, [], JSON.stringify(b));
    const r = solveDraft(highs, school);
    assert.deepEqual(r.values, [0, 0, 50, 0], JSON.stringify(b));
    assert.deepEqual(placed(r), { A: "X", B: "Y" }, JSON.stringify(b));
  }
  // Those who are owed come in the instance's order, which is by email and not by T number or row.
  const order = mk({
    courses: [course("X", 1)],
    teachers: [
      teacher("T1", { email: "c", lastYear: none }),
      teacher("T3", { email: "b", lastYear: top4 }),
      teacher("T2", { email: "a", lastYear: none }),
    ],
    past: PAST,
  });
  assert.deepEqual(toInstance(order).owed, ["T2", "T1"]);
});

test("an owed returning sponsor is not counted", () => {
  const school = mk({
    courses: [course("R", 1)],
    teachers: [teacher("S", { prefs: [listed("R", 1)], lastYear: none, returningCourse: "R" })],
    past: PAST,
  });
  assert.deepEqual(toInstance(school).owed, ["S"]);
  const r = solveDraft(highs, school);
  assert.deepEqual(r.values, [0, 0, 27, 0]);
  assert.deepEqual(placed(r), { S: "R" });
});

test("displayedRank takes Round 1 before Round 2 before Singapore", () => {
  const prefs = [listed("X", 2, "Round 2"), listed("X", 6), listed("Y", 3, "Singapore"), listed("Y", 4, "Round 2"), listed("Z", 5, "Singapore")];
  assert.equal(displayedRank(prefs, "X"), 6);
  assert.equal(displayedRank([...prefs].reverse(), "X"), 6);
  assert.equal(displayedRank(prefs, "Y"), 4);
  assert.equal(displayedRank([...prefs].reverse(), "Y"), 4);
  assert.equal(displayedRank(prefs, "Z"), 5);
  assert.equal(displayedRank(prefs, "W"), null);
  assert.equal(displayedRank([], "X"), null);
});

test("an owed teacher whose only top-4 listing is in Round 2 behind a 6th in Round 1 is not helped onto that course by the stage", () => {
  // B's score on X is still 26 (the score is unchanged), so the drafts differ only if the stage counts B on X.
  const school = twoForOne({ past: PAST, bPrefs: [listed("X", 6), listed("X", 2, "Round 2"), listed("Y", 5)] });
  assert.deepEqual(toInstance(school).owed, ["B"]);
  const r = solveDraft(highs, school);
  assert.deepEqual(r.values, [0, 0, 50, 0]);
  assert.deepEqual(placed(r), { A: "X", B: "Y" });
});

test("values[1] equals a recount from pairs", () => {
  const school = mixed();
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.equal(r.values.length, 4);
  // One of A, B, C, F on X's one seat and A on Y or Z: two at most. S is fixed to R and F's R is a 6th choice.
  assert.equal(r.values[1], 2);
  assert.equal(r.values[1], recount(school, r.pairs));
  const swap = twoForOne({ past: PAST });
  const s = solveDraft(highs, swap);
  assert.equal(s.values[1], recount(swap, s.pairs));
});

test("the draft passes recheck", () => {
  const school = mixed();
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.deepEqual(recheck(school, r.pairs), []);
  const swap = twoForOne({ past: PAST });
  assert.deepEqual(recheck(swap, solveDraft(highs, swap).pairs), []);
});
