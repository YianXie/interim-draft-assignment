import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { readSchool } from "./school-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";
import { readBook, writeBook } from "../../src/xlsx.js";
import { sheetsFor, fileName, cleanCell } from "../../src/export.js";
import { forbiddenIn } from "../e2e/words.mjs";

let school, draft;
before(async () => {
  school = await readSchool();
  draft = toDraft(school, solveDraft(await loadHighs({}), school).pairs);
});
beforeEach(() => { Mock.init(school); Mock.build(draft); });

const sheet = (name) => sheetsFor(Mock).find((s) => s.name === name);
const names = () => sheetsFor(Mock).map((s) => s.name);
const body = (name) => sheet(name).rows.slice(1);
const byLabel = (id) => Mock.label(id);
const firstPlaced = () => school.teachers.find((t) => draft[t.id]);

test("sheets are Courses, Teachers, Changes when names are on", () => {
  Mock.setNames(true);
  assert.deepEqual(names(), ["Courses", "Teachers", "Changes"]);
  assert.deepEqual(sheet("Teachers").rows[0], ["Teacher", "Email", "Course", "Choice", "Why", "Status"]);
  assert.equal(body("Teachers").length, school.teachers.length);
});

test("names off adds a Note sheet and removes the Email column", () => {
  assert.deepEqual(names(), ["Courses", "Teachers", "Changes", "Note"]);
  assert.deepEqual(sheet("Teachers").rows[0], ["Teacher", "Course", "Choice", "Why", "Status"]);
  assert.ok(body("Teachers").every((r) => r.length === 5 && /^T\d+$/.test(r[0])));
});

test("Note says T numbers are pseudonymous, not anonymous", () => {
  const text = sheet("Note").rows.flat().join(" ");
  assert.match(text, /pseudonymous, not anonymous/);
});

test("Courses has every course in code order with Sponsor 1..n and Status", () => {
  Mock.setNames(true);
  const n = Math.max(...school.courses.map((c) => c.seats));
  const rows = sheet("Courses").rows;
  assert.deepEqual(rows[0], ["Course Code", "Course Name", ...Array.from({ length: n }, (_, i) => `Sponsor ${i + 1}`), "Status"]);
  const codes = school.courses.map((c) => c.id).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(rows.slice(1).map((r) => r[0]), codes);
  for (const r of rows.slice(1)) {
    const c = Mock.course(r[0]);
    assert.equal(r.length, n + 3);
    assert.equal(r[1], c.name);
    const sp = Mock.sponsors(c.id).map(byLabel);
    assert.deepEqual(r.slice(2, 2 + n), Array.from({ length: n }, (_, i) => sp[i] ?? ""));
    assert.equal(r[n + 2].toLowerCase(), Mock.status(c.id));
  }
  assert.ok(rows.some((r) => r[n + 2] === "Not running"));
  Mock.setNames(false);
  assert.ok(sheet("Courses").rows.slice(1).flatMap((r) => r.slice(2, -1)).every((v) => v === "" || /^T\d+$/.test(v)));
});

