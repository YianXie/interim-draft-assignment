import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook, writeBook } from "../../src/xlsx.js";
import { parseFiles, slotName, SLOTS } from "../../src/import.js";
import { readSchool } from "./school-fixture.mjs";

const dir = new URL("../../fixtures/school/", import.meta.url);
const SHEET = "Fernhollow";
// A form row is Timestamp, Email, the choices, then the written answers: Choice k is column k + 1.
const EMAIL = 1;
const CHOICE = (k) => k + 1;

async function load() {
  const out = {};
  for (const name of SLOTS) out[name] = (await readBook(new Uint8Array(await readFile(new URL(name, dir)))))[0].rows;
  return out;
}
async function run(edit, random) {
  const rows = await load();
  const names = {};
  edit?.(rows, names);
  const files = [];
  for (const name of SLOTS) {
    files.push({ name: names[name] ?? name, bytes: await writeBook([{ name: rows[name].sheetName ?? SHEET, rows: rows[name] }]) });
  }
  return parseFiles(files, random);
}
const seq = () => {
  let i = 0;
  return (n) => i++ % n;
};

test("six good files give the agreed school", async () => {
  const school = await readSchool();
  // Nothing names the invented school, so real files are never labelled as it.
  assert.ok(!("school" in school) && !("year" in school));
  assert.equal(school.teachers.length, 96);
  assert.equal(school.courses.length, 54);
  assert.equal(school.courses.filter((c) => c.running).length, 48);
  assert.deepEqual(Object.keys(school.courses[0]), ["id", "name", "kind", "seats", "running", "needs"]);
  assert.deepEqual(Object.keys(school.teachers[0]),
    ["id", "name", "email", "returning", "returningCourse", "submitted", "certificates", "prefs"]);
  const ids = new Set(school.courses.map((c) => c.id));
  for (const t of school.teachers) {
    for (const p of t.prefs) {
      assert.ok(ids.has(p.course));
      assert.ok(["Round 1", "Round 2", "Singapore"].includes(p.round));
    }
    if (t.returning) assert.ok(ids.has(t.returningCourse));
  }
  assert.ok(school.teachers.some((t) => t.returning));
  assert.ok(school.teachers.some((t) => !t.submitted));
  assert.ok(school.courses.some((c) => c.needs));
});

test("T numbers are unique T100..T999 and come from the random source", async () => {
  const a = await readSchool(seq());
  const ids = a.teachers.map((t) => t.id);
  assert.equal(new Set(ids).size, 96);
  for (const id of ids) assert.match(id, /^T[1-9]\d\d$/);
  // random(n) = 0 every time always takes the front of the pool
  const first = await readSchool(() => 0);
  assert.equal(first.teachers[0].id, "T100");
  const again = await readSchool(seq());
  assert.deepEqual(again.teachers.map((t) => t.id), ids);
  const last = await readSchool((n) => n - 1);
  assert.equal(last.teachers[0].id, "T999");
  const def = await readSchool();
  assert.equal(new Set(def.teachers.map((t) => t.id)).size, 96);
});

test("wrong file name is refused", async () => {
  const out = await run((_, names) => (names["staff.xlsx"] = "teachers.xlsx"));
  assert.equal(out.school, null);
  assert.match(out.slots["teachers.xlsx"], /^teachers\.xlsx: /);
  assert.match(out.slots["staff.xlsx"], /^staff\.xlsx: /);
});

// A re-download or a capital letter is the usual slip: "courses (1).xlsx", "Courses.xlsx", "staff copy.xlsx".
test("a file name that differs only by capitals, a copy number or the word copy picks its slot", async () => {
  for (const [given, slot] of [["Courses.xlsx", "courses.xlsx"], ["courses (1).xlsx", "courses.xlsx"], ["staff copy.xlsx", "staff.xlsx"], ["Round1 copy 2.XLSX", "round1.xlsx"],
    [" singapore(12).xlsx ", "singapore.xlsx"], ["Past-Allocation (2).xlsx", "past-allocation.xlsx"], ["FIT.xlsx", "fit.xlsx"]]) assert.equal(slotName(given), slot, given);
  // Anything else keeps the name it came with, so its line still shows what was dropped.
  for (const other of ["teachers.xlsx", "courses 2025.xlsx", "old courses.xlsx", "courses.xls", "courses (1) (2).xlsx", "courses.xlsx.xlsx"]) assert.equal(slotName(other), other);
  const names = { "courses.xlsx": "Courses (1).xlsx", "staff.xlsx": "STAFF.xlsx", "returning.xlsx": "returning copy.xlsx", "round1.xlsx": "Round1.xlsx" };
  const out = await run((_, n) => Object.assign(n, names));
  assert.ok(out.school);
  assert.deepEqual(Object.keys(out.slots).sort(), [...SLOTS].sort());
});

