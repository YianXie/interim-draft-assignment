// Compares a downloaded draft (names on) with the office's final allocation, against the same School the page built.
// Pure: rows in, tables out. Both allocations are measured the same way, with the solver's own points and the page's re-check.
import { displayedRank } from "../../src/solver.js";
import { recheck } from "../../src/recheck.js";
import { norm, courseIndex, nameKeys, findColumn, stripMarker } from "../convert/match.mjs";

const WEIGHTS = [7, 6, 5, 4, 3, 2, 1];
const BONUS = { "Round 1": 20, "Round 2": 10, Singapore: 0 };
const ROUNDS = ["Round 1", "Round 2", "Singapore"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

// What each teacher got, in table order.
export const CHOICE = {
  returning: "Returning sponsor",
  returningMoved: "Returning sponsor, other course",
  ...Object.fromEntries(ORD.map((o, i) => [`rank${i + 1}`, `${o} choice`])),
  notListed: "Not on their list",
  noForm: "No form, placed",
  notPlaced: "Not placed",
};

const RULE = {
  ONE_COURSE: "On two courses",
  NOT_OFFERED: "On a course not offered",
  NOT_A_TEACHER: "Not on the staff list",
  NOT_RANKED: "Sent a form, placed off their list",
  CERTIFICATE: "Without the certificate the course needs",
  RETURNING_MOVED: "Returning sponsor not on their course",
  OVER_SEATS: "Courses over their seats",
  UNDER_SEATS: "Courses part filled, no returning sponsor",
};

const blank = (v) => v === null || v === undefined || String(v).trim() === "";
const text = (v) => (blank(v) ? "" : String(v).trim());
const loose = (s) => stripMarker(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const body = (rows) => rows.slice(1).map((cells, i) => ({ n: i + 2, cells })).filter((r) => r.cells.some((c) => !blank(c)));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");

// The download's Files sheet says which optional files the draft was built with. Lines for each one where the --six
// folder differs, since both sides are then measured against files the draft did not have, or without ones it did.
export function builtWithOther(school, sheets) {
  const sheet = sheets.find((s) => s.name === "Files");
  if (!sheet) return [];
  const added = (name) => body(sheet.rows).some(({ cells }) => text(cells[0]) === name && norm(cells[1]) === "yes");
  const out = [];
  for (const [what, had, has] of [["last year's files", added("past-allocation.xlsx"), !!school.past], ["fit.xlsx", added("fit.xlsx"), !!school.fit]]) {
    const it = what === "fit.xlsx" ? ["it", "its", "has"] : ["them", "their", "have"];
    if (has && !had) out.push(`the folder has ${what}, but the draft was built without ${it[0]}: ${it[1]} measures count things the draft never saw`);
    if (had && !has) out.push(`the draft was built with ${what}, but the folder does not ${it[2] === "has" ? "have it" : "have them"}: ${it[1]} measures are left out`);
  }
  return out;
}

// The draft's Teachers sheet: Email and Course Code, read by header.
export function readDraft(school, sheets, report) {
  const sheet = sheets.find((s) => s.name === "Teachers");
  if (!sheet) throw new Error("draft: no Teachers sheet; is this the page's download?");
  const head = sheet.rows[0] ?? [];
  const em = head.findIndex((h) => norm(h) === "email");
  const code = head.findIndex((h) => norm(h) === "course code");
  if (em < 0) throw new Error("draft: no Email column; download it with names on");
  if (code < 0) throw new Error("draft: no Course Code column");
  const byEmail = new Map(school.teachers.map((t) => [t.email.toLowerCase(), t]));
  const courses = new Set(school.courses.map((c) => c.id));
  const placed = new Map();
  for (const { n, cells } of body(sheet.rows)) {
    const t = byEmail.get(text(cells[em]).toLowerCase());
    if (!t) { report.push(`draft, Teachers row ${n}: ${text(cells[em])} is not on staff.xlsx; left out`); continue; }
    const c = text(cells[code]);
    if (!c) continue;
    if (!courses.has(c)) { report.push(`draft, Teachers row ${n}: course code "${c}" is not in courses.xlsx; left out`); continue; }
    if (placed.has(t.id)) { report.push(`draft, Teachers row ${n}: ${t.email} is on the sheet twice; the first row is used`); continue; }
    placed.set(t.id, c);
  }
  return placed;
}

// The office's allocation: Trip Code, Course Name (code in front), Sponsor 1..n as "First Last".
// A sponsor is matched to staff.xlsx by name, else by the school's email rule (first initial + last name) when only one fits.
export function readOffice(school, rows, report) {
  const head = rows[0] ?? [];
  const aCode = findColumn(head, ["code"]);
  const aName = findColumn(head, ["course", "name"]);
  const aSponsors = head.map((h, i) => (norm(h).includes("sponsor") ? i : -1)).filter((i) => i >= 0);
  if (aCode < 0 && aName < 0) throw new Error(`office: no column for Trip Code or Course Name`);
  if (!aSponsors.length) throw new Error(`office: no column for Sponsor 1 (looked for a header with "sponsor")`);

  const byId = new Map(school.courses.map((c) => [c.id, c]));
  const index = courseIndex(school.courses.map((c) => ({ ...c, country: "" })));
  const byName = new Map();
  for (const t of school.teachers) {
    const k = loose(t.name);
    byName.set(k, byName.has(k) ? null : t);
  }
  const who = (full) => {
    const hit = byName.get(loose(full));
    if (hit) return hit;
    if (hit === null) return { twice: true };
    const fits = [...new Set(nameKeys(full).flatMap((k) => school.teachers.filter((t) => new RegExp(`^${k}\\d*@`).test(t.email.toLowerCase()))))];
    return fits.length === 1 ? fits[0] : fits.length > 1 ? { many: fits } : null;
  };

  const placed = new Map();
  for (const { n, cells } of body(rows)) {
    const code = aCode >= 0 ? text(cells[aCode]) : "";
    let name = aName >= 0 ? text(cells[aName]) : "";
    if (code && norm(name).startsWith(norm(code))) name = name.slice(code.length).replace(/^[\s—–:-]+/, "");
    const course = byId.get(code) ?? (name ? index.find(name) : null);
    const names = aSponsors.map((i) => text(cells[i])).filter(Boolean);
    if (!course) {
      if (names.length) report.push(`office, row ${n}: course "${code || name}" is not in courses.xlsx; its ${names.length} sponsor(s) left out`);
      continue;
    }
    for (const full of names) {
      const t = who(full);
      if (!t) { report.push(`office, row ${n}: sponsor "${full}" matches nobody on staff.xlsx; left out`); continue; }
      if (t.twice) { report.push(`office, row ${n}: sponsor "${full}" fits two people on staff.xlsx; left out`); continue; }
      if (t.many) { report.push(`office, row ${n}: sponsor "${full}" fits ${t.many.map((x) => x.email).join(", ")}; left out`); continue; }
      if (placed.has(t.id)) { report.push(`office, row ${n}: ${full} is already on ${placed.get(t.id)}; this row left out`); continue; }
      placed.set(t.id, course.id);
    }
  }
  return placed;
}

// The best listing of a course: weight by rank plus the round's bonus, as the solver scores it.
function pointsOf(t, cid) {
  let best = null;
  for (const p of t.prefs) if (p.course === cid) best = Math.max(best ?? -1, WEIGHTS[p.rank - 1] + BONUS[p.round]);
  return best;
}

function choiceOf(t, cid) {
  if (!cid) return "notPlaced";
  if (t.returning && t.returningCourse === cid) return "returning";
  if (t.returning) return "returningMoved";
  const rank = displayedRank(t.prefs, cid);
  if (rank !== null) return `rank${rank}`;
  return t.submitted ? "notListed" : "noForm";
}
function roundOf(t, cid) {
  const listings = t.prefs.filter((p) => p.course === cid).sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round) || a.rank - b.rank);
  return listings[0]?.round ?? null;
}

