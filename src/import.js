// Reads the six workbooks, and last year's four when they are added, into a School.
// Runs in the browser and in Node, so it imports no Node modules.
import { readBook } from "./xlsx.js";
import { PAST_SLOTS, PAST_FORMS, normName, lastYearResults } from "./past.js";

export { PAST_SLOTS };

export const SLOTS = ["courses.xlsx", "staff.xlsx", "returning.xlsx", "round1.xlsx", "round2.xlsx", "singapore.xlsx"];
const SHEET = "Fernhollow";
const DOMAIN = "@fernhollow.example";
const choices = (n) => Array.from({ length: n }, (_, i) => `Choice ${i + 1}`);
const HEADERS = {
  "courses.xlsx": ["Course Code", "Course Name", "Type", "Seats", "Offered", "Certificate"],
  "staff.xlsx": ["Email", "Name", "Certificates"],
  "returning.xlsx": ["Email", "Course Code"],
  "round1.xlsx": ["Email", ...choices(7)],
  "round2.xlsx": ["Email", ...choices(3)],
  "singapore.xlsx": ["Email", ...choices(5)],
  "past-round1.xlsx": ["Email", ...choices(7)],
  "past-round2.xlsx": ["Email", ...choices(3)],
  "past-singapore.xlsx": ["Email", ...choices(5)],
};
const ALLOCATION = PAST_SLOTS[0];
const FORMS = { "round1.xlsx": "Round 1", "round2.xlsx": "Round 2", "singapore.xlsx": "Singapore" };