test("of two files for one slot, the later one is read", async () => {
  const good = await run();
  const rows = await load();
  const files = [];
  for (const name of SLOTS) files.push({ name, bytes: await writeBook([{ name: SHEET, rows: rows[name] }]) });
  const out = await parseFiles([...files, { name: "courses (1).xlsx", bytes: new Uint8Array([1]) }]);
  assert.ok(good.school);
  assert.equal(out.school, null);
  assert.equal(out.slots["courses.xlsx"], "courses.xlsx: not a readable .xlsx file");
});

test("courses.xlsx: stray spaces, letter case and a number typed as text are read as meant", async () => {
  const plain = await run(undefined, seq());
  const out = await run((rows) => {
    for (const r of rows["courses.xlsx"].slice(1)) {
      r[2] = ` ${String(r[2]).toUpperCase()} `;
      r[3] = ` ${r[3]} `;
      r[4] = `${String(r[4]).toLowerCase()} `;
    }
  }, seq());
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school, plain.school);
  for (const bad of ["2.0", "2 seats", "1e1", "", " "]) {
    const no = await run((rows) => (rows["courses.xlsx"][5][3] = bad));
    assert.equal(no.slots["courses.xlsx"], "courses.xlsx, row 6: seats must be a positive whole number", bad);
  }
});

test("the first sheet is read whatever its name", async () => {
  const base = await run(null, seq());
  const out = await run((rows) => (rows["round2.xlsx"].sheetName = "Sheet1"), seq());
  assert.equal(out.slots["round2.xlsx"], "ready");
  assert.deepEqual(out.school, base.school);
});

test("wrong header is refused with the file name", async () => {
  const out = await run((rows) => (rows["returning.xlsx"][0][1] = "Course"));
  assert.equal(out.school, null);
  assert.equal(out.slots["returning.xlsx"], 'returning.xlsx, row 1: column B should be "Course Code"; headers must be exactly: Email, Course Code');
});

test("a form or course list without one of the office's columns is refused", async () => {
  const lines = {
    "round1.xlsx": "Timestamp, Email, Choice 1, Choice 2, Choice 3, Choice 4, Choice 5, Choice 6, Choice 7, " +
      "Enhancing Learning or Safety, Notable Priorities, Final Questions or Comments",
    "round2.xlsx": "Timestamp, Email, Choice 1, Choice 2, Choice 3",
    "singapore.xlsx": "Timestamp, Email, Choice 1, Choice 2, Choice 3, Choice 4, Choice 5, " +
      "Enhancing Learning or Safety, Additional Comments or Questions",
    "courses.xlsx": "Course Code, Course Name, Type, Seats, Offered, Certificate, Arrival Country, Arrival City, Vendor Link",
  };
  for (const [file, line] of Object.entries(lines)) {
    // The first column taken away, and the last one.
    const heads = line.split(", ");
    const at = [["A", heads[0]], [String.fromCharCode(64 + heads.length), heads.at(-1)]];
    for (const [k, edit] of [(head) => head.shift(), (head) => head.pop()].entries()) {
      const out = await run((rows) => edit(rows[file][0]));
      assert.equal(out.school, null, file);
      assert.equal(out.slots[file], `${file}, row 1: column ${at[k][0]} should be "${at[k][1]}"; headers must be exactly: ${line}`);
    }
  }
});

test("timestamps, written answers, arrival places and vendor links are not read", async () => {
  const base = await run(undefined, seq());
  const out = await run((rows) => {
    for (const file of ["round1.xlsx", "round2.xlsx", "singapore.xlsx"]) {
      const head = rows[file][0];
      for (const r of rows[file].slice(1)) {
        r[0] = "not a time";
        // Anything at all under the answer headers, even text that would be refused as a choice or an email.
        head.forEach((h, i) => { if (i > EMAIL && !h.startsWith("Choice ")) r[i] = "Underwater Basket Weaving, x.y@elsewhere.example"; });
      }
    }
    for (const r of rows["courses.xlsx"].slice(1)) r.splice(6, 3, null, 42, "not a link");
  }, seq());
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.deepEqual(out.school, base.school);
});

