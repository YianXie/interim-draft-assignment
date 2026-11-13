import { test } from "node:test";
import assert from "node:assert/strict";
import { lastYearResults } from "../../src/past.js";

// A made-up list, used only here.
const at = (x) => `${x}@fernhollow.example`;
const staff = [
  { email: at("a"), name: "Pat One" },
  { email: at("b"), name: "Pat Two" },
  { email: at("c"), name: "Pat Three" },
];
const none = { result: "none", rank: null, round: null };
const notFound = { result: "notFound", rank: null, round: null };
const noForm = { result: "noForm", rank: null, round: null };

// `sent` is every email with a row on any past form, whether or not a choice was filled in.
test("a blank past form still counts as a form", () => {
  const { byEmail } = lastYearResults({
    allocation: [{ course: "C1", sponsors: ["Pat One", "Pat Three"] }],
    forms: [],
    staff,
    sent: [at("a"), at("b")],
  });
  assert.deepEqual(byEmail.get(at("a")), none); // placed, blank form
  assert.deepEqual(byEmail.get(at("b")), notFound); // blank form, not on the allocation
  assert.deepEqual(byEmail.get(at("c")), noForm); // placed, no row on any form
});

test("sent changes nothing for someone with a listed choice", () => {
  const forms = [{ email: at("a"), course: "C1", rank: 2, round: "Round 1" }];
  const allocation = [{ course: "C1", sponsors: ["Pat One"] }];
  const withSent = lastYearResults({ allocation, forms, staff, sent: [at("a")] });
  const without = lastYearResults({ allocation, forms, staff });
  assert.deepEqual(withSent.byEmail.get(at("a")), { result: "top4", rank: 2, round: "Round 1" });
  assert.deepEqual([...withSent.byEmail], [...without.byEmail]);
});

test("a blank past form from someone not on this year's staff is ignored", () => {
  const { byEmail, unmatched } = lastYearResults({ allocation: [], forms: [], staff, sent: [at("z")] });
  assert.equal(byEmail.size, 0);
  assert.deepEqual(unmatched, []);
});
