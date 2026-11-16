// Writes the invented fit.xlsx from the invented answers in fixtures/school/. No model is involved: every row is a skill
// line tools/answers.mjs put in an answer, plus four rows the office might add or get wrong. Everything here is made up.
// Usage: node tools/make_fit.mjs [output folder, default fixtures/fit/]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBook, writeBook } from "../src/xlsx.js";
import { HEADERS, FIT } from "../src/import.js";
import { SKILL } from "./answers.mjs";

const school = new URL("../fixtures/school/", import.meta.url);
const out = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + "/") : new URL("../fixtures/fit/", import.meta.url);
const ANSWER = "Enhancing Learning or Safety";
const READ = { round1: "Round 1", singapore: "Singapore" }; // the forms with a written answer, in the order they are read

const rows = async (name) => (await readBook(new Uint8Array(await readFile(new URL(`${name}.xlsx`, school)))))[0].rows;
const courses = (await rows("courses")).slice(1).map(([code, name, , , offered, cert]) => ({ code, name, offered: offered === "Yes", cert: cert ?? "" }));
const staff = (await rows("staff")).slice(1).map(([email, , certs]) => ({ email, certs: String(certs ?? "").split(";").map((c) => c.trim()).filter(Boolean) }));
const returning = new Set((await rows("returning")).slice(1).map(([email]) => email));
const byEmail = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Every form row: the teacher's ranked course names, and their answer where the form has one.
const ranked = new Map();
const answers = []; // [{ email, form, answer }]
for (const form of ["round1", "round2", "singapore"]) {
  const [head, ...body] = await rows(form);
  const at = head.indexOf(ANSWER);
  for (const row of body) {
    const email = row[1];
    if (!ranked.has(email)) ranked.set(email, new Set());
    head.forEach((h, i) => { if (h.startsWith("Choice ") && row[i]) ranked.get(email).add(row[i]); });
    if (at >= 0 && row[at]) answers.push({ email, form: READ[form], answer: row[at] });
  }
}
answers.sort((a, b) => byEmail(a.email, b.email) || Object.values(READ).indexOf(a.form) - Object.values(READ).indexOf(b.form));

const lines = Object.entries(SKILL).flatMap(([activity, list]) => list.map((line) => ({ activity, line })));
// The longest course name in the sentence, so "Hawker Heritage" never shadows a longer name that ends with it.
const courseIn = (sentence) => courses.filter((c) => sentence.includes(c.name)).sort((a, b) => b.name.length - a.name.length)[0];
const sentences = (answer) => answer.split(/(?<=\.)\s+/);

// What the reader would find: one Experience row per sentence that names a course and holds a skill line.
const fit = [];
for (const { email, answer } of answers) {
  for (const s of sentences(answer)) {
    const skill = lines.find(({ line }) => s.includes(line));
    const course = courseIn(s);
    if (skill && course) fit.push([email, course.code, "Experience", skill.activity, skill.line]);
  }
}

const first = (list, what) => {
  if (!list.length) throw new Error(`no teacher for the ${what} row`);
  return list[0];
};
const said = (email) => answers.filter((a) => a.email === email).flatMap((a) => sentences(a.answer));
const emails = [...new Set(answers.map((a) => a.email))]; // already in email order
const has = (email, code) => fit.some((r) => r[0] === email && r[1] === code);

// 1. A general fact: the first aid line, tied to no course.
const FIRST_AID = "I hold a current first aid certificate and am calm in an emergency";
const aider = first(emails.filter((e) => said(e).some((s) => s.includes(FIRST_AID))), "general fact");
const general = [aider, "", "Certificate", "First aid", FIRST_AID];

// 2. A limitation the reader got wrong, on a ranked course the teacher has no other row for, so it is the only row there.
const BACK = "I am happy to be the teacher at the back of the group, watching the slower students";
const limitOn = (e) => courses.find((c) => ranked.get(e).has(c.name) && !has(e, c.code));
const limited = first(emails.filter((e) => said(e).some((s) => s.includes(BACK)) && limitOn(e)), "limitation");
const limitation = [limited, limitOn(limited).code, "Limitation", "Back of the group only", BACK];

// 3. The same skill on a course of the same kind that the teacher did not rank.
const elsewhere = (r) => courses.find((c) => c.offered && c.name.endsWith(r[3]) && !ranked.get(r[0]).has(c.name));
const seen = first(fit.filter((r) => elsewhere(r)), "unranked course");
const unranked = [seen[0], elsewhere(seen).code, "Experience", seen[3], seen[4]];

// 4. A row the office added, Quote blank, for a teacher with no form and no returning course.
const noForm = first(staff.filter((p) => !ranked.has(p.email) && !returning.has(p.email)).sort((a, b) => byEmail(a.email, b.email)), "office");
const course = first(courses.filter((c) => c.offered && (!c.cert || noForm.certs.includes(c.cert))), "office course");
const office = [noForm.email, course.code, "Experience", Object.keys(SKILL).find((a) => course.name.endsWith(a)) ?? "Led a school trip", ""];

const table = [...fit, general, limitation, unranked, office].sort((a, b) => byEmail(a[0], b[0]) || byEmail(a[1], b[1]));
const book = await writeBook([
  { name: "Fernhollow", rows: [HEADERS[FIT], ...table] },
  { name: "Answers", rows: [["Email", "Form", "Answer"], ...answers.map((a) => [a.email, a.form, a.answer])] },
], { modified: new Date(Date.UTC(2026, 10, 15)) }); // a fixed date, so the same answers give the same bytes
await mkdir(out, { recursive: true });
await writeFile(new URL(FIT, out), book);
console.log(`fit written: ${answers.length} answers read, ${fit.length} rows found, 4 rows added`);
