// tools/convert: raw office-style rows in, the page's rows out. Invented data only; the old domain is invented too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "../../tools/convert/convert.mjs";
import { HEADERS, PAST_SLOTS } from "../../src/import.js";

import { rawSchool, NEW, blanks } from "./convert-fixture.mjs";

const run = (over = {}) => convert({ ...rawSchool(), ...over });
const has = (report, ...bits) => report.some((l) => bits.every((b) => l.includes(b)));

test("courses take code and seats from the allocation, type from the country", () => {
  const { files, report } = run();
  assert.deepEqual(files["courses.xlsx"], [
    HEADERS["courses.xlsx"],
    ["AUST-1", "Great Ocean Road", "International", 3, "Yes", "", "Australia", "Portside", "v1"],
    ["TASL-2", "River Walk", "International", 1, "Yes", "", "Tasland", "Tash", "v2"],
    ["NOTRUN-1", "Glacier Camp", "International", 2, "No", "", "Moravia", "Morv", "v3"],
    ["SING-1", "Garden Trails", "Singapore", 1, "Yes", "", "Singapore", "Singapore", "v4"],
  ]);
  assert.ok(has(report, "Glacier Camp", "NOTRUN-1", "not offered"));
});

test("a not-offered code never repeats a code already in use", () => {
  const allocation = [...rawSchool()["allocation.xlsx"], ["NOTRUN-1", "NOTRUN-1 Moon Base", "Eve Ng", "", ""]];
  const { files } = run({ "allocation.xlsx": allocation });
  assert.ok(files["courses.xlsx"].some((r) => r[1] === "Glacier Camp" && r[0] === "NOTRUN-2" && r[4] === "No"));
});

test("an allocation course that is not on the course list is added as a Singapore course and reported", () => {
  const raw = rawSchool()["allocation.xlsx"];
  const { files, report } = run({ "allocation.xlsx": [...raw, ["SING-7", "SING-7 Moon Base", "Eve Ng", "Ana De Souza", ""]] });
  assert.deepEqual(files["courses.xlsx"].at(-1), ["SING-7", "Moon Base", "Singapore", 2, "Yes", "", "Singapore", "", ""]);
  assert.ok(has(report, "allocation.xlsx", "Moon Base", "Singapore"));
});

test("Singapore courses missing from the course list come from the allocation, and Singapore choices match them", () => {
  const courses = rawSchool()["courses.xlsx"].filter((r) => r[0] !== "Garden Trails");
  const { files, report } = run({ "courses.xlsx": courses });
  assert.ok(files["courses.xlsx"].some((r) => r[0] === "SING-1" && r[1] === "Garden Trails" && r[2] === "Singapore"));
  assert.equal(files["singapore.xlsx"][1][2], "Garden Trails");
  assert.ok(!has(report, "Garden Trails", "matches no course"));
});

test("a (FEMALE) or (MALE) choice is matched without the marker, and the marked course is reported once", () => {
  const r1 = rawSchool()["round1.xlsx"];
  const { files, report } = run({ "round1.xlsx": [r1[0],
    [NEW, "woxley@oldschool.example", "Australia — Great Ocean Road (FEMALE)", "", "", "", ...blanks(6)],
    [NEW, "clim@oldschool.example", "Australia — Great Ocean Road (FEMALE)", "", "", "", ...blanks(6)]] });
  assert.equal(files["round1.xlsx"][1][2], "Great Ocean Road");
  assert.equal(files["round1.xlsx"][2][2], "Great Ocean Road");
  assert.equal(report.filter((l) => l.includes("(FEMALE)")).length, 1);
  assert.ok(has(report, "Great Ocean Road", "(FEMALE)", "check"));
  assert.ok(files["round1.xlsx"].flat().every((c) => !String(c).includes("FEMALE")));
});

test("a course named with other punctuation on the allocation still gets its code, with no report line", () => {
  const courses = [...rawSchool()["courses.xlsx"], ["Hill — Lake Loop", "v5", "Tash", "Tasland"]];
  const allocation = [...rawSchool()["allocation.xlsx"], ["HILL-1", "HILL-1 Hill: Lake Loop", "Eve Ng", "", ""]];
  const { files, report } = run({ "courses.xlsx": courses, "allocation.xlsx": allocation });
  assert.ok(files["courses.xlsx"].some((r) => r[0] === "HILL-1" && r[1] === "Hill — Lake Loop"));
  assert.ok(!has(report, "Lake Loop"));
});

test("a choice with a small slip is matched to the closest course and reported for a check", () => {
  const r1 = rawSchool()["round1.xlsx"];
  const { files, report } = run({ "round1.xlsx": [r1[0], [NEW, "woxley@oldschool.example", "Australia — Great Ocen Road", "", "", "", ...blanks(6)]] });
  assert.equal(files["round1.xlsx"][1][2], "Great Ocean Road");
  assert.ok(has(report, "round1.xlsx", "row 2", "Great Ocen Road", "Great Ocean Road", "check"));
});