test("a value past the last header of a form refuses the row", async () => {
  for (const file of ["round1.xlsx", "round2.xlsx", "singapore.xlsx"]) {
    const out = await run((rows) => (rows[file][2][rows[file][0].length] = "Underwater Basket Weaving"));
    assert.equal(out.school, null, file);
    assert.equal(out.slots[file], `${file}, row 3: value outside the headed columns`);
  }
  // Blank cells out there are nothing.
  const base = await run(undefined, seq());
  const out = await run((rows) => rows["round2.xlsx"][2].push(null, " ", ""), seq());
  assert.deepEqual(out.school, base.school);
});

test("an email on any domain is read as written, in lower case", async () => {
  // One teacher moved to another domain in every file that names them.
  const out = await run((rows) => {
    const was = rows["staff.xlsx"][4][0];
    for (const sheet of Object.values(rows)) for (const r of sheet) r.forEach((c, i) => c === was && (r[i] = " X.Y@Elsewhere.example "));
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  assert.ok(out.school.teachers.some((t) => t.email === "x.y@elsewhere.example"));
});

test("an email that is not one address is refused with file and row", async () => {
  for (const bad of ["x.y", "@elsewhere.example", "x.y@", "a@b@elsewhere.example", "x y@elsewhere.example"]) {
    const out = await run((rows) => (rows["staff.xlsx"][4][0] = bad));
    assert.equal(out.school, null, bad);
    assert.equal(out.slots["staff.xlsx"], "staff.xlsx, row 5: email is not one address", bad);
  }
});

test("form email not on the staff list is refused", async () => {
  const out = await run((rows) => (rows["round1.xlsx"][3][EMAIL] = "nobody.here@fernhollow.example"));
  assert.equal(out.school, null);
  assert.equal(out.slots["round1.xlsx"], "round1.xlsx, row 4: email is not on the staff list");
});

test("choice not on the course list is refused with file and row", async () => {
  const out = await run((rows) => (rows["singapore.xlsx"][2][CHOICE(3)] = "Underwater Basket Weaving"));
  assert.equal(out.school, null);
  assert.equal(out.slots["singapore.xlsx"], "singapore.xlsx, row 3: Choice 3 is not on the course list");
});

test("same email twice in one file is refused", async () => {
  const out = await run((rows) => rows["round2.xlsx"].push([...rows["round2.xlsx"][1]]));
  assert.equal(out.school, null);
  assert.match(out.slots["round2.xlsx"], /^round2\.xlsx, row \d+: email appears twice in this file$/);
});

test("returning code not on the course list is refused", async () => {
  const out = await run((rows) => (rows["returning.xlsx"][2][1] = "ZZ-99"));
  assert.equal(out.school, null);
  assert.equal(out.slots["returning.xlsx"], "returning.xlsx, row 3: course code is not on the course list");
});

// Rows are [Course Code, Course Name, Type, Seats, Offered, Certificate, ...]; returning rows are [Email, Course Code].
const courseRow = (rows, code) => rows["courses.xlsx"].find((r) => r[0] === code);

test("a returning sponsor without their course's certificate is refused", async () => {
  const out = await run((rows) => {
    const cert = rows["courses.xlsx"].slice(1).find((r) => r[5] && r[4] === "Yes");
    const r = rows["returning.xlsx"][1];
    const staff = rows["staff.xlsx"].find((x) => x[0] === r[0]);
    assert.ok(!String(staff[2] ?? "").includes(cert[5]), "fixture: this sponsor lacks the certificate");
    r[1] = cert[0];
  });
  assert.equal(out.school, null);
  assert.equal(out.slots["returning.xlsx"], "returning.xlsx, row 2: this sponsor does not hold the certificate the course needs");
});

test("more returning sponsors than seats on an offered course refuses the first row over", async () => {
  const out = await run((rows) => {
    const ret = rows["returning.xlsx"];
    const target = ret.slice(1).map((r) => courseRow(rows, r[1])).find((c) => c[4] === "Yes" && !c[5]);
    const others = ret.slice(1).filter((r) => r[1] !== target[0]);
    const already = ret.slice(1).length - others.length;
    others.slice(0, target[3] - already + 1).forEach((r) => (r[1] = target[0]));
  });
  assert.equal(out.school, null);
  assert.match(out.slots["returning.xlsx"], /^returning\.xlsx, row \d+: more returning sponsors than seats on this course$/);
});

test("any number of returning sponsors on a not-offered course still builds", async () => {
  const out = await run((rows) => {
    const closed = rows["courses.xlsx"].slice(1).find((r) => r[4] === "No");
    rows["returning.xlsx"].slice(1, 6).forEach((r) => (r[1] = closed[0]));
  });
  assert.ok(out.school, JSON.stringify(out.slots));
});

test("a certificate matches whatever its letter case or spacing, and takes the course list's spelling", async () => {
  let email, code;
  const out = await run((rows) => {
    const cert = rows["courses.xlsx"].slice(1).find((r) => r[5] && r[4] === "Yes");
    code = cert[0];
    const certs = new Set(rows["staff.xlsx"].slice(1).filter((r) => String(r[2] ?? "").includes(cert[5])).map((r) => r[0]));
    const back = new Set(rows["returning.xlsx"].slice(1).map((r) => r[0]));
    const t = rows["staff.xlsx"].slice(1).find((r) => !certs.has(r[0]) && !back.has(r[0]));
    email = t[0];
    t[2] = `  ${cert[5].toUpperCase().replace(" ", "   ")} ; First Aid`;
    // A returning sponsor written the other way round is still taken as holding it.
    rows["returning.xlsx"][1][0] = email;
    rows["returning.xlsx"][1][1] = cert[0];
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  const needs = out.school.courses.find((c) => c.id === code).needs;
  const t = out.school.teachers.find((x) => x.email === email);
  assert.deepEqual(t.certificates, [needs, "First Aid"]);
  assert.equal(t.returningCourse, code);
});

test("a choice of the wrong type of course is refused: Round 1 and 2 list International courses, Singapore lists Singapore", async () => {
  const name = (rows, type) => rows["courses.xlsx"].slice(1).find((r) => r[2] === type)[1];
  for (const [file, type] of [["round1.xlsx", "Singapore"], ["round2.xlsx", "Singapore"], ["singapore.xlsx", "International"]]) {
    const out = await run((rows) => { rows[file][1][CHOICE(1)] = name(rows, type); });
    assert.equal(out.school, null, file);
    assert.equal(out.slots[file], `${file}, row 2: Choice 1 is not ${type === "Singapore" ? "an International" : "a Singapore"} course`);
  }
});

test("seats not a positive whole number is refused", async () => {
  for (const bad of [0, -1, 2.5, "three", null]) {
    const out = await run((rows) => (rows["courses.xlsx"][5][3] = bad));
    assert.equal(out.school, null, String(bad));
    assert.equal(out.slots["courses.xlsx"], "courses.xlsx, row 6: seats must be a positive whole number");
  }
});

test("a returning sponsor on a not-offered course is treated like anyone else", async () => {
  const base = await readSchool();
  const closed = new Set(base.courses.filter((c) => !c.running).map((c) => c.id));
  const rows = await load();
  const row = rows["returning.xlsx"].slice(1).find((r) => closed.has(r[1]));
  assert.ok(row, "fixture has a returning sponsor on a not-offered course");
  const t = base.teachers.find((x) => x.email === row[0]);
  assert.equal(t.returning, false);
  assert.equal(t.returningCourse, null);
  assert.equal(t.submitted, true);
  const offeredRows = rows["returning.xlsx"].slice(1).filter((r) => !closed.has(r[1])).length;
  assert.equal(base.teachers.filter((x) => x.returning).length, offeredRows);
});

test("blank choices are skipped and ranks keep their column number", async () => {
  const out = await run((rows) => {
    rows["round2.xlsx"][1][CHOICE(1)] = "";
    rows["round2.xlsx"][1][CHOICE(2)] = null;
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  const rows = await load();
  const t = out.school.teachers.find((x) => x.email === rows["round2.xlsx"][1][EMAIL]);
  const r2 = t.prefs.filter((p) => p.round === "Round 2");
  assert.deepEqual(r2.map((p) => p.rank), [3]);
  const course = out.school.courses.find((c) => c.name === rows["round2.xlsx"][1][CHOICE(3)]);
  assert.equal(r2[0].course, course.id);
});

test("no name or email reaches a problem line beyond the bad value's file and row", async () => {
  const staff = (await load())["staff.xlsx"].slice(1);
  const out = await run((rows) => {
    rows["staff.xlsx"][4][0] = "x.y@elsewhere.example";
    rows["round1.xlsx"][3][EMAIL] = "nobody.here@fernhollow.example";
    rows["returning.xlsx"][2][1] = "ZZ-99";
    rows["singapore.xlsx"][2][CHOICE(3)] = "Underwater Basket Weaving";
  });
  for (const line of Object.values(out.slots)) {
    for (const s of staff) {
      assert.ok(!line.includes(s[0]) && !line.includes(s[1]), line);
    }
    for (const bad of ["elsewhere", "nobody.here", "ZZ-99", "Underwater"]) assert.ok(!line.includes(bad), line);
  }
});

test("a header problem names the column and what it should be, and the sheet when only the first of several is read", async () => {
  // A trailing space looks right in Excel; the line names the column to retype.
  let out = await run((rows) => (rows["staff.xlsx"][0][1] = "Name "));
  assert.equal(out.slots["staff.xlsx"], 'staff.xlsx, row 1: column B should be "Name"; headers must be exactly: Email, Name, Certificates');
  // A cover sheet in front of the data, as a Numbers export summary is: the line says the first sheet was read, and
  // never the sheet's own name, which is typed text and could be a person's name or a forbidden word.
  const rows = await load();
  const [, name] = rows["staff.xlsx"][1];
  for (const cover of ["Instructions", name, "Kept"]) {
    const files = await Promise.all(SLOTS.map(async (file) => ({ name: file, bytes: await writeBook(file === "staff.xlsx"
      ? [{ name: cover, rows: [["Fill in one row per teacher."]] }, { name: SHEET, rows: rows[file] }]
      : [{ name: SHEET, rows: rows[file] }]) })));
    out = await parseFiles(files);
    assert.equal(out.school, null);
    assert.equal(out.slots["staff.xlsx"], 'staff.xlsx, row 1 of the first sheet: column A should be "Email"; headers must be exactly: Email, Name, Certificates', cover);
  }
});

test("a header problem never shows what the cell holds, so a data row read as headers puts no name on screen", async () => {
  const out = await run((rows) => rows["staff.xlsx"].shift());
  const [email, name] = (await load())["staff.xlsx"][1];
  assert.equal(out.slots["staff.xlsx"], 'staff.xlsx, row 1: column A should be "Email"; headers must be exactly: Email, Name, Certificates');
  assert.ok(!out.slots["staff.xlsx"].includes(email) && !out.slots["staff.xlsx"].includes(name));
});

test("certificates may be separated by ;, a line break or a comma", async () => {
  for (const cell of ["Scuba certificate;First aid", "Scuba certificate, First aid", "First aid\nScuba certificate", "first aid ,  SCUBA certificate\r\n"]) {
    const out = await run((rows) => (rows["staff.xlsx"][1][2] = cell));
    const email = (await load())["staff.xlsx"][1][0].toLowerCase();
    const t = out.school.teachers.find((x) => x.email === email);
    // A certificate no course asks for keeps the spelling it was typed in; the course list's one takes the course's spelling.
    assert.deepEqual(t.certificates.map((c) => c.toLowerCase()).sort(), ["first aid", "scuba certificate"], JSON.stringify(cell));
    assert.ok(t.certificates.includes("Scuba certificate"), JSON.stringify(cell));
  }
});

test("a certificate the course list names with a comma in it stays whole", async () => {
  const out = await run((rows) => {
    for (const r of rows["courses.xlsx"].slice(1)) if (r[5]) r[5] = "Scuba, open water";
    for (const r of rows["staff.xlsx"].slice(1)) if (r[2]) r[2] = String(r[2]).replace("Scuba certificate", "Scuba, open water");
    rows["staff.xlsx"][1][2] = "Scuba, open water, First aid";
  });
  assert.ok(out.school, JSON.stringify(out.slots));
  const email = (await load())["staff.xlsx"][1][0].toLowerCase();
  assert.deepEqual([...out.school.teachers.find((x) => x.email === email).certificates].sort(), ["First aid", "Scuba, open water"]);
  // Anyone who held the course's certificate still holds it under the course list's spelling.
  assert.ok(out.school.teachers.some((t) => t.email !== email && t.certificates.includes("Scuba, open water")));
});
