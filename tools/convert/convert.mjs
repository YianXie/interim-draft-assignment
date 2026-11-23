// Turns the office's raw workbooks (as row arrays, header first) into the rows of the six files the page reads,
// with one report line for everything it could not settle. It never guesses: an unmatched course or name is left
// blank or as written and reported. Columns are found by key words, so the forms' own wording is not written here.
import { HEADERS } from "../../src/import.js";
import { norm, cleanEmail, courseIndex, nameKeys, findColumn, marker, stripMarker, role } from "./match.mjs";

// allocation.xlsx is optional for the six: an upcoming year has no final allocation yet. For last year's four (past)
// it is the one file that says who went where, and the returning list is not needed.
export const REQUIRED = ["courses.xlsx", "returning.xlsx", "round1.xlsx"];
export const PAST_REQUIRED = ["courses.xlsx", "round1.xlsx", "allocation.xlsx"];
export const OPTIONAL = ["allocation.xlsx", "returning.xlsx", "round2.xlsx", "singapore.xlsx"];
const FORMS = ["round1.xlsx", "round2.xlsx", "singapore.xlsx"];
const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
// Key words for each written-answer column the page expects, by the page's header.
const ANSWER_WORDS = {
  "Enhancing Learning or Safety": ["enhance"],
  "Notable Priorities": ["priorit"],
  "Final Questions or Comments": ["final"],
  "Additional Comments or Questions": ["additional"],
};

const blank = (v) => v === null || v === undefined || String(v).trim() === "";
const text = (v) => (blank(v) ? "" : String(v).trim());
// A text timestamp is read only in year-first form; "01/04/2031" could be either month, so it counts as unreadable.
const time = (v) => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const t = text(v);
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(t) ? Date.parse(t.replace(" ", "T")) : NaN;
};

function column(file, head, words, label) {
  const at = findColumn(head, words);
  if (at < 0) throw new Error(`${file}: no column for ${label} (looked for a header with "${words.join('" and "')}")`);
  return at;
}

// Body rows with their sheet row number (header = row 1), blank rows left out.
const body = (rows) => rows.slice(1).map((cells, i) => ({ n: i + 2, cells })).filter((r) => r.cells.some((c) => !blank(c)));

