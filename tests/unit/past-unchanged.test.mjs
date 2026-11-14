// Last year's files add a line, a column and a sheet. They must not change what is flagged about a teacher,
// or the order of the rows on the Teachers sheet.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readPastSchool } from "./past-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";
import { sheetsFor } from "../../src/export.js";

let withPast, without, draft;
before(async () => {
  const read = await readPastSchool();
  // As the page holds it: teachers in T-number order.
  withPast = { ...read, teachers: [...read.teachers].sort((a, b) => a.id.localeCompare(b.id)) };
  // The same School with last year taken out again: no past key, and no lastYear key on anyone.
  const { past: _, ...rest } = withPast;
  without = { ...rest, teachers: withPast.teachers.map(({ lastYear: __, ...t }) => t) };
  draft = toDraft(withPast, solveDraft(await loadHighs({}), withPast).pairs);
});

// What is flagged about every teacher, and the Teachers sheet with its Last year column taken out, on both switches.
function seen(school, edits) {
  Mock.init(school);
  Mock.build(draft);
  edits();
  const out = { flags: Object.fromEntries(school.teachers.map((t) => [t.id, Mock.teacherFlags(t.id)])) };
  for (const on of [false, true]) {
    Mock.setNames(on);
    const [head, ...rows] = sheetsFor(Mock).find((s) => s.name === "Teachers").rows;
    const at = head.indexOf("Last year");
    const drop = (r) => (at < 0 ? r : r.filter((_, i) => i !== at));
    out[on ? "namesOn" : "namesOff"] = { head: drop(head), order: rows.map((r) => r[0]), rows: rows.map(drop) };
  }
  return out;
}

// The draft as built, then after edits that touch every group the names-on order has: not placed, flagged, and the rest.
const EDITS = {
  "as built": () => {},
  "after moves": () => {
    const placed = withPast.teachers.filter((t) => draft[t.id]);
    const open = withPast.courses.filter((c) => c.running);
    Mock.move(placed[0].id, null);
    Mock.move(placed[1].id, open.find((c) => c.id !== draft[placed[1].id]).id);
    Mock.move(placed[2].id, open.findLast((c) => c.id !== draft[placed[2].id]).id);
    Mock.leave([withPast.teachers.find((t) => !draft[t.id]).id]);
  },
};

test("the School without last year really is without it", () => {
  assert.ok(withPast.past);
  assert.ok(withPast.teachers.some((t) => t.lastYear));
  assert.equal("past" in without, false);
  assert.ok(without.teachers.every((t) => !("lastYear" in t)));
  assert.deepEqual(without.teachers.map((t) => t.id), withPast.teachers.map((t) => t.id));
});

for (const [name, edits] of Object.entries(EDITS)) {
  test(`teacherFlags for every teacher are the same with and without last year, ${name}`, () => {
    const a = seen(withPast, edits), b = seen(without, edits);
    assert.equal(Object.keys(a.flags).length, 96);
    assert.ok(Object.values(a.flags).some((f) => f.length), "some teacher is flagged");
    assert.deepEqual(a.flags, b.flags);
  });

  test(`the Teachers sheet has the same rows in the same order with and without last year, ${name}`, () => {
    const a = seen(withPast, edits), b = seen(without, edits);
    for (const on of ["namesOff", "namesOn"]) {
      assert.equal(a[on].order.length, 96, on);
      assert.equal(new Set(a[on].order).size, 96, on);
      assert.deepEqual(a[on].order, b[on].order, on);
      // And nothing else on the sheet moves either: only the Last year column is new.
      assert.deepEqual(a[on].head, b[on].head, on);
      assert.deepEqual(a[on].rows, b[on].rows, on);
    }
    assert.notDeepEqual(a.namesOn.order, a.namesOff.order);
  });
}
