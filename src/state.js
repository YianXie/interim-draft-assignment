// Behaviour of the approved mock, ported to an ES module. Call Mock.init(data) to load a School; Mock.on(fn) re-renders after any change.
const fmtTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
let D = { teachers: [], courses: [], draft: {} };
let T = new Map();
let C = new Map();
const S = { listeners: [] };

// Load a School (and its draft) and reset everything that depends on it. Listeners stay registered.
function init(data) {
  D = data;
  T = new Map(D.teachers.map((t) => [t.id, t]));
  C = new Map(D.courses.map((c) => [c.id, c]));
  Object.assign(S, {
    placements: { ...D.draft }, kept: new Set(), moved: new Map(), namesOn: false, reviewed: new Set(),
    version: 1, savedAt: fmtTime(), history: [], undone: [],
  });
  S.history.push({ version: 1, when: S.savedAt, text: "First draft built from the forms", placements: { ...S.placements }, kept: [], moved: [] });
  emit();
}

const on = (fn) => S.listeners.push(fn);
const emit = () => S.listeners.forEach((f) => f());
const ord = (n) => n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || "th");
const BONUS = { "Round 1": 20, "Round 2": 10, Singapore: 0 };
const score = (p) => 8 - p.rank + BONUS[p.round];

const teacher = (id) => T.get(id);
const course = (id) => C.get(id);
const teachers = () => D.teachers;
const courses = () => D.courses.filter((c) => c.running);
const label = (id) => (S.namesOn ? T.get(id).name : T.get(id).id);
const contact = (id) => (S.namesOn ? T.get(id).email : "");
const comment = (id) => (S.namesOn ? T.get(id).comment : null);
const placedOn = (tid) => S.placements[tid] || null;
const sponsors = (cid) => D.teachers.filter((t) => S.placements[t.id] === cid).map((t) => t.id);
const seatsLeft = (cid) => C.get(cid).seats - sponsors(cid).length;
const choice = (tid, cid) => T.get(tid).prefs.filter((p) => p.course === cid).sort((a, b) => a.rank - b.rank)[0] || null;
const choiceText = (tid, cid) => { const c = choice(tid, cid); return c ? `${ord(c.rank)} choice, ${c.round}` : "Not on their list"; };

function status(cid) {
  const c = C.get(cid);
  const n = sponsors(cid).length;
  if (!c.running) return "not running";
  if (n === 0) return "too few sponsors to run";
  if (n > c.seats) return "over";
  return n === c.seats ? "full" : "short";
}

// Only the causes that are true for this person's list, in a fixed order.
function listBlockers(t) {
  const kinds = new Set(t.prefs.map((p) => {
    const c = C.get(p.course);
    if (!c.running) return "not running";
    if (c.needs && !t.certificates.includes(c.needs)) return "needs a certificate they lack";
    const st = status(p.course);
    return st === "full" || st === "over" ? "full" : "short of sponsors";
  }));
  const words = ["full", "not running", "short of sponsors", "needs a certificate they lack"].filter((k) => kinds.has(k));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : words[0];
}

// One line, facts only. Never names another teacher, never mentions gender, never says anyone had priority.
function reason(tid) {
  const t = T.get(tid);
  const cid = S.placements[tid];
  const prefix = S.moved.has(tid) ? `Moved by the office, was ${S.moved.get(tid) ? C.get(S.moved.get(tid)).name : "not placed"}. ` : "";
  if (!cid) {
    if (!t.submitted) return `${prefix}No form received. Not placed yet.`;
    return `${prefix}Not placed. Every course on their list is ${listBlockers(t)}.`;
  }
  if (t.returning && t.returningCourse === cid) return `${prefix}Returning sponsor, staying on this course.`;
  if (!t.submitted) return `${prefix}No form received. Suggested to fill a seat, check with them first.`;
  const ch = choice(tid, cid);
  if (!ch) return prefix ? `${prefix}Not on their list.` : "Not on their list. Placed here by the office.";
  const base = `${prefix}Their ${ord(ch.rank)} choice in ${ch.round}.`;
  const better = t.prefs.filter((p) => score(p) > score(ch)).sort((a, b) => score(b) - score(a))[0];
  if (!better) return base;
  const st = status(better.course);
  const bc = C.get(better.course);
  const verb = bc.needs && !t.certificates.includes(bc.needs) ? `needs a ${bc.needs.toLowerCase()}` : st === "full" || st === "over" ? "is full" : st === "not running" ? "is not running" : "had too few sponsors to run";
  const which = better.round === ch.round ? `Their ${ord(better.rank)} choice` : `Their ${better.round} ${ord(better.rank)} choice`;
  return `${base} ${which}, ${C.get(better.course).name}, ${verb}.`;
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
  if (S.kept.has(tid)) out.push({ level: "info", text: "Kept" });
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
  if (list.length >= 2 && new Set(list.map((t) => T.get(t).gender)).size === 1) out.push({ level: "check", text: "Not a mixed pair" });
  if (c.needs && list.some((t) => !T.get(t).certificates.includes(c.needs))) out.push({ level: "needs", text: `Certificate missing` });
  return out;
}