// Every measure for one allocation (Map tid → cid).
function measure(school, placed) {
  const teachers = school.teachers;
  const running = school.courses.filter((c) => c.running);
  const on = new Map(school.courses.map((c) => [c.id, 0]));
  for (const c of placed.values()) on.set(c, (on.get(c) ?? 0) + 1);
  const cid = (t) => placed.get(t.id) ?? null;
  const choice = new Map(teachers.map((t) => [t.id, choiceOf(t, cid(t))]));
  const count = (k) => [...choice.values()].filter((v) => v === k).length;
  // Choices are counted for those who sent a form and are not returning sponsors, whose course is fixed.
  const sent = teachers.filter((t) => t.submitted && !t.returning);
  const listedRanks = sent.map((t) => displayedRank(t.prefs, cid(t) ?? "")).filter((r) => r !== null && r !== undefined);
  const returningCourses = new Set(teachers.filter((t) => t.returning).map((t) => t.returningCourse));
  const m = {
    placed: placed.size,
    seats: running.reduce((s, c) => s + c.seats, 0),
    filled: running.reduce((s, c) => s + Math.min(on.get(c.id), c.seats), 0),
    full: running.filter((c) => on.get(c.id) >= c.seats).length,
    part: running.filter((c) => on.get(c.id) > 0 && on.get(c.id) < c.seats).length,
    empty: running.filter((c) => on.get(c.id) === 0).length,
    shortOnReturning: running.filter((c) => returningCourses.has(c.id)).reduce((s, c) => s + Math.max(0, c.seats - on.get(c.id)), 0),
    returningHome: count("returning"),
    returning: teachers.filter((t) => t.returning).length,
    sent: sent.length,
    sentListed: listedRanks.length,
    first: listedRanks.filter((r) => r === 1).length,
    top3: listedRanks.filter((r) => r <= 3).length,
    top4: listedRanks.filter((r) => r <= 4).length,
    meanRank: listedRanks.length ? listedRanks.reduce((a, b) => a + b, 0) / listedRanks.length : null,
    points: teachers.reduce((s, t) => s + (cid(t) ? pointsOf(t, cid(t)) ?? 0 : 0), 0),
    noFormPlaced: count("noForm"),
    choice,
    byRound: Object.fromEntries(ROUNDS.map((r) => [r, teachers.filter((t) => cid(t) && !(t.returning && t.returningCourse === cid(t)) && roundOf(t, cid(t)) === r).length])),
    rules: recheck(school, [...placed]),
  };
  if (school.past) {
    // Got none of their choices last year, not returning: on a 1st to 4th choice now, as the draft's second stage counts.
    const owed = teachers.filter((t) => t.lastYear?.result === "none" && !t.returning);
    m.owed = owed.length;
    m.owedTop4 = owed.filter((t) => { const r = cid(t) && displayedRank(t.prefs, cid(t)); return r && r <= 4; }).length;
  }
  if (school.fit) {
    const rows = (t, k) => (t.fit ?? []).filter((r) => r.course === cid(t) && (k === "Limitation") === (r.kind === "Limitation"));
    m.fits = teachers.filter((t) => cid(t) && rows(t, "fit").length).length;
    m.limits = teachers.filter((t) => cid(t) && rows(t, "Limitation").length).length;
  }
  return m;
}

