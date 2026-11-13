// Writes last year's four invented Fernhollow files from a fixed seed. Everything here is made up.
// It reads this year's six files and reuses their people and course names; it adds no new ones.
// Usage: node tools/make_past.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readBook, writeBook } from "../src/xlsx.js";

const SEED = 20261113;
const NEW_STAFF = 8; // this year's staff who are in no past file
const NO_FORM = 6; // placed last year without sending a form
// Sent a form last year and were given a course that was not on it. 45 is everyone whose 1st to 4th choices this year
// each have 11 or more people asking. With far fewer, all of them can be given a top-4 choice this year and nothing is tested.
const UNLUCKY = 45;
const LEFT = "Sponsor who left"; // a label, not a person: the one allocation entry that matches nobody
const school = new URL("../fixtures/school/", import.meta.url);
const out = new URL("../fixtures/past/", import.meta.url);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickWeighted(items, weights, k) {
  const pool = items.map((it, i) => ({ it, w: weights[i] }));
  const got = [];
  while (got.length < k && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rnd() * total, i = 0;
    while (r >= pool[i].w && i < pool.length - 1) { r -= pool[i].w; i++; }
    got.push(pool.splice(i, 1)[0].it);
  }
  return got;
}

// This year's six files, without their header rows.
async function rows(name) {
  const [sheet] = await readBook(new Uint8Array(await readFile(new URL(`${name}.xlsx`, school))));
  return sheet.rows.slice(1);
}
const courses = (await rows("courses")).map(([code, name, type, seats, offered, needs]) => ({ code, name, type, seats, offered: offered === "Yes", needs, sponsors: [] }));
const staff = (await rows("staff")).map(([email, name, certificates]) => ({ email, name, certificates: String(certificates ?? "").split(";").map((c) => c.trim()) }));
const returning = (await rows("returning")).filter(([, code]) => courses.find((c) => c.code === code).offered);
const fixed = new Set(returning.map(([email]) => email));

// This year's choice numbers: for each course, the rank on the earliest of Round 1, Round 2, Singapore that lists it.
const shownNow = new Map();
for (const form of ["round1", "round2", "singapore"]) {
  for (const [email, ...list] of await rows(form)) {
    if (!shownNow.has(email)) shownNow.set(email, new Map());
    list.forEach((name, i) => { if (name && !shownNow.get(email).has(name)) shownNow.get(email).set(name, i + 1); });
  }
}
// The 1st to 4th choices someone could be given this year: offered, not filled by returning sponsors, any certificate held.
const seatsLeft = courses.filter((c) => c.offered && returning.filter(([, code]) => code === c.code).length < c.seats);
const top4Now = (p) => seatsLeft.filter((c) => shownNow.get(p.email).get(c.name) <= 4 && (!c.needs || p.certificates.includes(c.needs)));
const sendersNow = staff.filter((p) => shownNow.has(p.email) && !fixed.has(p.email));
const asked = new Map(seatsLeft.map((c) => [c, 0]));
for (const p of sendersNow) for (const c of top4Now(p)) asked.set(c, asked.get(c) + 1);

// Who gets none of their choices last year: of those who sent a form this year and are not fixed as returning sponsors,
// the ones whose 1st to 4th choices this year are all much-asked courses, so that this year they compete for the same seats.
const crowd = (p) => Math.min(...top4Now(p).map((c) => asked.get(c)));
const queue = shuffle(staff);
const unlucky = queue.filter((p) => sendersNow.includes(p)).sort((a, b) => crowd(b) - crowd(a)).slice(0, UNLUCKY);
const rest = queue.filter((p) => !unlucky.includes(p));
const newStaff = rest.slice(0, NEW_STAFF);
const noForm = rest.slice(NEW_STAFF, NEW_STAFF + NO_FORM);
const notFound = rest[NEW_STAFF + NO_FORM]; // sends a form, and is left off the allocation
const senders = [...unlucky, ...rest.slice(NEW_STAFF + NO_FORM)];

