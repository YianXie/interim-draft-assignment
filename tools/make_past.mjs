// Writes last year's four invented Fernhollow files from a fixed seed. Everything here is made up.
// It reads this year's six files and reuses their people and course names; it adds no new ones.
// Usage: node tools/make_past.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readBook, writeBook } from "../src/xlsx.js";

const SEED = 20261113;
const NEW_STAFF = 8; // this year's staff who are in no past file
const NOT_FOUND = 1; // sent a form last year and are left off the allocation
const RETURNING_WITH_FORM = 3; // this year's returning sponsors who sent a form last year; the others sent none
// Sent a form last year and were given a course that was not on it. 10 is everyone whose 1st to 4th choices this year
// each have 19 or more people asking: the people a draft without last year's files tends to leave on a lower choice.
const UNLUCKY = 10;
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
const courses = (await rows("courses")).map(([code, name, type, seats, offered, needs]) => ({ code, name, type, seats, offered: offered === "Yes", needs, ran: true, sponsors: [] }));
const staff = (await rows("staff")).map(([email, name, certificates]) => ({ email, name, certificates: String(certificates ?? "").split(";").map((c) => c.trim()) }));
// This year's returning sponsors were on that course last year, whether or not it is offered again.
const ownCourse = new Map((await rows("returning")).map(([email, code]) => [email, courses.find((c) => c.code === code)]));
const fixed = new Map([...ownCourse].filter(([, c]) => c.offered)); // those fixed to their course in this year's draft

// This year's choice numbers: for each course, the rank on the earliest of Round 1, Round 2, Singapore that lists it.
const shownNow = new Map();
for (const form of ["round1", "round2", "singapore"]) {
  for (const [email, ...list] of await rows(form)) {
    if (!shownNow.has(email)) shownNow.set(email, new Map());
    list.forEach((name, i) => { if (name && !shownNow.get(email).has(name)) shownNow.get(email).set(name, i + 1); });
  }
}
// The 1st to 4th choices someone could be given this year: offered, not filled by returning sponsors, any certificate held.
const seatsLeft = courses.filter((c) => c.offered && [...fixed.values()].filter((own) => own === c).length < c.seats);
const top4Now = (p) => seatsLeft.filter((c) => shownNow.get(p.email).get(c.name) <= 4 && (!c.needs || p.certificates.includes(c.needs)));
const sendersNow = staff.filter((p) => shownNow.has(p.email) && !fixed.has(p.email));
const asked = new Map(seatsLeft.map((c) => [c, 0]));
for (const p of sendersNow) for (const c of top4Now(p)) asked.set(c, asked.get(c) + 1);

// Who gets none of their choices last year: of those who sent a form this year and are not returning sponsors, the ones
// whose 1st to 4th choices this year are all much-asked courses. The preference score alone tends to leave them on a
// lower choice or unplaced, so they are the people the new priority moves.
const crowd = (p) => Math.min(...top4Now(p).map((c) => asked.get(c)));
const queue = shuffle(staff);
const unlucky = queue.filter((p) => sendersNow.includes(p) && !ownCourse.has(p.email)).sort((a, b) => crowd(b) - crowd(a)).slice(0, UNLUCKY);
const returning = queue.filter((p) => ownCourse.has(p.email));
const rest = queue.filter((p) => !unlucky.includes(p) && !returning.includes(p));
const absent = rest.slice(0, NEW_STAFF + NOT_FOUND); // not on last year's allocation: the new staff, then those not found
const senders = [...unlucky, ...rest.slice(NEW_STAFF), ...returning.slice(0, RETURNING_WITH_FORM)];

// Last year's choices, skewed to a few popular courses. A returning sponsor who sent a form sent one, with their own course first.
const intCourses = courses.filter((c) => c.type === "International");
const sgCourses = courses.filter((c) => c.type === "Singapore");
const pop = () => 0.4 + Math.pow(rnd(), 2.2) * 9;
const intW = intCourses.map(pop), sgW = sgCourses.map(pop);
const r1 = [], r2 = [], sg = [];
const listed = new Map(); // email -> their courses, each once, in the order Round 1, Round 2, Singapore and by rank within a form
for (const p of shuffle(senders)) {
  const own = ownCourse.get(p.email);
  const forms = [];
  if (own) {
    const [file, picks] = own.type === "International" ? [r1, pickWeighted(intCourses, intW, 7)] : [sg, pickWeighted(sgCourses, sgW, 5)];
    forms.push([file, [own, ...picks.filter((c) => c !== own)].slice(0, picks.length)]);
  } else {
    if (rnd() < 0.85) forms.push([r1, pickWeighted(intCourses, intW, 7)]);
    if (rnd() < 0.35) forms.push([r2, pickWeighted(intCourses, intW, 3)]);
    if (rnd() < 0.6 || !forms.length) forms.push([sg, pickWeighted(sgCourses, sgW, 5)]);
  }
  for (const [file, picks] of forms) file.push([p.email, ...picks.map((c) => c.name)]);
  listed.set(p.email, [...new Set(forms.flatMap(([, picks]) => picks))]);
}
const wanted = new Map(courses.map((c) => [c, 0]));
for (const list of listed.values()) for (const course of list) wanted.set(course, wanted.get(course) + 1);
const mostAsked = [...courses].sort((a, b) => wanted.get(b) - wanted.get(a));

