import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readSchool } from "./school-fixture.mjs";
import { loadHighs, solveDraft, toDraft } from "../../src/solver.js";
import { Mock } from "../../src/state.js";

let school, draft;
before(async () => {
  school = await readSchool();
  draft = toDraft(school, solveDraft(await loadHighs({}), school).pairs);
});

const lcg = (seed) => {
  let s = seed;
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
};
const fresh = () => { Mock.init(school); Mock.build(draft); };
const running = () => school.courses.filter((c) => c.running);
const seatsTaken = (cid, placed) => Object.values(placed).filter((c) => c === cid).length;

// What the To do should hold, worked out from the draft and the School alone.
function expectedTodo(placed, left = new Set()) {
  const courses = running().filter((c) => seatsTaken(c.id, placed) < c.seats).map((c) => c.id);
  const unplaced = school.teachers.filter((t) => !placed[t.id] && !left.has(t.id));
  return {
    courses,
    teachers: unplaced.filter((t) => t.submitted).map((t) => t.id),
    noForm: unplaced.filter((t) => !t.submitted).map((t) => t.id),
  };
}
const split = (items) => ({
  courses: items.filter((i) => i.kind === "course").map((i) => i.cid),
  teachers: items.filter((i) => i.kind === "teacher").map((i) => i.tid),
  noForm: items.filter((i) => i.kind === "noForm").flatMap((i) => i.tids),
});
const sorted = (a) => [...a].sort();
const same = (got, want) => {
  assert.deepEqual(sorted(got.courses), sorted(want.courses));
  assert.deepEqual(sorted(got.teachers), sorted(want.teachers));
  assert.deepEqual(sorted(got.noForm), sorted(want.noForm));
};

test("todo: short and empty offered courses, unplaced form people, one no-form group", () => {
  fresh();
  const items = Mock.todo();
  same(split(items), expectedTodo(draft));
  assert.equal(items.filter((i) => i.kind === "noForm").length, 1, "one single group item");
  const kinds = items.map((i) => i.kind);
  assert.deepEqual(kinds, [...kinds].sort((a, b) => ["course", "teacher", "noForm"].indexOf(a) - ["course", "teacher", "noForm"].indexOf(b)));
});

test("fixture todo has 3 to 14 items and each kind", () => {
  fresh();
  const items = Mock.todo();
  assert.ok(items.length >= 3 && items.length <= 14, `todo has ${items.length} items`);
  const want = expectedTodo(draft);
  assert.equal(items.length, want.courses.length + want.teachers.length + (want.noForm.length ? 1 : 0));
  for (const kind of ["course", "teacher", "noForm"]) assert.ok(items.some((i) => i.kind === kind), `has a ${kind} item`);
});

test("leave clears a person; leaving the group clears all of them; undo restores", () => {
  fresh();
  const want = expectedTodo(draft);
  const one = want.teachers[0];
  const before = Mock.todo().length;
  Mock.leave([one]);
  assert.equal(Mock.todo().length, before - 1);
  assert.ok(!split(Mock.todo()).teachers.includes(one));
  assert.equal(Mock.placedOn(one), null, "leaving does not place anyone");
  const group = Mock.todo().find((i) => i.kind === "noForm");
  Mock.leave(group.tids);
  assert.ok(!Mock.todo().some((i) => i.kind === "noForm"));
  assert.equal(Mock.todo().length, before - 2);
  Mock.undo();
  assert.ok(Mock.todo().some((i) => i.kind === "noForm"));
  Mock.undo();
  same(split(Mock.todo()), want);
});

test("a left person who is placed is placed; moving to Not placed clears the To do item", () => {
  fresh();
  const one = expectedTodo(draft).teachers[0];
  Mock.leave([one]);
  const open = running().find((c) => Mock.seatsLeft(c.id) > 0);
  Mock.move(one, open.id);
  Mock.move(one, null);
  assert.ok(split(Mock.todo()).teachers.includes(one) === false, "moving to Not placed is the office's decision");
  Mock.move(one, open.id);
  assert.equal(Mock.placedOn(one), open.id);
});

test("move does not mark anyone kept; no kept state exists", () => {
  fresh();
  const t = expectedTodo(draft).teachers[0];
  const c = running().find((x) => Mock.seatsLeft(x.id) > 0);
  Mock.move(t, c.id);
  assert.equal(Mock.state.kept, undefined);
  for (const gone of ["keep", "swap", "kept", "reviewed", "toggleReviewed", "redoPreview", "acceptRedo", "comment", "attention"]) {
    assert.equal(Mock[gone], undefined, `${gone} is deleted`);
  }
  assert.equal(Mock.placedOn(t), c.id);
  assert.ok(!JSON.stringify(Mock.history()).includes("kept"));
});

test("history follows the switch", () => {
  fresh();
  const t = school.teachers.find((x) => !draft[x.id] && x.submitted);
  const c = running().find((x) => Mock.seatsLeft(x.id) > 0);
  Mock.setNames(true);
  Mock.move(t.id, c.id);
  assert.ok(Mock.describe(Mock.history()[0]).includes(t.name));
  Mock.setNames(false);
  const text = Mock.describe(Mock.history()[0]);
  assert.ok(text.includes(t.id));
  for (const x of school.teachers) assert.ok(!text.includes(x.name) && !text.includes(x.email));
});