test("round 1 is put in the page's column order with choices written as the course name", () => {
  const { files } = run();
  assert.deepEqual(files["round1.xlsx"][0], HEADERS["round1.xlsx"]);
  assert.deepEqual(files["round1.xlsx"][1], [NEW, "woxley@oldschool.example", "Great Ocean Road", "River Walk", ...blanks(5), "ans1", "pri1", "fin1"]);
  assert.deepEqual(files["singapore.xlsx"][1], [NEW, "drao@oldschool.example", "Garden Trails", ...blanks(4), "sg ans", "sg more"]);
});

test("a repeat form keeps the latest timestamp and reports the one left out", () => {
  const { files, report } = run();
  const emails = files["round1.xlsx"].slice(1).map((r) => r[1]);
  assert.deepEqual(emails, ["woxley@oldschool.example", "clim@oldschool.example"]);
  assert.ok(has(report, "round1.xlsx", "row 3", "row 2 kept"));
});

test("with number timestamps the larger one wins even when it comes second", () => {
  const head = rawSchool()["round1.xlsx"][0];
  const { files, report } = run({ "round1.xlsx": [head,
    [45000, "woxley@oldschool.example", "Great Ocean Road", "", "", "", ...blanks(6)],
    [45001, "woxley@oldschool.example", "River Walk", "", "", "", ...blanks(6)]] });
  assert.equal(files["round1.xlsx"].length, 2);
  assert.equal(files["round1.xlsx"][1][2], "River Walk");
  assert.ok(has(report, "row 2", "row 3 kept"));
});

test("a choice that matches no course is kept as written and reported", () => {
  const { files, report } = run();
  assert.equal(files["round1.xlsx"][2][2], "Atlantis — Sunken City");
  assert.ok(has(report, "round1.xlsx", "row 4", "Choice 1", "Atlantis — Sunken City"));
});

test("returning copies Prior Course as the code and reports one not on this year's list", () => {
  const { files, report } = run();
  assert.deepEqual(files["returning.xlsx"], [HEADERS["returning.xlsx"], ["woxley@oldschool.example", "AUST-1"], ["drao@oldschool.example", "SING-9"]]);
  assert.ok(has(report, "returning.xlsx", "row 3", "SING-9"));
  assert.ok(!has(report, "AUST-1"));
});

test("round2 and singapore are written only when given", () => {
  const { files } = run();
  assert.ok(!("round2.xlsx" in files));
  assert.ok("singapore.xlsx" in files);
});

test("a row whose email is not one address is left out and reported", () => {
  const head = rawSchool()["round1.xlsx"][0];
  const { files, report } = run({ "round1.xlsx": [head, [NEW, "no address", "Great Ocean Road", "", "", "", ...blanks(6)]] });
  assert.equal(files["round1.xlsx"].length, 1);
  assert.ok(has(report, "round1.xlsx", "row 2", "email"));
});

test("emails keep their own domain, in lower case, so one name on two domains stays two people", () => {
  const ret = rawSchool()["returning.xlsx"];
  const { files } = run({ "returning.xlsx": [...ret, [" WOxley@Elsewhere.example ", "Repeat", "AUST-1"]] });
  const emails = files["returning.xlsx"].slice(1).map((r) => r[0]);
  assert.deepEqual(emails, ["woxley@oldschool.example", "drao@oldschool.example", "woxley@elsewhere.example"]);
});

test("a missing column stops the run with the file and column named", () => {
  assert.throws(() => run({ "courses.xlsx": [["Course Name", "Vendor", "Arrival City"]] }), /courses\.xlsx.*Country/);
});

test("two courses with the same name are reported", () => {
  const c = rawSchool()["courses.xlsx"];
  const { report } = run({ "courses.xlsx": [...c, ["River Walk", "v5", "Elsewhere", "Moravia"]] });
  assert.ok(has(report, "courses.xlsx", "River Walk", "same name"));
});

test("staff lists every form and returning email, named from the allocation", () => {
  const { files, report } = run();
  assert.deepEqual(files["staff.xlsx"], [
    HEADERS["staff.xlsx"],
    ["clim@oldschool.example", "Cara Lim", ""],
    ["drao@oldschool.example", "Dev Rao", ""],
    ["woxley@oldschool.example", "Wen Oxley", ""],
  ]);
  assert.ok(has(report, "Ana De Souza", "no email"));
  assert.ok(has(report, "Ben Ode", "no email"));
});