// Seats last year are this year's. Returning sponsors are seated first, then anyone else who holds a certificate a course needs.
const seated = new Set();
const seat = (p, c) => { c.sponsors.push(p.name); seated.add(p); };
const free = (c, p) => c.ran && c.sponsors.length < c.seats && (!c.needs || p.certificates.includes(c.needs));
for (const p of returning) seat(p, ownCourse.get(p.email));
for (const c of courses.filter((c) => c.needs)) {
  for (const p of queue) if (!seated.has(p) && !absent.includes(p) && free(c, p)) seat(p, c);
}

// The least-asked courses did not run, as many as leaves every other course full. A course is passed over when taking
// it would leave a single seat over, since no course has just one. A seat that needs a certificate nobody else holds
// stays empty.
const left = { name: LEFT, certificates: [] };
const toSeat = staff.length - absent.length - seated.size + 1; // the 1 is the sponsor who left
let spare = courses.filter((c) => !c.needs).reduce((n, c) => n + c.seats - c.sponsors.length, 0) - toSeat;
for (const c of mostAsked.filter((c) => !c.needs && !c.sponsors.length).reverse()) {
  if (c.seats <= spare && spare - c.seats !== 1) { c.ran = false; spare -= c.seats; }
}
if (spare) throw new Error("the courses that did not run leave a seat over: change the numbers at the top");

// Then everyone else by their past choices, a simple fill: walk the people, those with the fewest courses listed first
// (they have the least to fall back on) and otherwise in seeded order, and give each the first course on their forms
// with a free seat, Round 1 before Round 2 before Singapore. The unlucky, and anyone whose listed courses are all full,
// then get the most-asked course with a free seat that is not on their form, and the sponsor who left takes the last seat.
const leftOver = [...unlucky];
const walk = queue.filter((p) => senders.includes(p) && !seated.has(p) && !absent.includes(p) && !unlucky.includes(p));
for (const p of walk.sort((a, b) => listed.get(a.email).length - listed.get(b.email).length)) {
  const course = listed.get(p.email).find((c) => free(c, p));
  if (course) seat(p, course);
  else leftOver.push(p);
}
for (const p of [...leftOver, left]) {
  const course = mostAsked.find((c) => free(c, p) && !(listed.get(p.email) ?? []).includes(c));
  if (!course) throw new Error("no free seat off their form left for someone: change the numbers at the top");
  seat(p, course);
}

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

// Every count below is counted from the tables just written.
const entries = files["past-allocation"].slice(1).flatMap(([, course, ...sponsors]) => sponsors.map((who) => [who, course]));
const placedOn = new Map(entries);
const ranks = new Map(); // email -> course name -> its ranks, in the order Round 1, Round 2, Singapore
for (const form of ["past-round1", "past-round2", "past-singapore"]) {
  for (const [email, ...list] of files[form].slice(1)) {
    if (!ranks.has(email)) ranks.set(email, new Map());
    list.forEach((name, i) => ranks.get(email).set(name, [...(ranks.get(email).get(name) ?? []), i + 1]));
  }
}
const count = { noRecord: 0, top4: 0, "5to7": 0, none: 0, noForm: 0, notFound: 0, owed: 0, twoForms: 0, byRule: 0 };
for (const p of staff) {
  const mine = ranks.get(p.email), course = placedOn.get(p.name);
  const [first, ...later] = mine?.get(course) ?? [];
  const result = !mine ? (course ? "noForm" : "noRecord") : !course ? "notFound" : !first ? "none" : first <= 4 ? "top4" : "5to7";
  count[result]++;
  if (result === "none" && sendersNow.includes(p)) count.owed++;
  if (mine && [...mine.values()].some((r) => r.length > 1)) count.twoForms++;
  if (first >= 5 && later.some((rank) => rank <= 4)) count.byRule++;
}
const sponsorsOf = new Map(files["past-allocation"].slice(1).map(([code, , ...sponsors]) => [code, sponsors]));
const under = courses.filter((c) => (sponsorsOf.get(c.code) ?? []).length < c.seats);
console.log(`past year written: ${files["past-allocation"].length - 1} courses, ${entries.length} sponsor entries, ${entries.filter(([who]) => who === LEFT).length} of them "${LEFT}"`);
console.log(`courses under their seats ${under.length}, of which did not run ${under.filter((c) => !sponsorsOf.has(c.code)).length}`);
console.log(`no past record ${count.noRecord}, top4 ${count.top4}, 5to7 ${count["5to7"]}, none ${count.none}, noForm ${count.noForm}, notFound ${count.notFound}`);
console.log(`none with a form this year and not a returning sponsor ${count.owed}, people with a course on two past forms ${count.twoForms}, 5to7 only by the earliest-form rule ${count.byRule}`);
