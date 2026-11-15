import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFitSchool, readPastFitSchool } from "./fit-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";
import { sheetsFor } from "../../src/export.js";

let school, draft, pastSchool, pastDraft;
before(async () => {
  const highs = await loadHighs({});
  school = await readFitSchool();
  draft = toDraft(school, solveDraft(highs, school).pairs);
  pastSchool = await readPastFitSchool();
  pastDraft = toDraft(pastSchool, solveDraft(highs, pastSchool).pairs);
});

const fresh = (sch = school, d = draft) => { Mock.init(sch); Mock.build(d); };
const teachers = () => sheetsFor(Mock).find((s) => s.name === "Teachers").rows;
const column = (rows) => rows[0].indexOf("From their form");
const cellFor = (t) => {
  const rows = teachers();
  const row = rows.find((r) => r[0] === Mock.label(t.id));
  return row[column(rows)];
};
// The same School as though fit.xlsx had not been added.
const withoutFit = (sch) => ({ ...sch, fit: undefined, teachers: sch.teachers.map(({ fit, ...t }) => t) });
const KINDS = "Language|Certificate|Experience|Skill|Limitation";
const KIND_CELL = new RegExp(`^((${KINDS}) \\(([A-Z]+-\\d+|general)\\))(; (${KINDS}) \\(([A-Z]+-\\d+|general)\\))*$`);

test("From their form sits after Choice and before Why, with names on and off", () => {
  fresh();
  assert.deepEqual(teachers()[0], ["Teacher", "Course Code", "Course", "Choice", "From their form", "Why", "Status"]);
  Mock.setNames(true);
  assert.deepEqual(teachers()[0], ["Teacher", "Email", "Course Code", "Course", "Choice", "From their form", "Why", "Status"]);
});

test("with last year too, From their form sits after Last year", () => {
  fresh(pastSchool, pastDraft);
  assert.deepEqual(teachers()[0], ["Teacher", "Course Code", "Course", "Choice", "Last year", "From their form", "Why", "Status"]);
  Mock.setNames(true);
  assert.deepEqual(teachers()[0], ["Teacher", "Email", "Course Code", "Course", "Choice", "Last year", "From their form", "Why", "Status"]);
});

test("without fit.xlsx there is no From their form column", () => {
  for (const [sch, d] of [[school, draft], [pastSchool, pastDraft]]) {
    fresh(withoutFit(sch), d);
    for (const on of [false, true]) { Mock.setNames(on); assert.equal(column(teachers()), -1); }
  }
});

test("names on: every row as Fact (CODE): quote, general for no course, file order", () => {
  fresh();
  Mock.setNames(true);
  const want = (t) => t.fit.map((r) => `${r.fact} (${r.course ?? "general"})${r.quote ? `: ${r.quote}` : ""}`).join("; ");
  for (const t of school.teachers) assert.equal(cellFor(t), want(t));
  const g = school.teachers.find((t) => t.fit.some((r) => r.course === null));
  assert.match(cellFor(g), /\(general\): /);
  const blank = school.teachers.find((t) => t.fit.some((r) => !r.quote));
  const r = blank.fit.find((x) => !x.quote);
  assert.ok(cellFor(blank).split("; ").includes(`${r.fact} (${r.course ?? "general"})`));
});

test("names off: Kinds and course codes only", () => {
  fresh();
  for (const t of school.teachers) {
    const cell = cellFor(t);
    assert.equal(cell, t.fit.map((r) => `${r.kind} (${r.course ?? "general"})`).join("; "));
    if (cell) assert.match(cell, KIND_CELL);
  }
});

test("after names on, a move, names off: no Fact or Quote anywhere in the workbook", () => {
  fresh();
  Mock.setNames(true);
  const t = school.teachers.find((x) => x.fit.some((r) => r.kind === "Limitation"));
  Mock.move(t.id, t.fit.find((r) => r.kind === "Limitation").course);
  Mock.setNames(false);
  const sheets = sheetsFor(Mock);
  const cells = sheets.flatMap((s) => s.rows.flat()).map(String);
  // Some Facts are course names, which the workbook shows with or without fit.xlsx; every other Fact, and every Quote, must be absent.
  const courseNames = school.courses.map((c) => c.name);
  const quotes = school.teachers.flatMap((x) => x.fit.map((r) => r.quote)).filter(Boolean);
  const facts = school.teachers.flatMap((x) => x.fit.map((r) => r.fact)).filter((f) => !courseNames.some((n) => n.includes(f)));
  assert.ok(facts.length > 0);
  for (const s of [...quotes, ...facts]) for (const c of cells) assert.ok(!c.includes(s), `${c} holds ${s}`);
  // And apart from the new column the workbook is the one built without fit.xlsx.
  const col = column(sheets.find((s) => s.name === "Teachers").rows);
  const strip = (all) => all.map((s) => (s.name === "Teachers" ? { ...s, rows: s.rows.map((r) => r.filter((_, i) => i !== col)) } : s));
  const withFit = strip(sheets);
  const before = Mock.history();
  Mock.init(withoutFit(school), before);
  assert.deepEqual(withFit, sheetsFor(Mock));
});