// Everything that needs a person, most urgent first: [{level, group, text, tid|cid}]
function attention() {
  const out = [];
  for (const c of courses()) for (const f of courseFlags(c.id)) out.push({ level: f.level, group: "Courses", text: `${c.name}: ${f.text}`, cid: c.id });
  for (const t of D.teachers) for (const f of teacherFlags(t.id)) if (f.level !== "info") out.push({ level: f.level, group: "Teachers", text: f.text, tid: t.id });
  const rank = { needs: 0, check: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
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
    reviewed: S.reviewed.size, notChecked: ["Languages: nothing on file"], version: S.version, savedAt: S.savedAt, year: D.year, school: D.school,
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
    return { cid: c.id, name: c.name, kind: c.kind, choice: ch ? `${ord(ch.rank)} choice, ${ch.round}` : "Not on their list", rank: ch ? score(ch) : -1,
             seats: left > 0 ? `${left} seat${left === 1 ? "" : "s"} left` : "Full", warn };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
}

// Everyone who asked for this course, best choice first.
function whoAsked(cid) {
  return D.teachers.map((t) => ({ tid: t.id, p: choice(t.id, cid) })).filter((x) => x.p).sort((a, b) => score(b.p) - score(a.p))
    .map((x) => ({ tid: x.tid, choice: `${ord(x.p.rank)} choice, ${x.p.round}`, placedHere: S.placements[x.tid] === cid, placedOn: S.placements[x.tid] ? C.get(S.placements[x.tid]).name : "Not placed" }));
}

function save(text) {
  S.version += 1;
  S.savedAt = fmtTime();
  S.history.unshift({ version: S.version, when: S.savedAt, text, placements: { ...S.placements }, kept: [...S.kept], moved: [...S.moved] });
  emit();
}
const short = (id) => label(id);
function move(tid, cid, why) {
  const from = S.placements[tid] || null;
  S.placements[tid] = cid || null;
  if (!S.moved.has(tid)) S.moved.set(tid, from);
  S.kept.add(tid);
  save(`Moved ${short(tid)} to ${cid ? C.get(cid).name : "not placed"}${why ? ` (${why})` : ""}`);
}
function swap(a, b) {
  const ca = S.placements[a], cb = S.placements[b];
  S.placements[a] = cb; S.placements[b] = ca;
  for (const [t, c] of [[a, ca], [b, cb]]) { if (!S.moved.has(t)) S.moved.set(t, c); S.kept.add(t); }
  save(`Swapped ${short(a)} and ${short(b)}`);
}
function keep(tid) {
  if (S.kept.has(tid)) S.kept.delete(tid); else S.kept.add(tid);
  save(`${S.kept.has(tid) ? "Kept" : "Stopped keeping"} ${short(tid)}`);
}
function setNames(on_) { S.namesOn = !!on_; emit(); }
function toggleReviewed(cid) { if (S.reviewed.has(cid)) S.reviewed.delete(cid); else S.reviewed.add(cid); emit(); }

// Stand-in for the real solver: pairs of people, not kept, who would each do better by swapping.
function redoPreview() {
  const free = D.teachers.filter((t) => S.placements[t.id] && !S.kept.has(t.id) && !t.returning);
  const moves = [];
  const used = new Set();
  for (const a of free) {
    if (used.has(a.id)) continue;
    for (const b of free) {
      if (a.id >= b.id || used.has(b.id)) continue;
      const ca = S.placements[a.id], cb = S.placements[b.id];
      if (ca === cb) continue;
      const pa = choice(a.id, cb), pb = choice(b.id, ca);
      if (pa && pb) {
        moves.push({ tid: a.id, from: ca, to: cb, text: choiceText(a.id, cb) }, { tid: b.id, from: cb, to: ca, text: choiceText(b.id, ca) });
        used.add(a.id); used.add(b.id);
        break;
      }
    }
    if (moves.length >= 8) break;
  }
  return { moves, kept: S.kept.size };
}
function acceptRedo(preview) {
  for (const m of preview.moves) S.placements[m.tid] = m.to;
  save(`Redid the rest: ${preview.moves.length} teachers moved, ${preview.kept} kept`);
}
function restore(version) {
  const h = S.history.find((x) => x.version === version);
  if (!h) return;
  S.placements = { ...h.placements }; S.kept = new Set(h.kept); S.moved = new Map(h.moved);
  save(`Restored version ${version}`);
}

export const Mock = { state: S, on, teacher, course, teachers, courses, label, contact, comment, placedOn, sponsors, seatsLeft, choice, choiceText, status, reason,
  init, teacherFlags, courseFlags, attention, summary, optionsFor, whoAsked, move, swap, keep, setNames, toggleReviewed, redoPreview, acceptRedo, restore, history: () => S.history };