test("a two-word last name finds its email", () => {
  const ret = rawSchool()["returning.xlsx"];
  const { files } = run({ "returning.xlsx": [...ret, ["adesouza@oldschool.example", "Repeat", "AUST-1"]] });
  assert.ok(files["staff.xlsx"].some((r) => r[0] === "adesouza@oldschool.example" && r[1] === "Ana De Souza"));
});

test("two sponsors for one email leave the name blank, and so does an email no sponsor fits", () => {
  const ret = rawSchool()["returning.xlsx"];
  const alloc = rawSchool()["allocation.xlsx"];
  const { files, report } = run({
    "returning.xlsx": [...ret, ["jsmith@oldschool.example", "Repeat", "AUST-1"], ["qwu@oldschool.example", "Repeat", "AUST-1"]],
    "allocation.xlsx": [...alloc, ["MORV-1", "MORV-1 Glacier Camp", "Jo Smith", "Jay Smith", ""]],
  });
  const row = (e) => files["staff.xlsx"].find((r) => r[0] === e);
  assert.deepEqual(row("jsmith@oldschool.example"), ["jsmith@oldschool.example", "", ""]);
  assert.deepEqual(row("qwu@oldschool.example"), ["qwu@oldschool.example", "", ""]);
  assert.ok(has(report, "jsmith@oldschool.example", "Jo Smith", "Jay Smith"));
  assert.ok(has(report, "qwu@oldschool.example", "no name"));
});

test("a sponsor whose key also fits a numbered email is left blank and reported", () => {
  const head = rawSchool()["round1.xlsx"][0];
  const alloc = rawSchool()["allocation.xlsx"];
  const { files, report } = run({
    "round1.xlsx": [head,
      [NEW, "jsmith@oldschool.example", "Great Ocean Road", "", "", "", ...blanks(6)],
      [NEW, "jsmith2@oldschool.example", "River Walk", "", "", "", ...blanks(6)]],
    "allocation.xlsx": [...alloc, ["MORV-1", "MORV-1 Glacier Camp", "Jane Smith", "", ""]],
  });
  const row = (e) => files["staff.xlsx"].find((r) => r[0] === e);
  assert.equal(row("jsmith@oldschool.example")[1], "");
  assert.equal(row("jsmith2@oldschool.example")[1], "");
  assert.ok(has(report, "Jane Smith", "jsmith@oldschool.example", "jsmith2@oldschool.example"));
});

test("text timestamps are read only when they cannot be misread, and the report says so otherwise", () => {
  const head = rawSchool()["round1.xlsx"][0];
  const iso = run({ "round1.xlsx": [head,
    ["2031-04-01 10:00:00", "bode@oldschool.example", "River Walk", "", "", "", ...blanks(6)],
    ["2031-03-02 10:00:00", "bode@oldschool.example", "Great Ocean Road", "", "", "", ...blanks(6)]] });
  assert.equal(iso.files["round1.xlsx"][1][2], "River Walk");
  const dm = run({ "round1.xlsx": [head,
    ["01/04/2031 10:00:00", "bode@oldschool.example", "River Walk", "", "", "", ...blanks(6)],
    ["02/03/2031 10:00:00", "bode@oldschool.example", "Great Ocean Road", "", "", "", ...blanks(6)]] });
  assert.equal(dm.files["round1.xlsx"][1][2], "Great Ocean Road");
  assert.ok(has(dm.report, "row 2", "timestamp", "could not be read", "row 3 kept"));
});

test("an allocation course is never matched to a course list name only by sharing its words", () => {
  const allocation = [...rawSchool()["allocation.xlsx"], ["SING-3", "SING-3 Ocean", "Eve Ng", "", ""]];
  const { files } = run({ "allocation.xlsx": allocation });
  assert.ok(files["courses.xlsx"].some((r) => r[0] === "SING-3" && r[1] === "Ocean" && r[2] === "Singapore"));
  assert.ok(files["courses.xlsx"].some((r) => r[0] === "AUST-1" && r[1] === "Great Ocean Road"));
});

test("an On-Deck or Flex role is taken out of the choices, later choices move up, and each pick is listed", () => {
  const sg = rawSchool()["singapore.xlsx"];
  const { files, report } = run({ "singapore.xlsx": [sg[0],
    [NEW, "drao@oldschool.example", '"On-Deck" Role - Stand by for any group.', "Garden Trails", '"Flex" Role - Go where needed.', "", "", "a", "b"]] });
  assert.deepEqual(files["singapore.xlsx"][1], [NEW, "drao@oldschool.example", "Garden Trails", "", "", "", "", "a", "b"]);
  assert.ok(has(report, "singapore.xlsx", "row 2", "drao@oldschool.example", "On-Deck", "Choice 1"));
  assert.ok(has(report, "singapore.xlsx", "row 2", "drao@oldschool.example", "Flex", "Choice 3"));
  assert.ok(!has(report, "singapore.xlsx", "matches no course"));
});

