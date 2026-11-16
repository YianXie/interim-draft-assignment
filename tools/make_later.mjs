// Writes fixtures/later/kept.json: the draft solved from the four needed files (courses, staff, returning, round1),
// by email and course code, with three changes that break rules, as the office might make before adding Round 2 and
// Singapore forms. Every choice is made by email and course code, never by T number, so the file is the same each run.
// Usage: node tools/make_later.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseFiles, readForms, LATER, SLOTS } from "../src/import.js";
import { loadHighs, solveDraft } from "../src/solver.js";

const dir = new URL("../fixtures/school/", import.meta.url);
const out = new URL("../fixtures/later/", import.meta.url);
const fixture = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) });
const byEmail = (a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0);
const byCode = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

let i = 0;
const base = (await parseFiles(await Promise.all(SLOTS.filter((n) => !LATER.includes(n)).map(fixture)), (n) => i++ % n)).school;
const solved = solveDraft(await loadHighs({}), base);
if (solved.status !== "Optimal") throw new Error(`four-file solve: ${solved.status}`);
// Choices "listed" below are on any of the three forms, so the moved sponsor listed the new course on none.
const later = (await readForms(base, await Promise.all(LATER.map(fixture)))).school;

const email = new Map(base.teachers.map((t) => [t.id, t.email]));
const kept = new Map(solved.pairs.map(([t, c]) => [email.get(t), c])); // email -> course
const teachers = [...later.teachers].sort(byEmail);
const courses = [...later.courses].filter((c) => c.running).sort(byCode);
const count = (code) => [...kept.values()].filter((c) => c === code).length;
const free = () => teachers.filter((t) => !kept.has(t.email));
const listed = (t, code) => t.prefs.some((p) => p.course === code);

// 1. One course over its seats: the first full course without a certificate gets the first free teacher.
const full = courses.find((c) => !c.needs && count(c.id) === c.seats);
const extra = free()[0];
kept.set(extra.email, full.id);
// 2. A teacher without the certificate on the first course that needs one: the first free teacher who lacks it.
const certCourse = courses.find((c) => c.needs);
const noCert = free().find((t) => !t.certificates.includes(certCourse.needs));
kept.set(noCert.email, certCourse.id);
// 3. The first returning sponsor on their own course moves to the first course with room, needing no certificate,
// that they listed on no form.
const sponsor = teachers.find((t) => t.returning && kept.get(t.email) === t.returningCourse);
const elsewhere = courses.find((c) => !c.needs && c.id !== sponsor.returningCourse && c.id !== full.id && count(c.id) < c.seats && !listed(sponsor, c.id));
kept.set(sponsor.email, elsewhere.id);

const rows = [...kept].map(([e, course]) => ({ email: e, course })).sort(byEmail);
await mkdir(out, { recursive: true });
await writeFile(new URL("kept.json", out), JSON.stringify(rows, null, 2) + "\n");
console.log(`kept ${rows.length}: ${extra.email} over seats on ${full.id}, ${noCert.email} without ${certCourse.needs} on ${certCourse.id}, sponsor ${sponsor.email} moved ${sponsor.returningCourse} -> ${elsewhere.id}`);