test("Teachers: not placed first, then flagged, then by label", () => {
  const out = school.teachers.filter((t) => !draft[t.id]);
  Mock.move(firstPlaced().id, null);
  Mock.setNames(true);
  const rows = body("Teachers");
  const status = (r) => r[5];
  const rank = (r) => { const t = school.teachers.find((x) => x.email === r[1]); return !Mock.placedOn(t.id) ? 0 : Mock.teacherFlags(t.id).length ? 1 : 2; };
  const ranks = rows.map(rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(ranks.includes(0) && ranks.includes(1) && ranks.includes(2));
  assert.equal(rows.filter((r) => status(r) === "Not placed").length, out.length + 1);
  for (let i = 1; i < rows.length; i++) if (ranks[i] === ranks[i - 1]) assert.ok(rows[i - 1][0].localeCompare(rows[i][0]) <= 0);
});

test("Teachers cells: choice, why and status say what the screen says", () => {
  Mock.setNames(true);
  const rows = body("Teachers");
  for (const t of school.teachers) {
    const r = rows.find((x) => x[1] === t.email);
    const c = Mock.placedOn(t.id);
    assert.equal(r[0], t.name);
    assert.equal(r[2], c ? Mock.course(c).name : "");
    assert.equal(r[4], Mock.reason(t.id));
    if (!c) assert.equal(r[5], "Not placed");
    else if (t.returning && t.returningCourse === c) assert.equal(r[3], "Returning sponsor");
    else if (!t.submitted) { assert.equal(r[3], "No form received"); assert.equal(r[5], "Check with them"); }
    else assert.equal(r[3], Mock.choiceText(t.id, c));
  }
  const some = school.teachers.find((t) => draft[t.id] && t.submitted);
  Mock.move(some.id, null);
  Mock.move(some.id, draft[some.id]);
  assert.equal(body("Teachers").find((x) => x[1] === some.email)[5], "Moved by the office");
});

test("Teachers with names off are ordered by T number", () => {
  Mock.move(firstPlaced().id, null);
  const ids = body("Teachers").map((r) => r[0]);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
  assert.equal(ids.length, school.teachers.length);
});

test("Changes has one dated row per edit", () => {
  assert.deepEqual(sheet("Changes").rows.length, 1);
  const [a, b] = school.teachers.filter((t) => draft[t.id]);
  Mock.move(a.id, null);
  Mock.move(b.id, null);
  Mock.undo();
  Mock.restore(1);
  const rows = body("Changes");
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => /^\d{4}-\d\d-\d\d$/.test(r[0]) && /^\d\d:\d\d/.test(r[1])));
  assert.deepEqual(rows.map((r) => r[2]), Mock.history().filter((h) => h.event.type !== "build").reverse().map(Mock.describe));
  assert.match(rows[0][2], new RegExp(`Moved ${a.id} to not placed`));
  assert.ok(!rows.flat().join("\n").includes(a.name));
  Mock.setNames(true);
  assert.match(body("Changes")[0][2], new RegExp(`Moved ${a.name} to not placed`));
});

test("file names say invented and follow the switch", () => {
  assert.equal(fileName(Mock), "Fernhollow invented draft v1 T numbers.xlsx");
  Mock.setNames(true);
  Mock.move(firstPlaced().id, null);
  assert.equal(fileName(Mock), "Fernhollow invented draft v2 with names.xlsx");
});

test("awkward values stay text", async () => {
  const awkward = ["=SUM(1)", "+44", "-3", "@x", "00123", "1E5", "TRUE", "false", "0x1F", "2028-01-02", "O'Neil <b>", "a\u0000b\u0008c\u000Bd\u001Fe\uFFFEf", "tab\tnew\nline", "\uD800lone"];
  assert.deepEqual(awkward.map(cleanCell).slice(11, 13), ["abcdef", "tab\tnew\nline"]);
  assert.ok(awkward.map(cleanCell).every((v) => typeof v === "string"));
  assert.equal(cleanCell(null), "");
  assert.equal(cleanCell(7), "7");
  const bytes = await writeBook([{ name: "X", rows: [awkward.map(cleanCell)] }]);
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  const cells = [...xml.matchAll(/<c [^>]*>/g)].map((m) => m[0]);
  assert.equal(cells.length, awkward.length);
  assert.ok(cells.every((c) => / t="s"/.test(c)), cells.join("\n"));
  assert.ok(!xml.includes("<f>") && !xml.includes("<f "));
  const [read] = await readBook(bytes);
  assert.deepEqual(read.rows[0], awkward.map(cleanCell));
});

test("every sheet of a real export is all string cells and no formulas", async () => {
  Mock.setNames(true);
  const zip = unzipSync(await writeBook(sheetsFor(Mock)));
  for (const [path, data] of Object.entries(zip)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(data);
    for (const m of xml.matchAll(/<c [^>]*>/g)) assert.match(m[0], / t="s"/, `${path} ${m[0]}`);
    assert.ok(!/<f[ >]/.test(xml));
  }
});

test("no invented name or email in any part of a names-off workbook, after names on, move, names off", async () => {
  Mock.setNames(true);
  await writeBook(sheetsFor(Mock));
  Mock.move(firstPlaced().id, null);
  Mock.setNames(false);
  const zip = unzipSync(await writeBook(sheetsFor(Mock)));
  assert.ok(Object.keys(zip).length > 5);
  for (const [path, data] of Object.entries(zip)) {
    const text = strFromU8(data);
    for (const t of school.teachers) {
      assert.ok(!text.includes(t.name), `${path} holds a name`);
      assert.ok(!text.includes(t.email), `${path} holds an email`);
    }
  }
});

test("forbidden words are in no workbook string", () => {
  for (const on of [false, true]) {
    Mock.setNames(on);
    const strings = sheetsFor(Mock).flatMap((s) => [s.name, ...s.rows.flat()]).map(String);
    assert.deepEqual(forbiddenIn(strings), []);
  }
});
