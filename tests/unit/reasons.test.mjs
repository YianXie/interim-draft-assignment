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
const BONUS = { "Round 1": 20, "Round 2": 10, Singapore: 0 };
const score = (p) => 8 - p.rank + BONUS[p.round];
const words = (s) => s.split(/\s+/).filter(Boolean).length;

// Applies the same scripted moves to Mock and to a plain copy of the draft, so claims are checked against the copy.
function script(seed, count) {
  const rand = lcg(seed);
  const placed = { ...draft };
  const cs = school.courses.filter((c) => c.running);
  for (let i = 0; i < count; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    const to = rand(5) === 0 ? null : cs[rand(cs.length)].id;
    Mock.move(t.id, to);
    placed[t.id] = to;
  }
  return placed;
}
const fresh = () => { Mock.init(school); Mock.build(draft); };

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || "th"}`;

// Every claim a reason makes, checked against the draft and the School alone.
function checkFacts(placed, moved) {
  const byName = new Map(school.courses.map((c) => [c.name, c]));
  const taken = (cid) => Object.values(placed).filter((c) => c === cid).length;
  let claims = 0;
  for (const t of school.teachers) {
    const text = Mock.reason(t.id);
    assert.ok(words(text) <= 20, `${t.id}: ${words(text)} words: ${text}`);
    assert.ok(!/too few sponsors/i.test(text), text);
    const cid = placed[t.id];
    for (const m of text.matchAll(/Their (\d+)\w\w choice in (Round 1|Round 2|Singapore)\./g)) {
      claims++;
      assert.ok(cid, `${t.id}: a choice is claimed but they are not placed: ${text}`);
      const own = t.prefs.filter((p) => p.course === cid);
      const best = own.sort((a, b) => score(b) - score(a))[0];
      assert.ok(best, `${t.id}: choice claimed on a course not on their list: ${text}`);
      assert.equal(best.rank, Number(m[1]), text);
      assert.equal(best.round, m[2], text);
    }
    for (const m of text.matchAll(/(Their [^.,]*?choice), ([^,]+), (is full|is not running|has a free seat|did not run|needs a scuba certificate)\./g)) {
      claims++;
      const c = byName.get(m[2]);
      assert.ok(c, `${t.id}: unknown course ${m[2]}`);
      const pref = t.prefs.find((p) => p.course === c.id);
      assert.ok(pref, `${t.id}: ${c.name} is not on their list: ${text}`);
      const rank = m[1].match(/(\d+)\w\w choice/)[1];
      assert.equal(pref.rank, Number(rank), text);
      const rd = m[1].match(/Round [12]|Singapore/);
      if (rd) assert.equal(pref.round, rd[0], text);
      const n = taken(c.id);
      switch (m[3]) {
        case "is full": assert.ok(c.running && n >= c.seats, text); break;
        case "is not running": assert.ok(!c.running, text); break;
        case "has a free seat": assert.ok(c.running && n < c.seats && n > 0, text); break;
        case "did not run": assert.ok(c.running && n === 0, text); break;
        case "needs a scuba certificate": assert.ok(c.needs === "Scuba certificate" && !t.certificates.includes("Scuba certificate"), text); break;
      }
    }
    if (/Returning sponsor/.test(text)) assert.ok(t.returning && t.returningCourse === cid, text);
    if (/^Moved by the office/.test(text)) assert.ok(moved.has(t.id), text);
    if (/Not placed/.test(text)) assert.equal(cid, null, text);
    if (/No form received/.test(text)) assert.equal(t.submitted, false, text);
  }
  return claims;
}

test("every reason is at most 20 words before and after 40 scripted moves", () => {
  fresh();
  for (const t of school.teachers) assert.ok(words(Mock.reason(t.id)) <= 20, Mock.reason(t.id));
  script(11, 40);
  for (const t of school.teachers) assert.ok(words(Mock.reason(t.id)) <= 20, Mock.reason(t.id));
  Mock.setNames(true);
  for (const t of school.teachers) assert.ok(words(Mock.reason(t.id)) <= 20, Mock.reason(t.id));
});

test("every stated fact is true before and after 40 scripted moves", () => {
  fresh();
  const before = checkFacts({ ...draft }, new Set());
  const moved = new Set();
  const rand = lcg(23);
  const placed = { ...draft };
  const cs = school.courses.filter((c) => c.running);
  for (let i = 1; i <= 40; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    const to = rand(5) === 0 ? null : cs[rand(cs.length)].id;
    Mock.move(t.id, to);
    placed[t.id] = to;
    moved.add(t.id);
    if (i % 10 === 0) checkFacts(placed, moved);
  }
  const after = checkFacts(placed, moved);
  assert.ok(before > 5, `only ${before} claims were checked before`);
  assert.ok(after > 5, `only ${after} claims were checked after`);
});

// Drives each verb into existence on purpose, then checks it against the draft alone.
test("each verb is produced and each is true", () => {
  fresh();
  const placed = { ...draft };
  const moved = new Set();
  const go = (tid, to) => { Mock.move(tid, to); placed[tid] = to; moved.add(tid); };
  const cs = new Map(school.courses.map((c) => [c.id, c]));
  const betterThanPlaced = (t, cid) => {
    const mine = t.prefs.filter((p) => p.course === placed[t.id]).sort((a, b) => score(b) - score(a))[0];
    const p = t.prefs.find((x) => x.course === cid);
    return t.submitted && mine && p && score(p) > score(mine);
  };
  const said = (tid) => Mock.reason(tid);

  // is full: someone placed below a full course they ranked higher.
  const fullCase = school.teachers.find((t) => t.prefs.some((p) => cs.get(p.course).running && !cs.get(p.course).needs && betterThanPlaced(t, p.course)));
  assert.ok(fullCase);
  assert.match(said(fullCase.id), /is full\./);

  // is not running: someone placed below a course that is not offered.
  const dark = school.teachers.find((t) => t.prefs.some((p) => !cs.get(p.course).running && betterThanPlaced(t, p.course)));
  assert.ok(dark);
  assert.match(said(dark.id), /is not running\./);

  // needs a scuba certificate: nobody in the fixture draft is placed below a scuba course they cannot take, so make one.
  // A moved teacher gets no such sentence, so this is a build of a hand-made School and draft.
  const scuba = school.courses.find((c) => c.needs === "Scuba certificate" && c.running);
  const x = school.teachers.find((t) => t.submitted && !t.returning && !t.certificates.includes("Scuba certificate") && t.prefs.some((p) => p.course === scuba.id));
  const sp = x.prefs.find((p) => p.course === scuba.id);
  const low = { course: school.courses.find((c) => c.running && !c.needs && c.id !== scuba.id).id, rank: 7, round: "Singapore" };
  const hand = { ...school, teachers: school.teachers.map((t) => (t.id === x.id ? { ...t, prefs: [sp, low] } : t)) };
  Mock.init(hand);
  Mock.build({ ...draft, [x.id]: low.course });
  const text = said(x.id);
  assert.match(text, new RegExp(`^Their 7th choice in Singapore\\. Their ${sp.round} ${sp.rank}\\w\\w choice, ${scuba.name}, needs a scuba certificate\\.$`));
  assert.ok(scuba.needs === "Scuba certificate" && !x.certificates.includes("Scuba certificate"));
  assert.ok(words(text) <= 20);
  Mock.init(school);
  Mock.build(draft);

  // has a free seat and did not run: empty a full course (2+ seats) that someone ranked above their own course.
  const top = (t) => [...t.prefs].sort((x, y) => score(y) - score(x))[0];
  const asker = school.teachers.find((t) => {
    const c = t.prefs.length && cs.get(top(t).course);
    return c && c.running && !c.needs && c.seats >= 2 && betterThanPlaced(t, c.id)
      && Object.values(placed).filter((x) => x === c.id).length === c.seats;
  });
  assert.ok(asker, "someone whose best choice is a full course of two or more seats, and who is placed lower");
  const open = cs.get(top(asker).course);
  const inside = Object.keys(placed).filter((k) => placed[k] === open.id);
  go(inside[0], null);
  assert.match(said(asker.id), /has a free seat\./);
  checkFacts(placed, moved);
  for (const k of inside.slice(1)) go(k, null);
  assert.match(said(asker.id), /did not run\./);
  checkFacts(placed, moved);
});

test("a moved teacher shows Moved by the office and their choice only", () => {
  fresh();
  const t = school.teachers.find((x) => x.submitted && draft[x.id] && !(x.returning && x.returningCourse === draft[x.id]) && x.prefs.length > 1);
  const target = t.prefs.map((p) => p.course).find((c) => c !== draft[t.id] && school.courses.find((k) => k.id === c).running);
  Mock.move(t.id, target);
  const text = Mock.reason(t.id);
  assert.match(text, /^Moved by the office\. Their \d+\w\w choice in (Round 1|Round 2|Singapore)\.$/);
  Mock.move(t.id, null);
  assert.equal(Mock.reason(t.id), "Moved by the office. Not placed.");
  Mock.move(t.id, school.courses.find((c) => c.running && !t.prefs.some((p) => p.course === c.id)).id);
  assert.equal(Mock.reason(t.id), "Moved by the office. Not on their list.");
});

test("a course with a free seat is never said to have too few sponsors", () => {
  fresh();
  const rand = lcg(3);
  const cs = school.courses.filter((c) => c.running);
  for (let i = 0; i < 40; i++) {
    const t = school.teachers[rand(school.teachers.length)];
    Mock.move(t.id, rand(5) === 0 ? null : cs[rand(cs.length)].id);
    for (const x of school.teachers) assert.ok(!/too few sponsors/i.test(Mock.reason(x.id)), Mock.reason(x.id));
  }
  // An unplaced person whose best choice is short gets the free-seat sentence.
  fresh();
  const short = cs.find((c) => Mock.seatsLeft(c.id) > 0 && Mock.sponsors(c.id).length > 0);
  const lone = school.teachers.find((t) => t.submitted && !draft[t.id] && t.prefs.length);
  assert.ok(short && lone);
  const top = lone.prefs.slice().sort((a, b) => score(b) - score(a))[0];
  const topCourse = school.courses.find((c) => c.id === top.course);
  const seats = Mock.seatsLeft(top.course);
  const text = Mock.reason(lone.id);
  if (topCourse.running && seats > 0 && Mock.sponsors(top.course).length > 0) assert.match(text, /has a free seat\./);
  assert.ok(!/too few/.test(text));
});

test("reason never names another teacher", () => {
  fresh();
  const check = () => {
    for (const t of school.teachers) {
      const text = Mock.reason(t.id);
      for (const o of school.teachers) {
        if (o.id === t.id) continue;
        assert.ok(!text.includes(o.name) && !text.includes(o.id) && !text.includes(o.email), text);
      }
      assert.ok(!/\bT\d{3}\b/.test(text), text);
    }
  };
  check();
  script(31, 40);
  check();
  Mock.setNames(true);
  check();
});