export function compare(school, draft, office) {
  const d = measure(school, draft), o = measure(school, office);
  const teachers = [...school.teachers].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));

  const summary = [["Measure", "Draft", "Office"]];
  const line = (label, f) => summary.push([label, f(d), f(o)]);
  const section = (label) => summary.push([], [label]);
  section("Seats");
  line("Teachers on the staff list", () => school.teachers.length);
  line("Teachers placed", (m) => m.placed);
  line("Seats filled on offered courses", (m) => `${m.filled} of ${m.seats}`);
  line("Courses full", (m) => m.full);
  line("Courses part filled", (m) => m.part);
  line("Courses with nobody", (m) => m.empty);
  line("Empty seats on a returning sponsor's course", (m) => m.shortOnReturning);
  section("Choices");
  line("Returning sponsors on their own course", (m) => `${m.returningHome} of ${m.returning}`);
  line("Sent a form (not returning), on a course they listed", (m) => `${m.sentListed} of ${m.sent} (${pct(m.sentListed, m.sent)})`);
  line("On their 1st choice", (m) => `${m.first} (${pct(m.first, m.sent)} of forms)`);
  line("On a 1st to 3rd choice", (m) => `${m.top3} (${pct(m.top3, m.sent)} of forms)`);
  line("On a 1st to 4th choice", (m) => `${m.top4} (${pct(m.top4, m.sent)} of forms)`);
  line("Average choice, of those on a listed course", (m) => (m.meanRank === null ? "-" : m.meanRank.toFixed(2)));
  line("Preference points (the draft's second measure)", (m) => m.points);
  line("No form, placed", (m) => m.noFormPlaced);
  for (const r of ROUNDS) line(`Placed from a ${r} listing`, (m) => m.byRound[r]);
  if (school.past) {
    section("Last year");
    line("Got none last year, now on a 1st to 4th choice", (m) => `${m.owedTop4} of ${m.owed}`);
  }
  if (school.fit) {
    section("From their form");
    line("On a course they fit", (m) => m.fits);
    line("On a course they gave a limitation for", (m) => m.limits);
  }
  section("Rules the page checks");
  line("Broken rules, all", (m) => m.rules.length);
  for (const [code, label] of Object.entries(RULE)) {
    if (d.rules.some((p) => p.code === code) || o.rules.some((p) => p.code === code)) line(label, (m) => m.rules.filter((p) => p.code === code).length);
  }

  // Teacher by teacher.
  let same = 0, otherCourse = 0, draftOnly = 0, officeOnly = 0, draftBetter = 0, officeBetter = 0, level = 0;
  const rows = [["Teacher", "Email", "Draft course", "Draft choice", "Office course", "Office choice", "Same course", "Better choice"]];
  for (const t of teachers) {
    const a = draft.get(t.id) ?? null, b = office.get(t.id) ?? null;
    if (a && b) a === b ? same++ : otherCourse++;
    else if (a) draftOnly++;
    else if (b) officeOnly++;
    let better = "";
    if (t.submitted && !t.returning && (a || b) && a !== b) {
      const pa = a ? pointsOf(t, a) ?? 0 : 0, pb = b ? pointsOf(t, b) ?? 0 : 0;
      better = pa > pb ? "Draft" : pb > pa ? "Office" : "Same";
      better === "Draft" ? draftBetter++ : better === "Office" ? officeBetter++ : level++;
    }
    rows.push([t.name, t.email, a ?? "", CHOICE[d.choice.get(t.id)], b ?? "", CHOICE[o.choice.get(t.id)], !a && !b ? "" : a === b ? "Yes" : "No", better]);
  }
  section("Draft and office side by side");
  summary.push(["On the same course in both", same], ["Placed in both, on different courses", otherCourse],
    ["Placed in the draft only", draftOnly], ["Placed by the office only", officeOnly],
    ["Form, not returning, course differs: draft's is a better choice", draftBetter],
    ["Form, not returning, course differs: office's is a better choice", officeBetter],
    ["Form, not returning, course differs: as good either way", level]);

  // Draft's choice down the side, office's across the top.
  const keys = Object.keys(CHOICE);
  const cross = [["Draft \\ Office", ...keys.map((k) => CHOICE[k]), "All"]];
  for (const k of keys) {
    const ids = school.teachers.filter((t) => d.choice.get(t.id) === k);
    cross.push([CHOICE[k], ...keys.map((j) => ids.filter((t) => o.choice.get(t.id) === j).length), ids.length]);
  }
  cross.push(["All", ...keys.map((j) => school.teachers.filter((t) => o.choice.get(t.id) === j).length), school.teachers.length]);

  // Course by course.
  const name = new Map(school.teachers.map((t) => [t.id, t.name]));
  const on = (placed, cid) => [...placed].filter(([, c]) => c === cid).map(([t]) => t).sort((x, y) => name.get(x).localeCompare(name.get(y)));
  let alike = 0;
  const courses = [["Course Code", "Course Name", "Offered", "Seats", "Draft sponsors", "Office sponsors", "In both", "Same sponsors"]];
  for (const c of [...school.courses].sort((x, y) => x.id.localeCompare(y.id))) {
    const a = on(draft, c.id), b = on(office, c.id);
    const both = a.filter((t) => b.includes(t)).length;
    const alikeHere = a.length === b.length && both === a.length;
    if (alikeHere && a.length) alike++;
    courses.push([c.id, c.name, c.running ? "Yes" : "No", c.seats, a.map((t) => name.get(t)).join("; "), b.map((t) => name.get(t)).join("; "), both, alikeHere ? "Yes" : "No"]);
  }
  summary.push(["Courses with the same sponsors in both (someone on it)", alike]);

  return { summary, cross, teachers: rows, courses };
}
