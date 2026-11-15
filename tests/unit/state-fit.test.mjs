import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readSchool } from "./school-fixture.mjs";
import { readFitSchool } from "./fit-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";

let school, plain, draft, plainDraft;
before(async () => {
  const highs = await loadHighs({});
  school = await readFitSchool();
  draft = toDraft(school, solveDraft(highs, school).pairs);
  plain = await readSchool();
  plainDraft = toDraft(plain, solveDraft(highs, plain).pairs);
});

const fresh = (sch = school, d = draft) => { Mock.init(sch); Mock.build(d); };
const find = (pred) => { const t = school.teachers.find(pred); assert.ok(t, "fixture teacher"); return t; };
// The teacher the office marked with a Limitation, on the course the Limitation is for.
const limited = () => find((t) => t.fit.some((r) => r.kind === "Limitation"));
const general = () => find((t) => t.fit.some((r) => r.course === null));
const noRows = () => find((t) => !t.fit.length);
const runningCourse = (cid) => school.courses.find((c) => c.id === cid && c.running);
const notTheirs = (t) => school.courses.find((c) => c.running && !t.fit.some((r) => r.course === c.id)).id;

// A copy of the invented school with extra invented rows on one teacher, for the cases the fixture does not hold.
function withRows(rows) {
  const sch = structuredClone(school);
  const t = sch.teachers.find((x) => x.fit.length === 1 && runningCourse(x.fit[0].course));
  t.fit.push(...rows.map((r) => ({ course: t.fit[0].course, quote: "", ...r })));
  return { sch, t };
}

test("without fit.xlsx there is no fit line and no search text", () => {
  fresh(plain, plainDraft);
  assert.equal(Mock.fit(), false);
  for (const on of [false, true]) {
    Mock.setNames(on);
    for (const t of plain.teachers) {
      assert.equal(Mock.fitLine(t.id), "");
      assert.equal(Mock.fitSearch(t.id), "");
    }
  }
});

test("with fit.xlsx, fit() is true and a teacher with no rows has no line", () => {
  fresh();
  assert.equal(Mock.fit(), true);
  const t = noRows();
  for (const on of [false, true]) { Mock.setNames(on); assert.equal(Mock.fitLine(t.id), ""); }
});

test("names on: the Facts for the course they are on, a Limitation marked, then how many more", () => {
  fresh();
  const t = limited();
  const row = t.fit.find((r) => r.kind === "Limitation");
  Mock.move(t.id, row.course);
  Mock.setNames(true);
  assert.equal(Mock.fitLine(t.id), `From their form: Limitation: ${row.fact}, ${t.fit.length - 1} more in the download`);
});

test("names on: no 'more' when every row is on the course they are on", () => {
  fresh();
  const t = find((x) => x.fit.length === 1 && x.fit[0].course && runningCourse(x.fit[0].course));
  Mock.move(t.id, t.fit[0].course);
  Mock.setNames(true);
  assert.equal(Mock.fitLine(t.id), `From their form: ${t.fit[0].fact}`);
});

test("names on: at most two Facts, the rest counted, in file order", () => {
  const { sch, t } = withRows([{ kind: "Skill", fact: "Invented skill one" }, { kind: "Language", fact: "Invented language two" }]);
  fresh(sch);
  Mock.move(t.id, t.fit[0].course);
  Mock.setNames(true);
  assert.equal(Mock.fitLine(t.id), `From their form: ${t.fit[0].fact}, Invented skill one, 1 more in the download`);
});

test("names off: the distinct Kinds for that course, and 'more' only for rows elsewhere", () => {
  const { sch, t } = withRows([{ kind: "Experience", fact: "Invented experience" }, { kind: "Skill", fact: "Invented skill" }]);
  fresh(sch);
  Mock.move(t.id, t.fit[0].course);
  Mock.setNames(false);
  assert.equal(Mock.fitLine(t.id), `From their form: ${t.fit[0].kind === "Skill" ? "Skill" : `${t.fit[0].kind}, Skill`}`);
  fresh();
  const l = limited();
  const row = l.fit.find((r) => r.kind === "Limitation");
  Mock.move(l.id, row.course);
  Mock.setNames(false);
  assert.equal(Mock.fitLine(l.id), `From their form: Limitation, ${l.fit.length - 1} more in the download`);
  assert.ok(!Mock.fitLine(l.id).includes(row.fact));
});

test("no rows on the course they are on: only the count, either way", () => {
  fresh();
  const t = general();
  Mock.move(t.id, notTheirs(t));
  for (const on of [false, true]) { Mock.setNames(on); assert.equal(Mock.fitLine(t.id), `From their form: ${t.fit.length} in the download`); }
  Mock.move(t.id, null);
  for (const on of [false, true]) { Mock.setNames(on); assert.equal(Mock.fitLine(t.id), `From their form: ${t.fit.length} in the download`); }
});

test("fitSearch is the Fact labels with names on, empty with names off", () => {
  fresh();
  const t = general();
  Mock.setNames(true);
  assert.equal(Mock.fitSearch(t.id), t.fit.map((r) => r.fact).join(" "));
  assert.equal(Mock.fitSearch(noRows().id), "");
  Mock.setNames(false);
  for (const x of school.teachers) assert.equal(Mock.fitSearch(x.id), "");
});

test("names off: no Fact or Quote in any fit line", () => {
  fresh();
  Mock.setNames(false);
  const texts = school.teachers.flatMap((t) => t.fit.flatMap((r) => [r.fact, r.quote])).filter(Boolean);
  for (const t of school.teachers) {
    for (const cid of [null, ...new Set(t.fit.map((r) => r.course).filter((c) => c && runningCourse(c)))]) {
      Mock.move(t.id, cid);
      const line = Mock.fitLine(t.id);
      for (const s of texts) assert.ok(!line.includes(s), `${line} holds ${s}`);
    }
  }
});