// past: write last year's four files (past-allocation.xlsx and the three past forms) instead of the six.
export function convert(raw, { past = false } = {}) {
  for (const file of past ? PAST_REQUIRED : REQUIRED) if (!raw[file]) throw new Error(`${file}: not found`);
  const report = [];
  const email = (file, n, v) => {
    const e = cleanEmail(v);
    if (!e) report.push(`${file}, row ${n}: email "${text(v)}" is not one address; row left out`);
    return e;
  };

  // Courses, with code and seats from the allocation. A course marked (FEMALE) or (MALE) is listed once for a check.
  const marked = new Map();
  const mark = (name, raw) => marker(raw) && !marked.has(name) && marked.set(name, marker(raw));
  const ch = raw["courses.xlsx"][0] ?? [];
  const at = {
    name: column("courses.xlsx", ch, ["course", "name"], "Course Name"),
    vendor: column("courses.xlsx", ch, ["vendor"], "Vendor"),
    city: column("courses.xlsx", ch, ["city"], "Arrival City"),
    country: column("courses.xlsx", ch, ["country"], "Country"),
  };
  // Without the allocation, a Code and a Seats column in courses.xlsx are read when it has them.
  const own = raw["allocation.xlsx"] ? null : { code: findColumn(ch, ["code"]), seats: findColumn(ch, ["seat"]) };
  const seatsOf = (v) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : /^\d+$/.test(text(v)) && Number(text(v)) > 0 ? Number(text(v)) : null);
  const courses = body(raw["courses.xlsx"]).map(({ cells }) => {
    const name = stripMarker(cells[at.name]);
    mark(name, cells[at.name]);
    return { name, vendor: text(cells[at.vendor]), city: text(cells[at.city]), country: text(cells[at.country]),
      code: own && own.code >= 0 ? text(cells[own.code]) : "", seats: own && own.seats >= 0 ? seatsOf(cells[own.seats]) : null };
  });
  let index = courseIndex(courses);
  const ran = []; // the allocation's rows, in order: { code, course, names }
  if (own) {
    report.push("no allocation.xlsx: every course is offered, Singapore courses come only from courses.xlsx, and staff names are left blank");
    const noCode = courses.filter((c) => !c.code);
    if (own.code < 0) report.push(`courses.xlsx: no Course Code column, so all ${courses.length} codes are blank; fill them in`);
    else for (const c of noCode) report.push(`courses.xlsx: "${c.name}" has no course code; fill it in`);
    if (own.seats < 0) report.push("courses.xlsx: no Seats column, so every course has 2 seats; check them");
    else for (const c of courses.filter((x) => x.seats === null)) report.push(`courses.xlsx: "${c.name}" has no seats number, so it has 2; check it`);
  }

  const sponsors = [];
  const added = [];
  if (raw["allocation.xlsx"]) {
    const ah = raw["allocation.xlsx"][0] ?? [];
    const aCode = column("allocation.xlsx", ah, ["code"], "Trip Code");
    const aName = column("allocation.xlsx", ah, ["course", "name"], "Course Name");
    const aSponsors = ah.map((h, i) => (norm(h).includes("sponsor") ? i : -1)).filter((i) => i >= 0);
    if (!aSponsors.length) throw new Error(`allocation.xlsx: no column for Sponsor 1 (looked for a header with "sponsor")`);
    for (const { n, cells } of body(raw["allocation.xlsx"])) {
      const code = text(cells[aCode]);
      let name = text(cells[aName]);
      if (code && norm(name).startsWith(norm(code))) name = name.slice(code.length).replace(/^[\s—–:-]+/, "");
      const names = aSponsors.map((i) => text(cells[i])).filter(Boolean);
      sponsors.push(...names.map((full) => ({ n, full })));
      let c = index.find(name);
      if (!c && (c = index.near(name, { words: false }))) report.push(`allocation.xlsx, row ${n}: "${name}" taken as "${c.name}", the closest name in courses.xlsx; check it`);
      if (!c) {
        // Singapore courses are on the allocation only.
        c = { name: stripMarker(name), vendor: "", city: "", country: "Singapore", code: "", seats: null };
        courses.push(c);
        added.push(c.name);
        index = courseIndex(courses);
      }
      mark(c.name, name);
      if (c.code) {
        report.push(`allocation.xlsx, row ${n}: "${c.name}" is on the allocation twice; the first row is used`);
        continue;
      }
      c.code = code;
      c.seats = names.length || null;
      ran.push({ code, course: c, names });
    }
  }
  if (added.length) report.push(`allocation.xlsx: ${added.length} course${added.length > 1 ? "s are" : " is"} not in courses.xlsx, so added as Singapore: ${added.join(", ")}; check each is a Singapore course`);
  for (const name of index.duplicates) report.push(`courses.xlsx: two courses have the same name "${name}"; the page needs each name once`);
  // A course not on the final allocation did not run: Offered No, with a NOTRUN-n code no other course uses.
  const codes = new Set(courses.map((c) => c.code).filter(Boolean));
  let next = 1;
  for (const c of own ? [] : courses.filter((c) => !c.code)) {
    while (codes.has(`NOTRUN-${next}`)) next++;
    c.code = `NOTRUN-${next}`;
    c.offered = "No";
    codes.add(c.code);
    if (!past) report.push(`courses.xlsx: "${c.name}" is not on the allocation, so it is marked not offered as ${c.code}`);
  }

  const files = {};
  files["courses.xlsx"] = [HEADERS["courses.xlsx"], ...courses.map((c) => [
    c.code, c.name, norm(c.country) === "singapore" ? "Singapore" : "International", c.seats ?? 2, c.offered ?? "Yes", "", c.country, c.city, c.vendor,
  ])];

  // Forms: page column order, choices written as the course name, latest repeat kept.
  for (const file of FORMS) {
    if (!raw[file]) continue;
    const head = raw[file][0] ?? [];
    const want = HEADERS[file];
    const nChoices = want.filter((h) => h.startsWith("Choice ")).length;
    const ts = column(file, head, ["timestamp"], "Timestamp");
    const em = column(file, head, ["email"], "Email");
    const choiceAt = ORDINAL.slice(0, nChoices).map((o, i) => column(file, head, [o, "preference"], `Choice ${i + 1}`));
    const answers = want.slice(2 + nChoices);
    const answerAt = answers.map((h) => column(file, head, ANSWER_WORDS[h], h));
    const kept = new Map(); // email → { n, row, t }
    for (const { n, cells } of body(raw[file])) {
      const e = email(file, n, cells[em]);
      if (!e) continue;
      // A role is not a course: it is listed and taken out, and the later choices move up.
      const picked = choiceAt.map((i, k) => {
        const v = text(cells[i]);
        const r = v && role(v);
        if (r) report.push(`${file}, row ${n}: ${e} chose the ${r} role as Choice ${k + 1}; it is left out of the choices`);
        return r ? null : { v, k };
      }).filter(Boolean);
      const choices = picked.map(({ v, k }) => {
        if (!v) return "";
        let c = index.find(v);
        if (!c && (c = index.near(v))) report.push(`${file}, row ${n}: Choice ${k + 1} "${v}" taken as "${c.name}", the closest course; check it`);
        if (c) {
          mark(c.name, v);
          return c.name;
        }
        report.push(`${file}, row ${n}: Choice ${k + 1} "${v}" matches no course; left as written`);
        return stripMarker(v);
      });
      while (choices.length < nChoices) choices.push("");
      const entry = { n, t: time(cells[ts]), row: [cells[ts] ?? "", e, ...choices, ...answerAt.map((i) => text(cells[i]))] };
      const had = kept.get(e);
      if (!had) {
        kept.set(e, entry);
        continue;
      }
      const unread = Number.isNaN(entry.t) || Number.isNaN(had.t);
      const [win, lose] = unread || entry.t >= had.t ? [entry, had] : [had, entry];
      kept.set(e, win);
      report.push(unread
        ? `${file}, row ${lose.n}: a repeat form from ${e} was left out; a timestamp could not be read, so the lower row was used (row ${win.n} kept)`
        : `${file}, row ${lose.n}: an older form from ${e} was left out (row ${win.n} kept)`);
    }
    files[file] = [want, ...[...kept.values()].sort((a, b) => a.n - b.n).map((x) => x.row)];
  }

  // Last year's four: the allocation as the page reads it (each course and its sponsors by name), and the forms as they
  // are. A form with no raw file is written with headers only, since the page takes all four or none.
  if (past) {
    const n = Math.max(1, ...ran.map((r) => r.names.length));
    const out = {
      "past-allocation.xlsx": [["Course Code", "Course Name", ...Array.from({ length: n }, (_, i) => `Sponsor ${i + 1}`)],
        ...ran.map((r) => [r.code, r.course.name, ...Array.from({ length: n }, (_, i) => r.names[i] ?? "")])],
    };
    for (const file of FORMS) out[`past-${file}`] = [HEADERS[`past-${file}`], ...(files[file]?.slice(1) ?? [])];
    // The Last year tab refuses one person on two courses, but can only tell once this year's staff.xlsx is beside it.
    const on = new Map();
    for (const r of ran) for (const who of r.names) on.set(norm(who), [...(on.get(norm(who)) ?? []), r.course.name]);
    for (const [, where] of on) if (where.length > 1) report.push(`allocation.xlsx: one sponsor name is on ${where.length} courses (${where.join(", ")}); the Last year tab refuses that if it is one person`);
    for (const [name, m] of marked) report.push(`"${name}" is marked (${m}) in the raw files; the page does not read this`);
    return { files: out, report };
  }

  for (const [name, m] of marked) report.push(`"${name}" is marked (${m}) in the raw files; the page does not read this, so check who is placed on it`);

  // Returning: Prior Course copied as the code, checked by hand when it is not one of this year's codes.
  const rh = raw["returning.xlsx"][0] ?? [];
  const rEm = column("returning.xlsx", rh, ["email"], "Email");
  const rCode = column("returning.xlsx", rh, ["prior", "course"], "Prior Course");
  const back = new Map();
  for (const { n, cells } of body(raw["returning.xlsx"])) {
    const e = email("returning.xlsx", n, cells[rEm]);
    if (!e) continue;
    if (back.has(e)) {
      report.push(`returning.xlsx, row ${n}: ${e} is listed twice; the first row is used`);
      continue;
    }
    const code = text(cells[rCode]);
    if (!codes.has(code)) report.push(`returning.xlsx, row ${n}: course code "${code}" is not one of this year's codes; check it by hand`);
    back.set(e, [e, code]);
  }
  files["returning.xlsx"] = [HEADERS["returning.xlsx"], ...back.values()];

  files["staff.xlsx"] = [HEADERS["staff.xlsx"], ...staff(files, sponsors, report, !own)];
  return { files, report };
}

