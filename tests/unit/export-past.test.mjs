import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { readPastSchool } from "./past-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";
import { RESULT_LABEL } from "../../src/past.js";
import { writeBook } from "../../src/xlsx.js";
import { sheetsFor } from "../../src/export.js";
import { forbiddenIn } from "../e2e/words.mjs";

let school, draft;
before(async () => {
  school = await readPastSchool();
  draft = toDraft(school, solveDraft(await loadHighs({}), school).pairs);
});
beforeEach(() => { Mock.init(school); Mock.build(draft); });

const sheet = (name) => sheetsFor(Mock).find((s) => s.name === name);
const names = () => sheetsFor(Mock).map((s) => s.name);
const body = (name) => sheet(name).rows.slice(1);
const firstPlaced = () => school.teachers.find((t) => draft[t.id]);

const HEAD = ["Last year", "Top 4", "5 to 7", "Not on their list", "Returning sponsor", "No form", "Not placed"];
const ROWS = ["Top 4", "5 to 7", "None", "Not found", "No form", "No record"];
const UNMATCHED = "Not matched on last year's allocation";
const NOT_FOUND = "Sent a form last year, not on the allocation";
const table = () => sheet("Last year").rows.slice(1, 7);
const cell = (row, col) => Number(table()[ROWS.indexOf(row)][HEAD.indexOf(col)]);

// The same table worked out from a plain copy of the placements and the School alone.
const ROUNDS = ["Round 1", "Round 2", "Singapore"];
function thisYear(t, cid) {
  if (!cid) return "Not placed";
  if (t.returning && t.returningCourse === cid) return "Returning sponsor";
  if (!t.submitted) return "No form";
  const shown = t.prefs.filter((p) => p.course === cid).sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round))[0];
  if (!shown) return "Not on their list";
  return shown.rank <= 4 ? "Top 4" : "5 to 7";
}
const lastYear = (t) => (t.lastYear ? RESULT_LABEL[t.lastYear.result] : "No record");
const expectedTable = (placed) => ROWS.map((row) => [row, ...HEAD.slice(1).map((col) =>
  String(school.teachers.filter((t) => lastYear(t) === row && thisYear(t, placed[t.id]) === col).length))]);

test("with past files the sheets are Courses, Teachers, Changes, Last year (and Note with names off)", () => {
  assert.deepEqual(names(), ["Courses", "Teachers", "Changes", "Last year", "Note"]);
  Mock.setNames(true);
  assert.deepEqual(names(), ["Courses", "Teachers", "Changes", "Last year"]);
});

test("Teachers has Last year after Choice, with the label or blank", () => {
  const labels = new Set(["", ...Object.values(RESULT_LABEL)]);
  assert.deepEqual(sheet("Teachers").rows[0], ["Teacher", "Course", "Choice", "Last year", "Why", "Status"]);
  const off = body("Teachers");
  assert.equal(off.length, school.teachers.length);
  for (const t of school.teachers) {
    const r = off.find((x) => x[0] === t.id);
    assert.equal(r.length, 6);
    assert.equal(r[3], t.lastYear ? RESULT_LABEL[t.lastYear.result] : "");
    assert.ok(labels.has(r[3]));
    assert.equal(r[4], Mock.reason(t.id));
  }
  Mock.setNames(true);
  assert.deepEqual(sheet("Teachers").rows[0], ["Teacher", "Email", "Course", "Choice", "Last year", "Why", "Status"]);
  const on = body("Teachers");
  for (const t of school.teachers) {
    const r = on.find((x) => x[1] === t.email);
    assert.equal(r.length, 7);
    assert.equal(r[4], t.lastYear ? RESULT_LABEL[t.lastYear.result] : "");
    assert.equal(r[5], Mock.reason(t.id));
  }
  const count = (label) => on.filter((r) => r[4] === label).length;
  assert.deepEqual(["Top 4", "5 to 7", "None", "Not found", "No form", ""].map(count), [52, 7, 11, 1, 17, 8]);
});

test("the Last year table counts every teacher exactly once", () => {
  for (const on of [false, true]) {
    Mock.setNames(on);
    const rows = sheet("Last year").rows;
    assert.deepEqual(rows[0], HEAD);
    assert.deepEqual(table().map((r) => r[0]), ROWS);
    const counts = table().map((r) => r.slice(1));
    assert.ok(counts.every((r) => r.length === 6 && r.every((v) => /^\d+$/.test(v))), JSON.stringify(counts));
    const sum = (xs) => xs.reduce((a, v) => a + Number(v), 0);
    assert.equal(sum(counts.flat()), school.teachers.length);
    assert.deepEqual(counts.map(sum), [52, 7, 11, 1, 17, 8]);
    assert.deepEqual(table(), expectedTable(draft));
  }
});

test("the table follows a move and Undo", () => {
  const start = table();
  const owed = school.teachers.find((t) => t.lastYear && t.lastYear.result === "none" && thisYear(t, draft[t.id]) === "Top 4");
  assert.ok(owed);
  const top4 = cell("None", "Top 4");
  const out = cell("None", "Not placed");
  Mock.move(owed.id, null);
  assert.equal(cell("None", "Top 4"), top4 - 1);
  assert.equal(cell("None", "Not placed"), out + 1);
  assert.deepEqual(table(), expectedTable({ ...draft, [owed.id]: null }));
  Mock.undo();
  assert.deepEqual(table(), start);
  assert.deepEqual(table(), expectedTable(draft));
});

