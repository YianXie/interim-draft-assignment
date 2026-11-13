// The mock's logic, ported to an ES module. Call Mock.init(school, snapshots) to load a School, then Mock.build(draft) once.
// Mock.on(fn) re-renders after any change; Mock.onSnapshot(fn) hears each new Snapshot. No Node modules, no solver imports.
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
let D = { teachers: [], courses: [] };
let T = new Map();
let C = new Map();
const S = { listeners: [], snapListeners: [] };

const on = (fn) => S.listeners.push(fn);
const onSnapshot = (fn) => S.snapListeners.push(fn);
const emit = () => S.listeners.forEach((f) => f());
const load = (snap) => Object.assign(S, { placements: { ...snap.placements }, moved: new Map(snap.moved), left: new Set(snap.left) });

// Load a School. With saved Snapshots the newest is restored; without, the state stays empty until build(). Listeners stay registered.
function init(school, snapshots) {
  D = school;
  T = new Map(D.teachers.map((t) => [t.id, t]));
  C = new Map(D.courses.map((c) => [c.id, c]));
  Object.assign(S, { placements: {}, moved: new Map(), left: new Set(), namesOn: false, version: 0, savedAt: "", history: [] });
  if (snapshots && snapshots.length) {
    S.history = [...snapshots].sort((a, b) => b.version - a.version);
    load(S.history[0]);
    S.version = S.history[0].version;
    S.savedAt = fmtTime(S.history[0].when);
  }
  emit();
}

// Every change is one new Snapshot: who is placed where, who was moved by hand, who was left unplaced. T numbers and course codes only.
function append(event, prev) {
  const version = S.history.length ? S.history[0].version + 1 : 1;
  const when = new Date().toISOString();
  const snap = { version, prev, when, event, placements: { ...S.placements }, moved: [...S.moved], left: [...S.left] };
  S.history.unshift(snap);
  S.version = version;
  S.savedAt = fmtTime(when);
  S.snapListeners.forEach((f) => f(snap));
  emit();
}
const shown = () => (S.history.length ? S.history[0].version : null);

// The solver's draft becomes the first Snapshot.
function build(draft) {
  S.placements = Object.fromEntries(D.teachers.map((t) => [t.id, (draft && draft[t.id]) || null]));
  S.moved = new Map();
  S.left = new Set();
  S.history = [];
  append({ type: "build" }, null);
}

const ord = (n) => n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || "th");
const BONUS = { "Round 1": 20, "Round 2": 10, Singapore: 0 };
const score = (p) => 8 - p.rank + BONUS[p.round];

const teacher = (id) => T.get(id);
const course = (id) => C.get(id);
const teachers = () => D.teachers;
const courses = () => D.courses.filter((c) => c.running);
const allCourses = () => D.courses;
const label = (id) => (S.namesOn ? T.get(id).name : T.get(id).id);
const contact = (id) => (S.namesOn ? T.get(id).email : "");
const placedOn = (tid) => S.placements[tid] || null;
const sponsors = (cid) => D.teachers.filter((t) => S.placements[t.id] === cid).map((t) => t.id);
const seatsLeft = (cid) => C.get(cid).seats - sponsors(cid).length;
// Their best-scoring listing of this course, where it was ranked more than once.
const choice = (tid, cid) => T.get(tid).prefs.filter((p) => p.course === cid).sort((a, b) => score(b) - score(a))[0] || null;
const choiceText = (tid, cid) => { const c = choice(tid, cid); return c ? `${ord(c.rank)} choice, ${c.round}` : "Not on their list"; };

// Last year, when the past files were added. Its own line on the teacher, never part of a reason.
const past = () => D.past || null;
const lastYear = (tid) => T.get(tid).lastYear || null;
const LAST_YEAR = { none: "none of their choices", notFound: "not on the allocation", noForm: "no form" };
function lastYearLine(tid) {
  const was = past() && lastYear(tid);
  return was ? `Last year: ${LAST_YEAR[was.result] || `${ord(was.rank)} choice`}` : "";
}
// How this year stands for them in the draft as it is now, for setting against last year.
function thisYear(tid) {
  const t = T.get(tid);
  const cid = S.placements[tid];
  if (!cid) return "notPlaced";
  if (t.returning && t.returningCourse === cid) return "returning";
  if (!t.submitted) return "noForm";
  const ch = choice(tid, cid);
  if (!ch) return "notRanked";
  return ch.rank <= 4 ? "top4" : "5to7";
}

function status(cid) {
  const c = C.get(cid);
  const n = sponsors(cid).length;
  if (!c.running) return "not running";
  if (n === 0) return "too few sponsors to run";
  if (n > c.seats) return "over";
  return n === c.seats ? "full" : "short";
}