// Every email on a form or the returning list, named from the allocation only when exactly one sponsor fits it and
// that sponsor fits no other email. Certificates are left blank.
function staff(files, sponsors, report, named) {
  const emails = new Set(files["returning.xlsx"].slice(1).map((r) => r[0]));
  for (const file of FORMS) for (const r of files[file]?.slice(1) ?? []) emails.add(r[1]);
  // A key fits its own local part and that part with a number after it (jsmith, jsmith2), so a numbered twin is never missed.
  const fitting = (k) => [...emails].filter((e) => new RegExp(`^${k}\\d*@`).test(e));
  const names = new Map([...emails].map((e) => [e, new Set()]));
  for (const { n, full } of sponsors) {
    const fits = [...new Set(nameKeys(full).flatMap(fitting))];
    if (!fits.length) report.push(`allocation.xlsx, row ${n}: sponsor "${full}" has no email on any form or the returning list; add them to staff.xlsx by hand`);
    else if (fits.length > 1) report.push(`allocation.xlsx, row ${n}: sponsor "${full}" fits more than one email (${fits.join(", ")}); fill in those names by hand`);
    else names.get(fits[0]).add(full);
  }
  if (!named) {
    report.push(`staff.xlsx: no allocation.xlsx, so all ${emails.size} names are blank; fill them in`);
    return [...emails].sort().map((e) => [e, "", ""]);
  }
  return [...emails].sort().map((e) => {
    const fit = [...names.get(e)];
    if (fit.length === 1) return [e, fit[0], ""];
    if (fit.length) report.push(`staff.xlsx: ${e} fits more than one sponsor (${fit.join(", ")}); its name is blank, fill it in`);
    else report.push(`staff.xlsx: ${e} has no name on the allocation; its name is blank, fill it in`);
    return [e, "", ""];
  });
}
