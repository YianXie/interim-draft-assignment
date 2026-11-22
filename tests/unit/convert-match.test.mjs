// Matching helpers for tools/convert.mjs. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, newEmail, courseIndex, nameKeys, findColumn } from "../../tools/convert/match.mjs";

test("norm makes every dash, space and letter case the same", () => {
  assert.equal(norm("Australia —  Great  Ocean Road "), norm("australia - great ocean road"));
  assert.equal(norm("Tasland–River Walk"), norm("tasland - river walk"));
  assert.equal(norm(null), "");
});

test("newEmail keeps the part before @ and moves it to fernhollow.example", () => {
  assert.equal(newEmail(" WOxley@OldSchool.example "), "woxley@fernhollow.example");
  assert.equal(newEmail("nobody"), null);
  assert.equal(newEmail("@oldschool.example"), null);
  assert.equal(newEmail("a@b@oldschool.example"), null);
  assert.equal(newEmail(""), null);
});

test("courseIndex finds a course with or without its country, and lists shared bare names", () => {
  const ocean = { name: "Great Ocean Road", country: "Australia" };
  const walkT = { name: "River Walk", country: "Tasland" };
  const walkM = { name: "River Walk", country: "Moravia" };
  const idx = courseIndex([ocean, walkT, walkM]);
  assert.equal(idx.find("Australia – Great Ocean Road"), ocean);
  assert.equal(idx.find("great ocean road"), ocean);
  assert.equal(idx.find("Moravia - River Walk"), walkM);
  assert.equal(idx.find("River Walk"), null);
  assert.equal(idx.find("Nowhere — Lost Trail"), null);
  assert.deepEqual(idx.duplicates, ["River Walk"]);
});

test("courseIndex matches a name that itself holds a dash", () => {
  const c = { name: "Hill - Lake Loop", country: "Tasland" };
  const idx = courseIndex([c]);
  assert.equal(idx.find("Hill — Lake Loop"), c);
  assert.equal(idx.find("Tasland — Hill — Lake Loop"), c);
});

test("nameKeys gives first initial plus last name, and plus every later word", () => {
  assert.deepEqual(nameKeys("Wen Oxley"), ["woxley"]);
  assert.deepEqual(nameKeys("Ana De Souza"), ["asouza", "adesouza"]);
  assert.deepEqual(nameKeys(" Mae O'Neil-Park "), ["moneilpark"]);
  assert.deepEqual(nameKeys("Cher"), []);
});

test("findColumn finds a header holding every word", () => {
  assert.equal(findColumn(["Timestamp ", "Email Address", "First Preference "], ["first", "preference"]), 2);
  assert.equal(findColumn(["Timestamp"], ["email"]), -1);
});
