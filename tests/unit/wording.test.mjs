import { test } from "node:test";
import assert from "node:assert/strict";
import { Mock } from "../../src/state.js";

// Made-up school, used only here. No files.
const course = (id, needs = null) => ({ id, name: `Course ${id}`, kind: "International", seats: 1, running: true, needs });
const school = (needs) => ({
  school: "Made up", year: "Made up", courses: [course("X", needs), course("Y")],
  teachers: [{ id: "A", name: "A", email: "a@fernhollow.example", returning: false, returningCourse: null, submitted: true, certificates: [],
    prefs: [{ course: "X", rank: 1, round: "Round 1" }, { course: "Y", rank: 2, round: "Round 1" }] }],
});
const reasonFor = (needs) => { Mock.init(school(needs)); Mock.build({ A: "Y" }); return Mock.reason("A"); };

test("a missing certificate takes a or an by its first letter", () => {
  assert.equal(reasonFor("Open water licence"), "Their 2nd choice in Round 1. Their 1st choice, Course X, needs an open water licence.");
  assert.equal(reasonFor("Scuba certificate"), "Their 2nd choice in Round 1. Their 1st choice, Course X, needs a scuba certificate.");
});