// One true thing about a course on this person's list.
function verb(t, cid) {
  const c = C.get(cid);
  const st = status(cid);
  if (st === "not running") return "is not running";
  if (c.needs && !t.certificates.includes(c.needs)) return `needs a ${c.needs.toLowerCase()}`;
  if (st === "full" || st === "over") return "is full";
  return st === "short" ? "has a free seat" : "did not run";
}
const words = (s) => s.split(/\s+/).filter(Boolean).length;
// A listed choice by name, with its round when it is not the one already being talked about.
const which = (p, round) => (p.round === round ? `Their ${ord(p.rank)} choice` : `Their ${p.round} ${ord(p.rank)} choice`);

// One line, facts only, at most 20 words. Never names another teacher, never says anyone had priority.
function reason(tid) {
  const t = T.get(tid);
  const cid = S.placements[tid] || null;
  const ch = cid ? choice(tid, cid) : null;
  const own = ch ? `Their ${ord(ch.rank)} choice in ${ch.round}.` : "Not on their list.";
  if (S.moved.has(tid)) return `Moved by the office. ${cid ? own : "Not placed."}`;
  if (!cid) {
    if (!t.submitted) return "No form received. Not placed yet.";
    const top = [...t.prefs].sort((a, b) => score(b) - score(a))[0];
    return top ? `Not placed. ${which(top, null)}, ${C.get(top.course).name}, ${verb(t, top.course)}.` : "Not placed.";
  }
  if (t.returning && t.returningCourse === cid) return "Returning sponsor, staying on this course.";
  if (!t.submitted) return "No form received. Suggested to fill a seat, check with them first.";
  if (!ch) return "Not on their list. Placed here by the office.";
  const better = t.prefs.filter((p) => p.course !== cid && score(p) > score(ch)).sort((a, b) => score(b) - score(a))[0];
  if (!better) return own;
  const full = `${own} ${which(better, ch.round)}, ${C.get(better.course).name}, ${verb(t, better.course)}.`;
  return words(full) <= 20 ? full : own;
}

// What is unusual about this teacher: [{level:'needs'|'check'|'info', text}]
function teacherFlags(tid) {
  const t = T.get(tid);
  const cid = S.placements[tid];
  const out = [];
  if (!cid && t.submitted) out.push({ level: "needs", text: "Not placed" });
  if (!t.submitted && !t.returning) out.push({ level: "check", text: "No form received" });
  if (cid) {
    const ch = choice(tid, cid);
    const c = C.get(cid);
    if (ch && ch.rank >= 5) out.push({ level: "check", text: `${ord(ch.rank)} choice` });
    if (!ch && t.submitted && !(t.returning && t.returningCourse === cid)) out.push({ level: "check", text: "Not on their list" });
    if (c.needs && !t.certificates.includes(c.needs)) out.push({ level: "needs", text: `No ${c.needs.toLowerCase()} on file` });
  }
  return out;
}

// What is unusual about this course: [{level, text}]
function courseFlags(cid) {
  const c = C.get(cid);
  const list = sponsors(cid);
  const out = [];
  if (list.length === 0) out.push({ level: "needs", text: `Needs sponsors: 0 of ${c.seats}` });
  else if (list.length < c.seats) out.push({ level: "needs", text: `Needs sponsors: ${list.length} of ${c.seats}` });
  if (list.length > c.seats) out.push({ level: "check", text: `Over by ${list.length - c.seats}` });
  if (c.needs && list.some((t) => !T.get(t).certificates.includes(c.needs))) out.push({ level: "needs", text: "Certificate missing" });
  return out;
}

// What still needs the office, in the order it is shown: short or empty offered courses, people with a form not placed,
// then one group for everyone with no form who is not placed. Anyone the office left unplaced is done.
function todo() {
  if (!S.history.length) return [];
  const out = courses().filter((c) => sponsors(c.id).length < c.seats).map((c) => ({ kind: "course", cid: c.id }));
  const open = D.teachers.filter((t) => !S.placements[t.id] && !S.left.has(t.id));
  for (const t of open) if (t.submitted) out.push({ kind: "teacher", tid: t.id });
  const noForm = open.filter((t) => !t.submitted).map((t) => t.id);
  if (noForm.length) out.push({ kind: "noForm", tids: noForm });
  return out;
}

