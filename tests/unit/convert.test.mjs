// tools/convert: raw office-style rows in, the page's rows out. Invented data only; the old domain is invented too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "../../tools/convert/convert.mjs";
import { HEADERS } from "../../src/import.js";

import { rawSchool, NEW, blanks } from "./convert-fixture.mjs";

const run = (over = {}) => convert({ ...rawSchool(), ...over });
const has = (report, ...bits) => report.some((l) => bits.every((b) => l.includes(b)));

test("courses take code and seats from the allocation, type from the country", () => {
  const { files, report } = run();
  assert.deepEqual(files["courses.xlsx"], [
    HEADERS["courses.xlsx"],
    ["AUST-1", "Great Ocean Road", "International", 3, "Yes", "", "Australia", "Portside", "v1"],
    ["TASL-2", "River Walk", "International", 1, "Yes", "", "Tasland", "Tash", "v2"],
    ["", "Glacier Camp", "International", 2, "Yes", "", "Moravia", "Morv", "v3"],
    ["SING-1", "Garden Trails", "Singapore", 1, "Yes", "", "Singapore", "Singapore", "v4"],
  ]);
  assert.ok(has(report, "Glacier Camp", "Course Code", "blank"));
});

test("an allocation course that is not on the course list is reported", () => {
  const raw = rawSchool()["allocation.xlsx"];
  const { report } = run({ "allocation.xlsx": [...raw, ["ZZZZ-1", "ZZZZ-1 Moon Base", "Eve Ng", "", ""]] });
  assert.ok(has(report, "allocation.xlsx", "row 5", "Moon Base"));
});

test("round 1 is put in the page's column order with choices written as the course name", () => {
  const { files } = run();
  assert.deepEqual(files["round1.xlsx"][0], HEADERS["round1.xlsx"]);
  assert.deepEqual(files["round1.xlsx"][1], [NEW, "woxley@fernhollow.example", "Great Ocean Road", "River Walk", ...blanks(5), "ans1", "pri1", "fin1"]);
  assert.deepEqual(files["singapore.xlsx"][1], [NEW, "drao@fernhollow.example", "Garden Trails", ...blanks(4), "sg ans", "sg more"]);
});

test("a repeat form keeps the latest timestamp and reports the one left out", () => {
  const { files, report } = run();
  const emails = files["round1.xlsx"].slice(1).map((r) => r[1]);
  assert.deepEqual(emails, ["woxley@fernhollow.example", "clim@fernhollow.example"]);
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
  assert.deepEqual(files["returning.xlsx"], [HEADERS["returning.xlsx"], ["woxley@fernhollow.example", "AUST-1"], ["drao@fernhollow.example", "SING-9"]]);
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

test("two different addresses that would become one stop the run", () => {
  const ret = rawSchool()["returning.xlsx"];
  assert.throws(() => run({ "returning.xlsx": [...ret, ["woxley@elsewhere.example", "Repeat", "AUST-1"]] }), /woxley@fernhollow\.example/);
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
    ["clim@fernhollow.example", "Cara Lim", ""],
    ["drao@fernhollow.example", "Dev Rao", ""],
    ["woxley@fernhollow.example", "Wen Oxley", ""],
  ]);
  assert.ok(has(report, "Ana De Souza", "no email"));
  assert.ok(has(report, "Ben Ode", "no email"));
});

test("a two-word last name finds its email", () => {
  const ret = rawSchool()["returning.xlsx"];
  const { files } = run({ "returning.xlsx": [...ret, ["adesouza@oldschool.example", "Repeat", "AUST-1"]] });
  assert.ok(files["staff.xlsx"].some((r) => r[0] === "adesouza@fernhollow.example" && r[1] === "Ana De Souza"));
});

test("two sponsors for one email leave the name blank, and so does an email no sponsor fits", () => {
  const ret = rawSchool()["returning.xlsx"];
  const alloc = rawSchool()["allocation.xlsx"];
  const { files, report } = run({
    "returning.xlsx": [...ret, ["jsmith@oldschool.example", "Repeat", "AUST-1"], ["qwu@oldschool.example", "Repeat", "AUST-1"]],
    "allocation.xlsx": [...alloc, ["MORV-1", "MORV-1 Glacier Camp", "Jo Smith", "Jay Smith", ""]],
  });
  const row = (e) => files["staff.xlsx"].find((r) => r[0] === e);
  assert.deepEqual(row("jsmith@fernhollow.example"), ["jsmith@fernhollow.example", "", ""]);
  assert.deepEqual(row("qwu@fernhollow.example"), ["qwu@fernhollow.example", "", ""]);
  assert.ok(has(report, "jsmith@fernhollow.example", "Jo Smith", "Jay Smith"));
  assert.ok(has(report, "qwu@fernhollow.example", "no name"));
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
  assert.equal(row("jsmith@fernhollow.example")[1], "");
  assert.equal(row("jsmith2@fernhollow.example")[1], "");
  assert.ok(has(report, "Jane Smith", "jsmith@fernhollow.example", "jsmith2@fernhollow.example"));
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
