import { test, before } from "node:test";
import assert from "node:assert/strict";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";
import { Mock } from "../../src/state.js";

let highs;
before(async () => {
  highs = await loadHighs({});
});

// Made-up schools, used only here. No files.
const course = (id, seats = 1) => ({ id, name: `Course ${id}`, kind: "International", seats, running: true, needs: null });
const listed = (c, rank, round = "Round 1") => ({ course: c, rank, round });
const teacher = (id, { prefs = [], submitted = prefs.length > 0, returningCourse = null } = {}) => ({
  id, name: id, email: `${id.toLowerCase()}@fernhollow.example`, returning: returningCourse !== null, returningCourse,
  submitted, certificates: [], prefs,
});
const mk = (courses, teachers) => ({ school: "Made up", year: "Made up", courses, teachers });
const placed = (r) => Object.fromEntries(r.pairs);

// A lists X 7th in Round 1 and 1st in Round 2, and Y 2nd in Round 1. B lists Y 1st and X 2nd, both Round 1.
// Each listing scores on its own: A's X is worth 21 (its Round 1 listing), not 7 + 20 = 27 from two listings.
// A on Y and B on X scores 26 + 26 = 52. A on X and B on Y scores 21 + 27 = 48.
test("a course listed in two rounds counts at its better listing, never a mix of the two", () => {
  const school = mk([course("X"), course("Y")], [
    teacher("A", { prefs: [listed("X", 7), listed("Y", 2), listed("X", 1, "Round 2")] }),
    teacher("B", { prefs: [listed("Y", 1), listed("X", 2)] }),
  ]);
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.equal(r.values[1], 52);
  assert.deepEqual(placed(r), { A: "Y", B: "X" });
});

// R has a returning sponsor and two seats. C sent a form with no choice filled in, D sent no form at all.
const blankForm = () => mk([course("R", 2)], [
  teacher("A", { returningCourse: "R" }),
  teacher("C", { submitted: true }),
  teacher("D"),
]);

test("someone who sent a blank form is placed on no course, as they listed none", () => {
  const school = blankForm();
  const r = solveDraft(highs, school);
  assert.equal(r.status, "Optimal");
  assert.deepEqual(placed(r), { A: "R", D: "R" });
  assert.deepEqual(recheck(school, r.pairs), []);
});

test("the re-check refuses a blank-form sender on any course but their returning one", () => {
  const school = blankForm();
  const bad = recheck(school, [["A", "R"], ["C", "R"]]);
  assert.ok(bad.some((p) => p.code === "NOT_RANKED" && p.id === "C"), JSON.stringify(bad));
  const returning = mk([course("R", 1)], [teacher("A", { returningCourse: "R", submitted: true })]);
  assert.deepEqual(recheck(returning, [["A", "R"]]), []);
});

test("a blank-form sender left unplaced by the draft is on the To do, not in the no-form group", () => {
  const school = blankForm();
  Mock.init(school);
  Mock.build(toDraft(school, solveDraft(highs, school).pairs));
  assert.equal(Mock.placedOn("C"), null);
  assert.equal(Mock.reason("C"), "Not placed.");
  assert.ok(Mock.todo().some((i) => i.kind === "teacher" && i.tid === "C"));
  assert.ok(!Mock.todo().some((i) => i.kind === "noForm" && i.tids.includes("C")));
});