function summary() {
  const placed = D.teachers.filter((t) => S.placements[t.id]);
  const ranked = placed.filter((t) => t.submitted && choice(t.id, S.placements[t.id]));
  const top3 = ranked.filter((t) => choice(t.id, S.placements[t.id]).rank <= 3).length;
  return {
    teachers: D.teachers.length, responded: D.teachers.filter((t) => t.submitted).length, placed: placed.length,
    notPlaced: D.teachers.length - placed.length, ranked: ranked.length, top3,
    returning: placed.filter((t) => t.returning && t.returningCourse === S.placements[t.id]).length,
    coursesRunning: courses().length, coursesStaffed: courses().filter((c) => sponsors(c.id).length >= c.seats).length,
    coursesShort: courses().filter((c) => sponsors(c.id).length < c.seats).length,
    version: S.version, savedAt: S.savedAt, year: D.year, school: D.school,
  };
}

// Every running course this teacher could go to, their own choices first.
function optionsFor(tid) {
  const t = T.get(tid);
  return courses().filter((c) => c.id !== S.placements[tid]).map((c) => {
    const ch = choice(tid, c.id);
    const left = seatsLeft(c.id);
    const warn = [];
    if (left <= 0) warn.push("This course is full");
    if (!ch && t.submitted) warn.push("They did not rank this");
    if (c.needs && !t.certificates.includes(c.needs)) warn.push(`No ${c.needs.toLowerCase()} on file`);
    if (t.returning && t.returningCourse && c.id !== t.returningCourse) warn.push("Returning sponsor");
    return { cid: c.id, name: c.name, kind: c.kind, choice: ch ? `${ord(ch.rank)} choice, ${ch.round}` : "Not on their list", rank: ch ? score(ch) : -1,
             seats: left > 0 ? `${left} seat${left === 1 ? "" : "s"} left` : "Full", warn };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
}

// Everyone who asked for this course, best choice first.
function whoAsked(cid) {
  return D.teachers.map((t) => ({ tid: t.id, p: choice(t.id, cid) })).filter((x) => x.p).sort((a, b) => score(b.p) - score(a.p))
    .map((x) => ({ tid: x.tid, choice: `${ord(x.p.rank)} choice, ${x.p.round}`, placedHere: S.placements[x.tid] === cid, placedOn: S.placements[x.tid] ? C.get(S.placements[x.tid]).name : "Not placed" }));
}

// Place someone, or put them on Not placed (cid null). Moving to Not placed is the office's decision, so it also clears them from the To do.
function move(tid, cid) {
  const to = cid || null;
  if (!T.has(tid) || (to && !C.has(to)) || (S.placements[tid] || null) === to) return;
  if (!S.moved.has(tid)) S.moved.set(tid, S.placements[tid] || null);
  S.placements[tid] = to;
  if (to) S.left.delete(tid); else S.left.add(tid);
  append({ type: "move", t: tid, to }, shown());
}
// The office decides these people stay unplaced.
function leave(tids) {
  const ids = [...new Set(tids)].filter((id) => T.has(id) && !S.placements[id] && !S.left.has(id));
  if (!ids.length) return;
  ids.forEach((id) => S.left.add(id));
  append({ type: "leave", t: ids }, shown());
}
const canUndo = () => S.history.length > 0 && S.history[0].prev !== null;
// Back to the version the newest one replaced. That is written as a new version whose own prev is that version's prev.
function undo() {
  if (!canUndo()) return;
  const back = S.history.find((h) => h.version === S.history[0].prev);
  load(back);
  append({ type: "undo" }, back.prev);
}
function restore(version) {
  const h = S.history.find((x) => x.version === version);
  if (!h) return;
  const was = shown();
  load(h);
  append({ type: "restore", v: version }, was);
}
function setNames(on_) { S.namesOn = !!on_; emit(); }

// Plain words for a Snapshot, built now so they follow the names switch.
function describe(snap) {
  const e = snap.event;
  const where = (cid) => (cid ? C.get(cid).name : "not placed");
  if (e.type === "build") return "First draft built from the forms";
  if (e.type === "move") return `Moved ${label(e.t)} to ${where(e.to)}`;
  if (e.type === "leave") return e.t.length === 1 ? `Left ${label(e.t[0])} unplaced` : `Left ${e.t.length} people unplaced`;
  if (e.type === "restore") return `Restored version ${e.v}`;
  return "Undid the last change";
}

export const Mock = { state: S, on, onSnapshot, init, build, teacher, course, teachers, courses, allCourses, label, contact, placedOn, sponsors, seatsLeft, choice, choiceText, past, lastYear, lastYearLine, thisYear, status, reason,
  teacherFlags, courseFlags, todo, summary, optionsFor, whoAsked, move, leave, undo, canUndo, restore, setNames, describe, history: () => [...S.history] };