// random(n) returns a whole number from 0 to n - 1.
export function secureRandom(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

class Refusal extends Error {}
const refuse = (file, row, problem) => {
  throw new Refusal(row ? `${file}, row ${row}: ${problem}` : `${file}: ${problem}`);
};
const blank = (v) => v === null || v === undefined || String(v).trim() === "";
const text = (v) => (blank(v) ? "" : String(v).trim());
const normEmail = (v) => text(v).toLowerCase();

// The header row a file must have. Last year's allocation has as many Sponsor columns as it needs, from one up.
function headerRow(file, head) {
  if (file !== ALLOCATION) return HEADERS[file];
  const last = head.reduce((at, h, i) => (blank(h) ? at : i), 0);
  return ["Course Code", "Course Name", ...Array.from({ length: Math.max(1, last - 1) }, (_, i) => `Sponsor ${i + 1}`)];
}

// Checks sheet name and headers, returns [{ n, cells }] for non-empty rows, n being the sheet row number.
// In a past file a value under no header refuses the row: a sponsor typed one column too far would otherwise be lost.
async function table(file, bytes) {
  let book;
  try {
    book = await readBook(bytes);
  } catch {
    refuse(file, 0, "not a readable .xlsx file");
  }
  if (!book.length || book[0].name !== SHEET) refuse(file, 0, `first sheet must be named ${SHEET}`);
  const [head = [], ...rest] = book[0].rows;
  const want = headerRow(file, head);
  if (want.some((h, i) => head[i] !== h) || head.slice(want.length).some((h) => !blank(h))) {
    const list = file === ALLOCATION ? "Course Code, Course Name, Sponsor 1, Sponsor 2, and so on" : want.join(", ");
    refuse(file, 1, `headers must be exactly: ${list}`);
  }
  const rows = rest.map((cells, i) => ({ n: i + 2, cells })).filter((r) => r.cells.some((c) => !blank(c)));
  if (PAST_SLOTS.includes(file)) {
    for (const r of rows) if (r.cells.slice(want.length).some((c) => !blank(c))) refuse(file, r.n, "value outside the headed columns");
  }
  return rows;
}

function email(file, r, seen) {
  const e = normEmail(r.cells[0]);
  if (!e) refuse(file, r.n, "email is empty");
  if (!e.endsWith(DOMAIN) || e.length === DOMAIN.length) refuse(file, r.n, "email is not on fernhollow.example");
  if (seen.has(e)) refuse(file, r.n, "email appears twice in this file");
  seen.add(e);
  return e;
}

function readCourses(file, rows) {
  const courses = [];
  const codes = new Set();
  const names = new Set();
  for (const r of rows) {
    const [code, name, type, seats, offered, cert] = r.cells;
    const id = text(code);
    if (!id) refuse(file, r.n, "course code is empty");
    if (codes.has(id)) refuse(file, r.n, "course code appears twice");
    if (!text(name)) refuse(file, r.n, "course name is empty");
    if (names.has(text(name))) refuse(file, r.n, "course name appears twice");
    if (type !== "International" && type !== "Singapore") refuse(file, r.n, "type must be International or Singapore");
    if (typeof seats !== "number" || !Number.isInteger(seats) || seats < 1) refuse(file, r.n, "seats must be a positive whole number");
    if (offered !== "Yes" && offered !== "No") refuse(file, r.n, "offered must be Yes or No");
    codes.add(id);
    names.add(text(name));
    courses.push({ id, name: text(name), kind: type, seats, running: offered === "Yes", needs: text(cert) || null });
  }
  return courses;
}

function readStaff(file, rows) {
  const seen = new Set();
  return rows.map((r) => {
    const e = email(file, r, seen);
    if (!text(r.cells[1])) refuse(file, r.n, "name is empty");
    const certificates = text(r.cells[2]).split(";").map((c) => c.trim()).filter(Boolean);
    return { n: r.n, email: e, name: text(r.cells[1]), certificates };
  });
}

function readEmailRows(file, rows) {
  const seen = new Set();
  return rows.map((r) => ({ n: r.n, email: email(file, r, seen), cells: r.cells.slice(1) }));
}

// Last year's allocation: [{ n, course, sponsors }], course being the Course Name and sponsors the names as written.
function readPastAllocation(file, rows) {
  const codes = new Set();
  const names = new Set();
  return rows.map((r) => {
    const [code, name, ...entries] = r.cells.map(text);
    if (!code) refuse(file, r.n, "course code is empty");
    if (codes.has(code)) refuse(file, r.n, "course code appears twice");
    if (!name) refuse(file, r.n, "course name is empty");
    if (names.has(name)) refuse(file, r.n, "course name appears twice");
    codes.add(code);
    names.add(name);
    return { n: r.n, course: name, sponsors: entries.filter(Boolean) };
  });
}

// One person on two of last year's courses refuses the file. A sponsor entry is one person only when exactly one of
// this year's staff has that name; an entry that matches nobody, or two people, is counted as not matched however often it is written.
function oncePerPerson(file, allocation, staff) {
  const holders = new Map();
  for (const s of staff) holders.set(normName(s.name), (holders.get(normName(s.name)) || 0) + 1);
  const seen = new Set();
  for (const { n, sponsors } of allocation) {
    for (const entry of sponsors) {
      const name = normName(entry);
      if (holders.get(name) !== 1) continue;
      if (seen.has(name)) refuse(file, n, "sponsor appears twice in this file");
      seen.add(name);
    }
  }
}

const SECTION = (file, fn) => async (bytes) => {
  try {
    return { ok: true, data: fn(file, await table(file, bytes)) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, problem: e.message };
    throw e;
  }
};

export async function parseFiles(files, random = secureRandom) {
  const slots = {};
  const bytesOf = {};
  for (const f of files) {
    if (SLOTS.includes(f.name) || PAST_SLOTS.includes(f.name)) bytesOf[f.name] = f.bytes;
    else slots[f.name] = `${f.name}: not one of the six file names`;
  }
  // Last year's files are optional: all four or none. They come after the six, so staff.xlsx is read first.
  const past = PAST_SLOTS.some((file) => file in bytesOf);
  const wanted = past ? [...SLOTS, ...PAST_SLOTS] : SLOTS;
  const got = {};
  for (const file of wanted) {
    if (!bytesOf[file]) {
      slots[file] = `${file}: file not added`;
      continue;
    }
    const fn = file === "courses.xlsx" ? readCourses
      : file === "staff.xlsx" ? readStaff
      : file === ALLOCATION ? readPastAllocation
      : readEmailRows;
    const res = await SECTION(file, fn)(bytesOf[file]);
    if (res.ok) got[file] = res.data;
    else slots[file] = res.problem;
  }

  // Cross-file checks, only against files that read cleanly on their own. Last year's files are not held to this year's
  // lists: a past course is compared only with last year's allocation, and a past email may belong to someone who left.
  // Their one check against another file, one person written twice on the allocation, comes after this loop.
  const courses = got["courses.xlsx"];
  const staff = got["staff.xlsx"];
  const byId = courses && new Map(courses.map((c) => [c.id, c]));
  const byName = courses && new Map(courses.map((c) => [c.name, c]));
  const onStaff = staff && new Set(staff.map((s) => s.email));
  for (const file of SLOTS.slice(2)) {
    const rows = got[file];
    if (!rows) continue;
    try {
      for (const r of rows) {
        if (onStaff && !onStaff.has(r.email)) refuse(file, r.n, "email is not on the staff list");
        if (!courses) continue;
        if (file === "returning.xlsx") {
          if (!byId.has(text(r.cells[0]))) refuse(file, r.n, "course code is not on the course list");
        } else {
          r.cells.forEach((c, i) => {
            if (!blank(c) && !byName.has(text(c))) refuse(file, r.n, `Choice ${i + 1} is not on the course list`);
          });
        }
      }
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      slots[file] = e.message;
      delete got[file];
    }
  }

  if (got[ALLOCATION] && staff) {
    try {
      oncePerPerson(ALLOCATION, got[ALLOCATION], staff);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      slots[ALLOCATION] = e.message;
      delete got[ALLOCATION];
    }
  }

  for (const file of wanted) if (got[file] && !slots[file]) slots[file] = "ready";
  if (Object.values(slots).some((v) => v !== "ready")) {
    return { school: null, slots };
  }

  // T numbers: T100..T999, each used once, drawn from the random source.
  const pool = Array.from({ length: 900 }, (_, i) => i + 100);
  if (staff.length > pool.length) {
    slots["staff.xlsx"] = "staff.xlsx: more than 900 people";
    return { school: null, slots };
  }
  const teachers = new Map();
  for (const s of staff) {
    const j = random(pool.length);
    const id = `T${pool[j]}`;
    pool[j] = pool[pool.length - 1];
    pool.pop();
    teachers.set(s.email, {
      id, name: s.name, email: s.email, returning: false, returningCourse: null,
      submitted: false, certificates: s.certificates, prefs: [],
    });
  }
  for (const r of got["returning.xlsx"]) {
    const c = byId.get(text(r.cells[0]));
    if (!c.running) continue; // a not-offered course: treated like anyone else
    const t = teachers.get(r.email);
    t.returning = true;
    t.returningCourse = c.id;
  }
  for (const [file, round] of Object.entries(FORMS)) {
    for (const r of got[file]) {
      const t = teachers.get(r.email);
      t.submitted = true;
      r.cells.forEach((c, i) => {
        if (!blank(c)) t.prefs.push({ course: byName.get(text(c)).id, rank: i + 1, round });
      });
    }
  }
  const school = { school: "Fernhollow Academy", year: "Interim 2028", courses, teachers: [...teachers.values()] };
  if (past) {
    // A past choice is the allocation's course whatever its letter case or spacing. Nothing is shown from these names.
    const allocation = got[ALLOCATION].map((a) => ({ course: normName(a.course), sponsors: a.sponsors }));
    const forms = [];
    const sent = [];
    for (const [file, round] of Object.entries(PAST_FORMS)) {
      for (const r of got[file]) {
        sent.push(r.email);
        r.cells.forEach((c, i) => {
          if (!blank(c)) forms.push({ email: r.email, course: normName(c), rank: i + 1, round });
        });
      }
    }
    const { byEmail, unmatched } = lastYearResults({ allocation, forms, staff, sent });
    for (const t of school.teachers) t.lastYear = byEmail.get(t.email) ?? null;
    school.past = { unmatched };
  }
  return { school, slots };
}