test("names on: the two lists are written; names off: neither, and no unmatched entry anywhere in the workbook", async () => {
  const notFound = school.teachers.filter((t) => t.lastYear && t.lastYear.result === "notFound");
  assert.deepEqual(school.past.unmatched, ["Sponsor who left"]);
  assert.equal(notFound.length, 1);
  Mock.setNames(true);
  assert.deepEqual(sheet("Last year").rows.slice(7), [[], [UNMATCHED], ["Sponsor who left"], [], [NOT_FOUND], [notFound[0].name]]);
  await writeBook(sheetsFor(Mock));

  Mock.setNames(false);
  const sheets = sheetsFor(Mock);
  assert.equal(sheet("Last year").rows.length, 7);
  const strings = sheets.flatMap((s) => [s.name, ...s.rows.flat()]);
  for (const text of [UNMATCHED, NOT_FOUND, ...school.past.unmatched]) assert.ok(!strings.includes(text), text);
  const zip = unzipSync(await writeBook(sheets));
  assert.ok(Object.keys(zip).length > 5);
  for (const [path, data] of Object.entries(zip)) {
    const text = strFromU8(data);
    for (const entry of school.past.unmatched) assert.ok(!text.includes(entry), `${path} holds an unmatched entry`);
  }
});

test("no invented name or email in any part of a names-off workbook with past files", async () => {
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

test("forbidden words are in no workbook string with past files", () => {
  for (const on of [false, true]) {
    Mock.setNames(on);
    const strings = sheetsFor(Mock).flatMap((s) => [s.name, ...s.rows.flat()]).map(String);
    assert.ok(strings.includes("Last year"));
    assert.deepEqual(forbiddenIn(strings), []);
  }
});

test("every cell is a string cell and there are no formulas", async () => {
  for (const on of [false, true]) {
    Mock.setNames(on);
    const sheets = sheetsFor(Mock);
    assert.ok(sheets.every((s) => s.rows.every((r) => r.every((v) => typeof v === "string"))));
    const zip = unzipSync(await writeBook(sheets));
    const parts = Object.keys(zip).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
    assert.equal(parts.length, sheets.length);
    for (const path of parts) {
      const xml = strFromU8(zip[path]);
      assert.ok(xml.includes("<c "), path);
      for (const m of xml.matchAll(/<c [^>]*>/g)) assert.match(m[0], / t="s"/, `${path} ${m[0]}`);
      assert.ok(!/<f[ >]/.test(xml));
    }
  }
});

// A copy of the fixture School, as the page holds it (teachers in T-number order), with its lastYear and past edited.
const copyOf = (from, edit) => {
  const copy = structuredClone(from);
  edit(copy);
  copy.teachers.sort((a, b) => a.id.localeCompare(b.id));
  return copy;
};
const lists = () => sheet("Last year").rows.slice(7);

test("an empty list writes no heading", () => {
  const notFound = school.teachers.find((t) => t.lastYear && t.lastYear.result === "notFound");
  const use = (edit) => { Mock.init(copyOf(school, edit)); Mock.build(draft); Mock.setNames(true); };
  // Nothing unmatched: only the second list, with no blank row before a missing first one.
  use((s) => { s.past.unmatched = []; });
  assert.deepEqual(lists(), [[], [NOT_FOUND], [notFound.name]]);
  // Nobody Not found: only the first list, and no blank row left at the end.
  use((s) => { s.teachers.find((t) => t.id === notFound.id).lastYear = null; });
  assert.deepEqual(lists(), [[], [UNMATCHED], ["Sponsor who left"]]);
  // Neither: the sheet ends with the table, as it does with names off.
  use((s) => { s.past.unmatched = []; s.teachers.find((t) => t.id === notFound.id).lastYear = null; });
  assert.deepEqual(lists(), []);
  assert.equal(sheet("Last year").rows.length, 7);
});

test("the not-on-the-allocation list is the same under two T-number draws", async () => {
  const seeded = (seed) => { let s = seed; return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; }; };
  // Five teachers picked by email, so the same people under any draw. Two of them are given one name.
  const emails = school.teachers.map((t) => t.email).sort().filter((_, i) => i % 19 === 3);
  assert.equal(emails.length, 5);
  const shared = school.teachers.find((t) => t.email === emails[4]).name;
  const drawn = async (seed) => copyOf(await readPastSchool(seeded(seed)), (s) => {
    for (const t of s.teachers) {
      if (t.lastYear && t.lastYear.result === "notFound") t.lastYear = null;
      if (emails.includes(t.email)) t.lastYear = { result: "notFound", rank: null, round: null };
      if (t.email === emails[0]) t.name = shared;
    }
  });
  const listed = (s) => {
    Mock.init(s);
    Mock.build({});
    Mock.setNames(true);
    const rows = lists();
    return rows.slice(rows.findIndex((r) => r[0] === NOT_FOUND) + 1).map((r) => r[0]);
  };
  const a = await drawn(1), b = await drawn(2);
  const inTOrder = (s) => s.teachers.filter((t) => emails.includes(t.email)).map((t) => t.email);
  assert.notDeepEqual(inTOrder(a), inTOrder(b), "the two draws put these five in different T-number orders");
  // By name, then email: the two who share a name come in email order.
  const want = a.teachers.filter((t) => emails.includes(t.email))
    .sort((x, y) => x.name.localeCompare(y.name) || x.email.localeCompare(y.email)).map((t) => t.name);
  assert.equal(want.length, 5);
  assert.equal(want.filter((name) => name === shared).length, 2);
  assert.deepEqual(listed(a), want);
  assert.deepEqual(listed(b), want);
  // Under one draw, the pair that shares a name is in email order whatever their T numbers say.
  const pair = (s) => s.teachers.filter((t) => t.name === shared && emails.includes(t.email));
  const flipped = structuredClone(a);
  const [p, q] = pair(flipped);
  [p.id, q.id] = [q.id, p.id];
  flipped.teachers.sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(listed(flipped), want);
});
