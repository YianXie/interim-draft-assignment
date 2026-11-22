// Matching helpers for tools/convert.mjs. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, cleanEmail, courseIndex, nameKeys, findColumn, marker, stripMarker, role } from "../../tools/convert/match.mjs";

test("norm makes every dash, space and letter case the same", () => {
  assert.equal(norm("Australia —  Great  Ocean Road "), norm("australia - great ocean road"));
  assert.equal(norm("Tasland–River Walk"), norm("tasland - river walk"));
  assert.equal(norm(null), "");
});

test("cleanEmail trims and lower-cases one address and keeps its domain", () => {
  assert.equal(cleanEmail(" WOxley@OldSchool.example "), "woxley@oldschool.example");
  assert.equal(cleanEmail("nobody"), null);
  assert.equal(cleanEmail("@oldschool.example"), null);
  assert.equal(cleanEmail("woxley@"), null);
  assert.equal(cleanEmail("a@b@oldschool.example"), null);
  assert.equal(cleanEmail(""), null);
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

test("courseIndex ignores punctuation, & and a (FEMALE) or (MALE) marker", () => {
  const hill = { name: "Hill — Lake Loop", country: "Tasland" };
  const rocks = { name: "Rocks and Reefs", country: "Moravia" };
  const ocean = { name: "Great Ocean Road", country: "Australia" };
  const idx = courseIndex([hill, rocks, ocean]);
  assert.equal(idx.find("Hill: Lake Loop"), hill);
  assert.equal(idx.find("Tasland — Hill, Lake Loop"), hill);
  assert.equal(idx.find("Rocks & Reefs"), rocks);
  assert.equal(idx.find("Australia — Great Ocean Road (FEMALE)"), ocean);
  assert.equal(idx.find("Great Ocean Road (male)"), ocean);
});

test("marker reads a (FEMALE) or (MALE) marker in any case, and stripMarker takes it off", () => {
  assert.equal(marker("Great Ocean Road (FEMALE)"), "FEMALE");
  assert.equal(marker("Great Ocean Road (male) "), "MALE");
  assert.equal(marker("Great Ocean Road"), null);
  assert.equal(stripMarker("Great Ocean Road (FEMALE) "), "Great Ocean Road");
  assert.equal(stripMarker("Great Ocean Road"), "Great Ocean Road");
});

test("near finds the one clearly closest course for a slip or a shortened name, and nothing when unsure", () => {
  const ocean = { name: "Great Ocean Road", country: "Australia" };
  const glacier = { name: "Glacier Camp", country: "Moravia" };
  const walk = { name: "River Walk", country: "Tasland" };
  const talk = { name: "River Talk", country: "Tasland" };
  const idx = courseIndex([ocean, glacier, walk, talk]);
  assert.equal(idx.find("Great Ocen Road"), null);
  assert.equal(idx.near("Great Ocen Road"), ocean);
  assert.equal(idx.near("Australia — Great Ocen Rd"), null);
  assert.equal(idx.near("Moravia — Glacier"), glacier);
  assert.equal(idx.near("glacier camps"), glacier);
  assert.equal(idx.near("River Valk"), null);
  assert.equal(idx.near("River"), null);
  assert.equal(idx.near("Atlantis — Sunken City"), null);
  assert.equal(idx.near(""), null);
});

test("role reads the On-Deck and Flex roles however they are punctuated, and nothing else", () => {
  assert.equal(role('"On-Deck" Role - Stand by for any group.'), "On-Deck");
  assert.equal(role("on deck role"), "On-Deck");
  assert.equal(role('"Flex" Role - Go where needed.'), "Flex");
  assert.equal(role("Flexible Roles Camp"), null);
  assert.equal(role("Garden Trails"), null);
});