// Last year's choices, skewed to a few popular courses.
const intCourses = courses.filter((c) => c.type === "International");
const sgCourses = courses.filter((c) => c.type === "Singapore");
const pop = () => 0.4 + Math.pow(rnd(), 2.2) * 9;
const intW = intCourses.map(pop), sgW = sgCourses.map(pop);
const r1 = [], r2 = [], sg = [];
const listed = new Map(); // email -> [{ course, rank }], each course once with the rank on the earliest form, best rank first
let twoForms = 0;
for (const p of shuffle(senders)) {
  const forms = [];
  if (rnd() < 0.85) forms.push([r1, pickWeighted(intCourses, intW, 7)]);
  if (rnd() < 0.35) forms.push([r2, pickWeighted(intCourses, intW, 3)]);
  if (rnd() < 0.6 || !forms.length) forms.push([sg, pickWeighted(sgCourses, sgW, 5)]);
  const shown = [];
  let twice = false;
  for (const [file, picks] of forms) {
    file.push([p.email, ...picks.map((c) => c.name)]);
    picks.forEach((course, i) => {
      if (shown.some((s) => s.course === course)) twice = true;
      else shown.push({ course, rank: i + 1 });
    });
  }
  if (twice) twoForms++;
  listed.set(p.email, shown.sort((a, b) => a.rank - b.rank));
}

// Last year's allocation, by a simple fill: walk the people in seeded order and give each their best-listed course with a
// free seat. The unlucky, those who sent no form, and anyone whose listed courses are all full get the most-asked course
// with a free seat that is not on their form.
const wanted = new Map(courses.map((c) => [c, 0]));
for (const list of listed.values()) for (const { course } of list) wanted.set(course, wanted.get(course) + 1);
const mostAsked = [...courses].sort((a, b) => wanted.get(b) - wanted.get(a));
const free = (c) => c.sponsors.length < c.seats;
const counts = { top4: 0, "5to7": 0, none: 0, noForm: 0, notFound: 1 };
let owed = 0;
for (const p of shuffle([...senders, ...noForm])) {
  if (p === notFound) continue;
  const list = listed.get(p.email) ?? [];
  const best = unlucky.includes(p) ? undefined : list.find((s) => free(s.course));
  const course = best ? best.course : mostAsked.find((c) => free(c) && !list.some((s) => s.course === c));
  if (!course) throw new Error("no free seat left for someone: change the numbers at the top");
  course.sponsors.push(p.name);
  const result = !list.length ? "noForm" : !best ? "none" : best.rank <= 4 ? "top4" : "5to7";
  counts[result]++;
  if (result === "none" && sendersNow.includes(p)) owed++;
}
mostAsked.find(free).sponsors.push(LEFT);

const ran = courses.filter((c) => c.sponsors.length);
const most = Math.max(...ran.map((c) => c.sponsors.length));
const H = (word, n) => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`);
const files = {
  "past-allocation": [["Course Code", "Course Name", ...H("Sponsor", most)], ...ran.map((c) => [c.code, c.name, ...c.sponsors])],
  "past-round1": [["Email", ...H("Choice", 7)], ...r1],
  "past-round2": [["Email", ...H("Choice", 3)], ...r2],
  "past-singapore": [["Email", ...H("Choice", 5)], ...sg],
};
await mkdir(out, { recursive: true });
for (const [name, table] of Object.entries(files)) await writeFile(new URL(`${name}.xlsx`, out), await writeBook([{ name: "Fernhollow", rows: table }]));
console.log(`past year written: ${ran.length} courses, ${ran.reduce((n, c) => n + c.sponsors.length, 0)} sponsor entries, 1 of them "${LEFT}"`);
console.log(`no past record ${newStaff.length}, top4 ${counts.top4}, 5to7 ${counts["5to7"]}, none ${counts.none}, noForm ${counts.noForm}, notFound ${counts.notFound}`);
console.log(`none with a form this year and not a returning sponsor ${owed}, people with a course on two past forms ${twoForms}`);
