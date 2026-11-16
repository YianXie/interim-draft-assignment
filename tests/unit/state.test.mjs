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

test("optionsFor warns for every rule a move would break", () => {
  fresh();
  const certified = (t, c) => !c.needs || t.certificates.includes(c.needs);
  const full = (cid) => school.teachers.filter((t) => Mock.placedOn(t.id) === cid).length >= Mock.course(cid).seats;
  const seen = new Set();
  for (const t of school.teachers) {
    for (const o of Mock.optionsFor(t.id)) {
      const c = Mock.course(o.cid);
      assert.equal(o.warn.includes("This course is full"), full(o.cid));
      assert.equal(o.warn.includes("They did not rank this"), o.choice === "Not on their list" && t.submitted);
      assert.equal(o.warn.includes(`No ${(c.needs || "").toLowerCase()} on file`), !certified(t, c));
      assert.equal(o.warn.includes("Returning sponsor"), Boolean(t.returning && t.returningCourse && o.cid !== t.returningCourse));
      for (const w of o.warn) seen.add(w.startsWith("No ") ? "No cert" : w);
    }
  }
  for (const w of ["This course is full", "They did not rank this", "No cert", "Returning sponsor"]) assert.ok(seen.has(w), `fixture never shows: ${w}`);
  assert.ok([...seen].includes("No cert"));
  const scuba = school.courses.find((c) => c.needs && c.running);
  const noCert = school.teachers.find((t) => !t.certificates.includes(scuba.needs) && Mock.placedOn(t.id) !== scuba.id);
  assert.ok(Mock.optionsFor(noCert.id).find((o) => o.cid === scuba.id).warn.includes(`No ${scuba.needs.toLowerCase()} on file`));
});

// Add forms: round2.xlsx and singapore.xlsx brought into a built Round 1 draft. Everyone on a course stays.
import { readFile } from "node:fs/promises";
import { parseFiles, readForms, LATER, SLOTS } from "../../src/import.js";

const laterDir = new URL("../../fixtures/school/", import.meta.url);
const laterFile = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, laterDir))) });
async function roundOne() {
  const base = (await parseFiles(await Promise.all(SLOTS.filter((n) => !LATER.includes(n)).map(laterFile)))).school;
  const highs = await loadHighs({});
  const first = solveDraft(highs, base);
  const read = await readForms(base, await Promise.all(LATER.map(laterFile)));
  return { base, highs, firstDraft: toDraft(base, first.pairs), read };
}
const placedPairs = () => Mock.teachers().filter((t) => Mock.placedOn(t.id)).map((t) => [t.id, Mock.placedOn(t.id)]);

test("addForms places the new pairs and nobody else moves", async () => {
  const { base, highs, firstDraft, read } = await roundOne();
  Mock.init(base);
  Mock.build(firstDraft);
  const off = base.teachers.find((t) => Mock.placedOn(t.id));
  Mock.move(off.id, null);
  const before = { ...Mock.state.placements };
  const moved = [...Mock.state.moved];
  const solved = solveDraft(highs, read.school, placedPairs());
  assert.equal(solved.status, "Optimal");
  assert.ok(solved.pairs.length > 0, "the later forms place somebody");
  Mock.addForms(read.school, solved.pairs, read.rounds, read.senders);
  const added = new Map(solved.pairs);
  for (const t of base.teachers) assert.equal(Mock.placedOn(t.id), added.get(t.id) || before[t.id] || null, t.id);
  for (const [t] of solved.pairs) assert.equal(before[t], null, `${t} was not on a course`);
  const placedNow = new Set(solved.pairs.map(([t]) => t));
  assert.deepEqual([...Mock.state.moved].filter(([t]) => !placedNow.has(t)), moved.filter(([t]) => !placedNow.has(t)));
  for (const t of placedNow) {
    assert.ok(!Mock.state.moved.has(t), `${t} is no longer moved by the office`);
    assert.ok(!Mock.reason(t).startsWith("Moved by the office"), `${t} reason`);
  }
  assert.deepEqual(Mock.history()[0].event, { type: "forms", rounds: ["Round 2", "Singapore"], placed: solved.pairs.length });
});

test("undo after addForms restores placements, school stays", async () => {
  const { base, highs, firstDraft, read } = await roundOne();
  Mock.init(base);
  Mock.build(firstDraft);
  const before = { ...Mock.state.placements };
  const solved = solveDraft(highs, read.school, placedPairs());
  Mock.addForms(read.school, solved.pairs, read.rounds, read.senders);
  Mock.undo();
  assert.deepEqual(Mock.state.placements, before);
  const sender = read.senders.find((id) => read.school.teachers.find((t) => t.id === id).prefs.some((p) => p.round === "Round 2"));
  assert.ok(Mock.teacher(sender).prefs.some((p) => p.round === "Round 2"));
  assert.ok(Mock.teacher(sender).submitted);
});

test("left is cleared for senders and the newly placed only", async () => {
  const { base, firstDraft, read } = await roundOne();
  Mock.init(base);
  Mock.build(firstDraft);
  const open = base.teachers.filter((t) => !Mock.placedOn(t.id)).map((t) => t.id);
  assert.ok(open.length >= 3);
  const [placed, sent, stays] = open;
  Mock.leave(open);
  const cid = Mock.courses()[0].id;
  Mock.addForms(read.school, [[placed, cid]], ["Round 2"], [sent]);
  assert.ok(!Mock.state.left.has(placed));
  assert.ok(!Mock.state.left.has(sent));
  assert.ok(Mock.state.left.has(stays));
  assert.deepEqual(sorted(Mock.state.left), sorted(open.filter((id) => id !== placed && id !== sent)));
  assert.equal(Mock.placedOn(placed), cid);
});

test("someone moved to Not placed by hand stays off and stays left after addForms", async () => {
  const { base, highs, firstDraft, read } = await roundOne();
  Mock.init(base);
  Mock.build(firstDraft);
  const sent = new Set(read.senders);
  const off = base.teachers.find((t) => Mock.placedOn(t.id) && sent.has(t.id) && !t.returning);
  const open = base.teachers.find((t) => !Mock.placedOn(t.id) && sent.has(t.id));
  assert.ok(off && open);
  Mock.move(off.id, null);
  Mock.leave([open.id]);
  assert.deepEqual(Mock.handOff(), [off.id]);
  const solved = solveDraft(highs, read.school, placedPairs(), Mock.handOff());
  assert.equal(solved.status, "Optimal");
  assert.ok(!solved.pairs.some(([t]) => t === off.id));
  Mock.addForms(read.school, solved.pairs, read.rounds, read.senders);
  assert.equal(Mock.placedOn(off.id), null);
  assert.ok(Mock.state.left.has(off.id), "still off the To do");
  assert.ok(!Mock.state.left.has(open.id), "Leave unplaced does not hold a sender off");
});

test("describe a forms event", () => {
  const say = (rounds, placed) => Mock.describe({ event: { type: "forms", rounds, placed } });
  assert.equal(say(["Round 2"], 7), "Added Round 2 forms, placed 7");
  assert.equal(say(["Singapore"], 3), "Added Singapore forms, placed 3");
  assert.equal(say(["Round 2", "Singapore"], 9), "Added Round 2 and Singapore forms, placed 9");
});
