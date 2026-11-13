import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readSchool } from "./school-fixture.mjs";
import { readPastSchool } from "./past-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";

let plain, plainDraft, school, draft;
before(async () => {
  const highs = await loadHighs({});
  plain = await readSchool();
  plainDraft = toDraft(plain, solveDraft(highs, plain).pairs);
  school = await readPastSchool();
  draft = toDraft(school, solveDraft(highs, school).pairs);
});

const lcg = (seed) => {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
};
const fresh = () => { Mock.init(school); Mock.build(draft); };
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || "th"}`;
const withResult = (result) => school.teachers.filter((t) => (t.lastYear ? t.lastYear.result : null) === result);

// This year's result worked out from a plain copy of the placements and the School alone.
const ROUNDS = ["Round 1", "Round 2", "Singapore"];
function expectedThisYear(t, cid) {
  if (!cid) return "notPlaced";
  if (t.returning && t.returningCourse === cid) return "returning";
  if (!t.submitted) return "noForm";
  const shown = t.prefs.filter((p) => p.course === cid).sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round))[0];
  if (!shown) return "notRanked";
  return shown.rank <= 4 ? "top4" : "5to7";
}
const checkThisYear = (placed) => {
  for (const t of school.teachers) assert.equal(Mock.thisYear(t.id), expectedThisYear(t, placed[t.id]), t.id);
};

test("without past files every lastYearLine is empty and past() is null", () => {
  Mock.init(plain);
  Mock.build(plainDraft);
  assert.equal(Mock.past(), null);
  for (const t of plain.teachers) {
    assert.equal(Mock.lastYear(t.id), null);
    assert.equal(Mock.lastYearLine(t.id), "");
  }
  // A School that lost its past key says nothing either, whatever is still on the teacher.
  const { past, ...noPast } = school;
  assert.ok(past);
  Mock.init(noPast);
  Mock.build(draft);
  assert.equal(Mock.past(), null);
  for (const t of school.teachers) assert.equal(Mock.lastYearLine(t.id), "");
});

test("each result gives its exact line", () => {
  fresh();
  assert.deepEqual(Mock.past(), { unmatched: ["Sponsor who left"] });
  const fixed = { none: "Last year: none of their choices", notFound: "Last year: not on the allocation", noForm: "Last year: no form" };
  for (const [result, line] of Object.entries(fixed)) {
    const some = withResult(result);
    assert.ok(some.length, `nobody with ${result}`);
    for (const t of some) {
      assert.deepEqual(Mock.lastYear(t.id), { result, rank: null, round: null });
      assert.equal(Mock.lastYearLine(t.id), line);
    }
  }
  const ranks = new Set();
  for (const result of ["top4", "5to7"]) {
    const some = withResult(result);
    assert.ok(some.length, `nobody with ${result}`);
    for (const t of some) {
      assert.equal(Mock.lastYear(t.id), t.lastYear);
      assert.equal(Mock.lastYearLine(t.id), `Last year: ${ordinal(t.lastYear.rank)} choice`);
      ranks.add(t.lastYear.rank);
    }
  }
  const byRank = (rank) => school.teachers.find((t) => t.lastYear && t.lastYear.rank === rank);
  assert.deepEqual([...ranks].sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Mock.lastYearLine(byRank(1).id), "Last year: 1st choice");
  assert.equal(Mock.lastYearLine(byRank(2).id), "Last year: 2nd choice");
  assert.equal(Mock.lastYearLine(byRank(3).id), "Last year: 3rd choice");
  assert.equal(Mock.lastYearLine(byRank(5).id), "Last year: 5th choice");
  const noRecord = withResult(null);
  assert.ok(noRecord.length, "nobody without a record");
  for (const t of noRecord) {
    assert.equal(Mock.lastYear(t.id), null);
    assert.equal(Mock.lastYearLine(t.id), "");
  }
});

test("no lastYearLine is longer than 6 words", () => {
  fresh();
  const lines = school.teachers.map((t) => Mock.lastYearLine(t.id));
  assert.ok(lines.filter(Boolean).length > 80);
  for (const line of lines) assert.ok(words(line) <= 6, line);
  // The line follows last year only, so it is the same with names on and after a move.
  Mock.setNames(true);
  Mock.move(school.teachers.find((t) => draft[t.id]).id, null);
  assert.deepEqual(school.teachers.map((t) => Mock.lastYearLine(t.id)), lines);
});

test("thisYear follows the draft, a move, and Undo", () => {
  fresh();
  const placed = { ...draft };
  checkThisYear(placed);
  const seen = new Set(school.teachers.map((t) => Mock.thisYear(t.id)));
  for (const k of ["notPlaced", "returning", "noForm", "top4", "5to7"]) assert.ok(seen.has(k), `nobody is ${k} in the draft`);

  // An owed teacher on a top-4 choice goes to Not placed and comes back with Undo.
  const owed = withResult("none").find((t) => !t.returning && Mock.thisYear(t.id) === "top4");
  assert.ok(owed);
  Mock.move(owed.id, null);
  assert.equal(Mock.thisYear(owed.id), "notPlaced");
  checkThisYear({ ...placed, [owed.id]: null });
  Mock.undo();
  assert.equal(Mock.thisYear(owed.id), "top4");
  checkThisYear(placed);

  // A course they did not rank.
  const unranked = school.courses.find((c) => c.running && !owed.prefs.some((p) => p.course === c.id));
  Mock.move(owed.id, unranked.id);
  assert.equal(Mock.thisYear(owed.id), "notRanked");
  Mock.undo();
  assert.equal(Mock.thisYear(owed.id), "top4");

  // A returning sponsor moved off their course is no longer counted as returning.
  const sponsor = school.teachers.find((t) => t.returning && draft[t.id] === t.returningCourse);
  const other = school.courses.find((c) => c.running && c.id !== sponsor.returningCourse && !sponsor.prefs.some((p) => p.course === c.id));
  assert.equal(Mock.thisYear(sponsor.id), "returning");
  Mock.move(sponsor.id, other.id);
  assert.equal(Mock.thisYear(sponsor.id), sponsor.submitted ? "notRanked" : "noForm");
  Mock.undo();
  assert.equal(Mock.thisYear(sponsor.id), "returning");

  // Scripted moves, checked against the plain copy.
  const rand = lcg(17);
  const cs = school.courses.filter((c) => c.running);
  for (let i = 0; i < 40; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    const to = rand(5) === 0 ? null : cs[rand(cs.length)].id;
    Mock.move(t.id, to);
    placed[t.id] = to;
  }
  checkThisYear(placed);
  assert.ok(school.teachers.some((t) => Mock.thisYear(t.id) === "notRanked"));
});

test("reasons are the same with and without past files for a teacher on the same course", () => {
  // T numbers are drawn afresh on each read, so the two Schools are paired by email and given the same placements.
  const reasonsBy = (sch, placedByEmail) => {
    Mock.init(sch);
    Mock.build(Object.fromEntries(sch.teachers.map((t) => [t.id, placedByEmail[t.email]])));
    return Object.fromEntries(sch.teachers.map((t) => [t.email, Mock.reason(t.id)]));
  };
  const drafts = {
    "ten-file draft": Object.fromEntries(school.teachers.map((t) => [t.email, draft[t.id]])),
    "six-file draft": Object.fromEntries(plain.teachers.map((t) => [t.email, plainDraft[t.id]])),
  };
  assert.notDeepEqual(drafts["ten-file draft"], drafts["six-file draft"]);
  for (const [name, byEmail] of Object.entries(drafts)) {
    const without = reasonsBy(plain, byEmail);
    const withPast = reasonsBy(school, byEmail);
    assert.equal(Object.keys(withPast).length, school.teachers.length);
    assert.deepEqual(withPast, without, name);
  }
});

test("no reason mentions last year", () => {
  fresh();
  const check = () => {
    for (const t of school.teachers) assert.ok(!/last year/i.test(Mock.reason(t.id)), Mock.reason(t.id));
  };
  check();
  const rand = lcg(29);
  const cs = school.courses.filter((c) => c.running);
  for (let i = 0; i < 20; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    Mock.move(t.id, rand(5) === 0 ? null : cs[rand(cs.length)].id);
  }
  check();
  Mock.setNames(true);
  check();
});