test("snapshots hold only T numbers and course codes", () => {
  fresh();
  const [a, b] = expectedTodo(draft).teachers;
  const c = running().find((x) => Mock.seatsLeft(x.id) > 0);
  Mock.move(a, c.id);
  Mock.leave([b]);
  Mock.restore(1);
  Mock.undo();
  const tids = new Set(school.teachers.map((t) => t.id));
  const cids = new Set(school.courses.map((x) => x.id));
  const ok = (s) => tids.has(s) || cids.has(s);
  for (const snap of Mock.history()) {
    assert.deepEqual(Object.keys(snap).sort(), ["event", "moved", "left", "placements", "prev", "version", "when"].sort());
    assert.ok(!Number.isNaN(Date.parse(snap.when)));
    for (const [t, cid] of Object.entries(snap.placements)) assert.ok(tids.has(t) && (cid === null || cids.has(cid)));
    for (const [t, from] of snap.moved) assert.ok(tids.has(t) && (from === null || cids.has(from)));
    for (const t of snap.left) assert.ok(tids.has(t));
    const e = snap.event;
    assert.ok(["build", "move", "leave", "restore", "undo"].includes(e.type));
    if (e.type === "move") { assert.ok(tids.has(e.t)); assert.ok(e.to === null || cids.has(e.to)); }
    if (e.type === "leave") e.t.forEach((t) => assert.ok(ok(t)));
    if (e.type === "restore") assert.equal(typeof e.v, "number");
  }
  const raw = JSON.stringify(Mock.history());
  for (const t of school.teachers) assert.ok(!raw.includes(t.name) && !raw.includes(t.email));
  for (const x of school.courses) assert.ok(!raw.includes(x.name));
});

const view = () => JSON.stringify({
  placed: school.teachers.map((t) => Mock.placedOn(t.id)),
  todo: Mock.todo(),
  reasons: school.teachers.map((t) => Mock.reason(t.id)),
});

test("undo returns to the exact previous state, repeatedly, down to Build", () => {
  fresh();
  assert.equal(Mock.canUndo(), false);
  const rand = lcg(7);
  const states = [view()];
  for (let i = 0; i < 6; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    const cs = running();
    const to = rand(4) === 0 ? null : cs[rand(cs.length)].id;
    if (Mock.placedOn(t.id) === to) { i--; continue; }
    Mock.move(t.id, to);
    states.push(view());
  }
  Mock.leave(Mock.todo().filter((i) => i.kind === "noForm").flatMap((i) => i.tids));
  states.push(view());
  assert.ok(Mock.canUndo());
  for (let i = states.length - 2; i >= 0; i--) {
    Mock.undo();
    assert.equal(view(), states[i], `undo back to step ${i}`);
  }
  assert.equal(Mock.canUndo(), false, "nothing left to undo at Build");
  const types = Mock.history().map((h) => h.event.type);
  assert.equal(types.filter((x) => x === "undo").length, states.length - 1);
  assert.equal(Mock.history().at(-1).prev, null);
  assert.equal(Mock.history()[0].version, Mock.history().length);
});

test("undo after restore goes back to what was showing before the restore", () => {
  fresh();
  const [a] = expectedTodo(draft).teachers;
  const open = running().find((c) => Mock.seatsLeft(c.id) > 0);
  Mock.move(a, open.id);
  const showing = view();
  const showingVersion = Mock.history()[0].version;
  Mock.restore(1);
  const r = Mock.history()[0];
  assert.equal(r.event.type, "restore");
  assert.equal(r.event.v, 1);
  assert.equal(r.prev, showingVersion);
  assert.equal(Mock.placedOn(a), draft[a], "restore shows the old placements");
  assert.notEqual(view(), showing);
  Mock.undo();
  assert.equal(view(), showing);
});

test("snapshots survive a reload: init with snapshots restores the newest", () => {
  fresh();
  const t = expectedTodo(draft).teachers[0];
  const open = running().find((c) => Mock.seatsLeft(c.id) > 0);
  Mock.move(t, open.id);
  const saved = JSON.parse(JSON.stringify(Mock.history()));
  const showing = view();
  Mock.init(school, saved);
  assert.equal(view(), showing);
  assert.equal(Mock.history().length, saved.length);
  assert.equal(Mock.history()[0].version, saved[0].version);
  Mock.undo();
  assert.equal(Mock.placedOn(t), draft[t]);
});

test("onSnapshot hears every new snapshot, build included", () => {
  Mock.init(school);
  const heard = [];
  Mock.onSnapshot((s) => heard.push(s.event.type));
  Mock.build(draft);
  const t = expectedTodo(draft).teachers[0];
  Mock.leave([t]);
  Mock.undo();
  assert.deepEqual(heard, ["build", "leave", "undo"]);
  assert.equal(Mock.history()[0].event.type, "undo");
});
