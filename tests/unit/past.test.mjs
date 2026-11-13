import { test } from "node:test";
import assert from "node:assert/strict";
import { lastYearResults } from "../../src/past.js";

// A made-up list, used only here.
const at = (x) => `${x}@fernhollow.example`;
const staff = [
  { email: at("a"), name: "Pat One" },
  { email: at("b"), name: "Pat Two" },
  { email: at("c"), name: "Pat Three" },
  { email: at("d"), name: "Pat Four" },
];
const placed = (course, ...sponsors) => ({ course, sponsors });
const listed = (who, course, rank, round) => ({ email: at(who), course, rank, round });
const run = (allocation, forms, people = staff) => lastYearResults({ allocation, forms, staff: people });
const none = { result: "none", rank: null, round: null };
const notFound = { result: "notFound", rank: null, round: null };
const noForm = { result: "noForm", rank: null, round: null };

test("placed on a 1st to 4th choice is top4, with rank and round", () => {
  const { byEmail } = run([placed("C1", "Pat One")], [listed("a", "C2", 1, "Round 1"), listed("a", "C1", 4, "Round 1")]);
  assert.deepEqual(byEmail.get(at("a")), { result: "top4", rank: 4, round: "Round 1" });
});

test("placed on a 5th to 7th choice is 5to7", () => {
  const { byEmail } = run(
    [placed("C1", "Pat One"), placed("C2", "Pat Two")],
    [listed("a", "C1", 5, "Singapore"), listed("b", "C2", 7, "Round 1")],
  );
  assert.deepEqual(byEmail.get(at("a")), { result: "5to7", rank: 5, round: "Singapore" });
  assert.deepEqual(byEmail.get(at("b")), { result: "5to7", rank: 7, round: "Round 1" });
});

test("sent a form, placed on a course not on it, is none", () => {
  const { byEmail } = run([placed("C3", "Pat One")], [listed("a", "C1", 1, "Round 1"), listed("a", "C2", 2, "Round 1")]);
  assert.deepEqual(byEmail.get(at("a")), none);
});

test("sent a form, not on the allocation, is notFound", () => {
  const { byEmail } = run([placed("C1", "Pat Two")], [listed("a", "C1", 1, "Round 1")]);
  assert.deepEqual(byEmail.get(at("a")), notFound);
});

test("placed with no form is noForm", () => {
  const { byEmail } = run([placed("C1", "Pat One")], [listed("b", "C1", 1, "Round 1")]);
  assert.deepEqual(byEmail.get(at("a")), noForm);
});

test("in no past file has no entry", () => {
  const { byEmail } = run([placed("C1", "Pat One")], [listed("b", "C1", 1, "Round 1")]);
  assert.equal(byEmail.has(at("c")), false);
  assert.deepEqual([...byEmail.keys()], [at("a"), at("b")]);
});

test("a course on two forms takes the rank from Round 1, then Round 2, then Singapore", () => {
  const { byEmail } = run(
    [placed("C1", "Pat One", "Pat Two")],
    [
      listed("a", "C1", 2, "Round 2"), listed("a", "C1", 6, "Round 1"),
      listed("b", "C1", 1, "Singapore"), listed("b", "C1", 3, "Round 2"),
    ],
  );
  assert.deepEqual(byEmail.get(at("a")), { result: "5to7", rank: 6, round: "Round 1" });
  assert.deepEqual(byEmail.get(at("b")), { result: "top4", rank: 3, round: "Round 2" });
});

test("names match ignoring case and extra spaces", () => {
  const { byEmail, unmatched } = run([placed("C1", "  pat   ONE ")], [listed("a", "C1", 1, "Round 1")]);
  assert.deepEqual(byEmail.get(at("a")), { result: "top4", rank: 1, round: "Round 1" });
  assert.deepEqual(unmatched, []);
});

test("a sponsor entry that matches nobody is unmatched, as written", () => {
  const { byEmail, unmatched } = run([placed("C1", "Pat One", " Sponsor who left ")], []);
  assert.deepEqual(unmatched, ["Sponsor who left"]);
  assert.deepEqual([...byEmail.keys()], [at("a")]);
});

test("a name shared by two staff matches neither", () => {
  const people = [{ email: at("a"), name: "Pat One" }, { email: at("b"), name: "pat  one" }, { email: at("c"), name: "Pat Three" }];
  const { byEmail, unmatched } = run([placed("C1", "Pat One")], [listed("a", "C1", 1, "Round 1")], people);
  assert.deepEqual(unmatched, ["Pat One"]);
  assert.deepEqual(byEmail.get(at("a")), notFound);
  assert.equal(byEmail.has(at("b")), false);
});

test("blank sponsor entries are skipped", () => {
  const { byEmail, unmatched } = run([placed("C1", "", "Pat One", "  ")], []);
  assert.deepEqual(unmatched, []);
  assert.deepEqual([...byEmail], [[at("a"), noForm]]);
  assert.deepEqual(run([placed("C1", null, "Pat One", undefined)], []).unmatched, []); // an empty cell
});

test("past emails not on this year's staff are ignored", () => {
  const { byEmail, unmatched } = run([placed("C1", "Pat One")], [listed("z", "C1", 1, "Round 1"), listed("a", "C2", 1, "Round 1")]);
  assert.equal(byEmail.has(at("z")), false);
  assert.deepEqual([...byEmail], [[at("a"), none]]);
  assert.deepEqual(unmatched, []);
});