// An upcoming year has no final allocation yet: codes and seats come from courses.xlsx when it has them.
const noAllocation = (courses) => { const raw = rawSchool(); delete raw["allocation.xlsx"]; return convert(courses ? { ...raw, "courses.xlsx": courses } : raw); };

test("without the allocation, code and seats come from courses.xlsx, every course is offered, and names are left to fill in", () => {
  const courses = [["Course Code", "Course Name", "Seats", "Vendor", "Arrival City", "Country"],
    ["AUST-1", "Great Ocean Road", 3, "v1", "Portside", "Australia"],
    ["TASL-2", "River Walk", "2", "v2", "Tash", "Tasland"],
    ["", "Glacier Camp", "", "v3", "Morv", "Moravia"],
    ["SING-1", "Garden Trails", 1, "v4", "Singapore", "Singapore"]];
  const { files, report } = noAllocation(courses);
  assert.deepEqual(files["courses.xlsx"], [
    HEADERS["courses.xlsx"],
    ["AUST-1", "Great Ocean Road", "International", 3, "Yes", "", "Australia", "Portside", "v1"],
    ["TASL-2", "River Walk", "International", 2, "Yes", "", "Tasland", "Tash", "v2"],
    ["", "Glacier Camp", "International", 2, "Yes", "", "Moravia", "Morv", "v3"],
    ["SING-1", "Garden Trails", "Singapore", 1, "Yes", "", "Singapore", "Singapore", "v4"],
  ]);
  assert.ok(has(report, "Glacier Camp", "no course code"));
  assert.ok(has(report, "Glacier Camp", "seats", "2"));
  assert.ok(!report.some((l) => /not offered|NOTRUN/.test(l)));
  // Names come only from the allocation: one line for all of them, not one per email.
  assert.ok(files["staff.xlsx"].slice(1).every((r) => r[1] === ""));
  assert.equal(report.filter((l) => l.startsWith("staff.xlsx")).length, 1);
  assert.ok(has(report, "staff.xlsx", "no allocation.xlsx", "3 names"));
  // Returning codes are checked against the codes courses.xlsx gave.
  assert.ok(has(report, "returning.xlsx", "SING-9"));
  assert.ok(!has(report, "returning.xlsx", "AUST-1"));
});

test("without the allocation or a code column, every code is left to fill in and seats are 2", () => {
  const { files, report } = noAllocation();
  assert.ok(files["courses.xlsx"].slice(1).every((r) => r[0] === "" && r[3] === 2 && r[4] === "Yes"));
  assert.ok(has(report, "courses.xlsx", "no Course Code column", "4"));
  assert.ok(has(report, "courses.xlsx", "no Seats column", "2 seats"));
  assert.ok(has(report, "no allocation.xlsx", "Singapore"));
});

test("with --past, the allocation and the forms become last year's four files", () => {
  const { files } = convert(rawSchool(), { past: true });
  assert.deepEqual(Object.keys(files).sort(), [...PAST_SLOTS].sort());
  assert.deepEqual(files["past-allocation.xlsx"], [
    ["Course Code", "Course Name", "Sponsor 1", "Sponsor 2", "Sponsor 3"],
    ["AUST-1", "Great Ocean Road", "Wen Oxley", "Ana De Souza", "Ben Ode"],
    ["TASL-2", "River Walk", "Cara Lim", "", ""],
    ["SING-1", "Garden Trails", "Dev Rao", "", ""],
  ]);
  const six = convert(rawSchool());
  assert.deepEqual(files["past-round1.xlsx"], [HEADERS["past-round1.xlsx"], ...six.files["round1.xlsx"].slice(1)]);
  assert.deepEqual(files["past-singapore.xlsx"], [HEADERS["past-singapore.xlsx"], ...six.files["singapore.xlsx"].slice(1)]);
  // No Round 2 forms: the file is still written, with headers only, since the page takes all four or none.
  assert.deepEqual(files["past-round2.xlsx"], [HEADERS["past-round2.xlsx"]]);
});

test("--past needs the allocation, and not the returning list", () => {
  const raw = rawSchool();
  delete raw["returning.xlsx"];
  assert.ok(convert(raw, { past: true }).files["past-allocation.xlsx"]);
  delete raw["allocation.xlsx"];
  assert.throws(() => convert(raw, { past: true }), /allocation\.xlsx: not found/);
});

test("--past lists a sponsor name that is on two courses", () => {
  const raw = rawSchool();
  raw["allocation.xlsx"].push(["MORV-1", "MORV-1 Glacier Camp", "cara  lim", "", ""]);
  const { report } = convert(raw, { past: true });
  assert.ok(has(report, "allocation.xlsx", "2 courses", "River Walk", "Glacier Camp"));
  assert.ok(!convert(rawSchool(), { past: true }).report.some((l) => l.includes("courses (")));
});
