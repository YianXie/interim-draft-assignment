// Which listing counts when one course is on more than one form is decided in three places:
// displayedRank (the new priority), lastYearResults (last year's result) and Mock.choice (the card and the download).
// They share no code, so this holds them to one answer for every way a teacher can list one course.
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayedRank } from "../../src/solver.js";
import { lastYearResults } from "../../src/past.js";
import { Mock } from "../../src/state.js";

const FORMS = [["Round 1", 7], ["Round 2", 3], ["Singapore", 5]];
const EMAIL = "t100@fernhollow.example";
const course = (id) => ({ id, name: `Course ${id}`, kind: "Local", seats: 1, running: true, needs: null });

// The rank each of the three reports for course X, given the listings [{ course, rank, round }].
function three(prefs) {
  const solver = displayedRank(prefs, "X");
  const { byEmail } = lastYearResults({
    allocation: [{ course: "X", sponsors: ["Made Up"] }],
    forms: prefs.map((p) => ({ email: EMAIL, ...p })),
    staff: [{ email: EMAIL, name: "Made Up" }],
  });
  Mock.init({
    school: "Made up", year: "Made up", courses: [course("X"), course("Y")],
    teachers: [{ id: "T100", name: "Made Up", email: EMAIL, returning: false, returningCourse: null, submitted: true, certificates: [], prefs }],
  });
  const shown = Mock.choice("T100", "X");
  return { solver, past: byEmail.get(EMAIL).rank, card: shown ? shown.rank : null, round: [byEmail.get(EMAIL).round, shown ? shown.round : null] };
}

// Every way to list X on the three forms: on each form at one rank or not at all, and on at least one form.
function* everySet() {
  const [r1, r2, sg] = FORMS.map(([round, n]) => [null, ...Array.from({ length: n }, (_, i) => ({ course: "X", rank: i + 1, round }))]);
  for (const a of r1) for (const b of r2) for (const c of sg) {
    const set = [a, b, c].filter(Boolean);
    if (set.length) yield set;
  }
}

test("for every set of listings of one course, the priority, last year's result and the card give the same rank", () => {
  let sets = 0;
  for (const set of everySet()) {
    sets += 1;
    // What the design says: the listing on the earliest of Round 1, Round 2, Singapore.
    const want = set[0];
    // In every order the listings can arrive in, and with another course listed around them.
    const other = [{ course: "Y", rank: 1, round: "Round 1" }, { course: "Y", rank: 1, round: "Singapore" }];
    for (const prefs of [set, [...set].reverse(), [other[0], ...set, other[1]], [other[1], ...[...set].reverse(), other[0]]]) {
      const got = three(prefs);
      const label = JSON.stringify(prefs);
      assert.equal(got.solver, want.rank, label);
      assert.equal(got.past, want.rank, label);
      assert.equal(got.card, want.rank, label);
      assert.deepEqual(got.round, [want.round, want.round], label);
    }
  }
  assert.equal(sets, 8 * 4 * 6 - 1);
});

test("a course listed twice on one form, 2nd and 6th, counts as 2nd in all three", () => {
  const ranks = (prefs) => { const got = three(prefs); return [got.solver, got.past, got.card]; };
  const twice = [{ course: "X", rank: 2, round: "Round 1" }, { course: "X", rank: 6, round: "Round 1" }];
  assert.deepEqual(ranks(twice), [2, 2, 2]);
  assert.deepEqual(ranks([...twice].reverse()), [2, 2, 2]);
  // The same on the two shorter forms, at the ranks they have, and behind a Round 1 listing, which still comes first.
  for (const [round, low] of [["Round 2", 3], ["Singapore", 5]]) {
    const shorter = [{ course: "X", rank: low, round }, { course: "X", rank: 2, round }];
    assert.deepEqual(ranks(shorter), [2, 2, 2], round);
    assert.deepEqual(ranks([...shorter, { course: "X", rank: 7, round: "Round 1" }]), [7, 7, 7], round);
  }
});

test("no listing of the course: the priority and the card say so, and last year's result is None", () => {
  const prefs = [{ course: "Y", rank: 1, round: "Round 1" }];
  const got = three(prefs);
  assert.deepEqual([got.solver, got.past, got.card], [null, null, null]);
});
