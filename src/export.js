// The workbook for the draft as it stands, built from Mock on the current names switch. Browser code: no Node modules.
import { RESULT_LABEL } from "./past.js";

const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Always a string, with nothing a spreadsheet file cannot hold. Cells are written as text, so "=SUM(1)" or "00123" are never read as anything else.
export const cleanCell = (value) => String(value ?? "").replace(ILLEGAL, "").slice(0, 32767);

const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const byText = (a, b) => a.localeCompare(b);
const two = (n) => String(n).padStart(2, "0");

export function fileName(mock) {
  return `Fernhollow invented draft v${mock.summary().version} ${mock.state.namesOn ? "with names" : "T numbers"}.xlsx`;
}

function coursesSheet(mock) {
  const all = [...mock.allCourses()].sort((a, b) => byText(a.id, b.id));
  const n = Math.max(1, ...all.map((c) => Math.max(c.seats, mock.sponsors(c.id).length)));
  const head = ["Course Code", "Course Name", ...Array.from({ length: n }, (_, i) => `Sponsor ${i + 1}`), "Status"];
  const rows = all.map((c) => {
    const sponsors = mock.sponsors(c.id).map((t) => mock.label(t));
    return [c.id, c.name, ...Array.from({ length: n }, (_, i) => sponsors[i] ?? ""), sentence(mock.status(c.id))];
  });
  return { name: "Courses", rows: [head, ...rows] };
}

// What the Choice column says: the same words as the course screen.
function choiceOf(mock, t, cid) {
  if (!cid) return "";
  if (t.returning && t.returningCourse === cid) return "Returning sponsor";
  return t.submitted ? mock.choiceText(t.id, cid) : "No form received";
}
function statusOf(mock, t, cid) {
  if (!cid) return "Not placed";
  if (!t.submitted && !(t.returning && t.returningCourse === cid)) return "Check with them";
  if (mock.state.moved.has(t.id)) return "Moved by the office";
  return sentence(mock.status(cid));
}

function teachersSheet(mock) {
  const names = mock.state.namesOn;
  // With names off the order is T number alone, as on the Teachers tab, so it gives nothing away.
  const group = (t) => (!mock.placedOn(t.id) ? 0 : mock.teacherFlags(t.id).length ? 1 : 2);
  const order = names ? (a, b) => group(a) - group(b) || byText(mock.label(a.id), mock.label(b.id)) || byText(a.id, b.id) : (a, b) => byText(a.id, b.id);
  // The Last year column is there only when the past files were added.
  const past = mock.past();
  const rows = [...mock.teachers()].sort(order).map((t) => {
    const cid = mock.placedOn(t.id);
    const was = mock.lastYear(t.id);
    return [mock.label(t.id), ...(names ? [mock.contact(t.id)] : []), cid ? mock.course(cid).name : "", choiceOf(mock, t, cid),
      ...(past ? [was ? RESULT_LABEL[was.result] : ""] : []), mock.reason(t.id), statusOf(mock, t, cid)];
  });
  return { name: "Teachers", rows: [["Teacher", ...(names ? ["Email"] : []), "Course", "Choice", ...(past ? ["Last year"] : []), "Why", "Status"], ...rows] };
}

// One row per edit, oldest first. The first snapshot is the build, which is not an edit.
function changesSheet(mock) {
  const rows = mock.history().filter((h) => h.event.type !== "build").reverse().map((h) => {
    const d = new Date(h.when);
    return [`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`, mock.describe(h)];
  });
  return { name: "Changes", rows: [["Date", "Time", "Change"], ...rows] };
}

const THIS_YEAR = { top4: "Top 4", "5to7": "5 to 7", notRanked: "Not on their list", returning: "Returning sponsor", noForm: "No form", notPlaced: "Not placed" };

// Last year's result down the side, this year's across the top, each teacher counted once.
// The two lists under the table hold what was written on last year's allocation and who to pair it with, so they are written only with names on.
function lastYearSheet(mock) {
  const result = (t) => (mock.lastYear(t.id) ? mock.lastYear(t.id).result : null);
  const count = (was, now) => mock.teachers().filter((t) => result(t) === was && mock.thisYear(t.id) === now).length;
  const row = (was, text) => [text, ...Object.keys(THIS_YEAR).map((now) => count(was, now))];
  const rows = [["Last year", ...Object.values(THIS_YEAR)], ...Object.entries(RESULT_LABEL).map(([was, text]) => row(was, text)), row(null, "No record")];
  if (mock.state.namesOn) {
    const notFound = mock.teachers().filter((t) => result(t) === "notFound").map((t) => [mock.label(t.id)]);
    rows.push([], ["Not matched on last year's allocation"], ...mock.past().unmatched.map((entry) => [entry]),
      [], ["Sent a form last year, not on the allocation"], ...notFound);
  }
  return { name: "Last year", rows };
}

const noteSheet = () => ({ name: "Note", rows: [["Teachers are shown by T number. T numbers are pseudonymous, not anonymous."]] });

export function sheetsFor(mock) {
  const sheets = [coursesSheet(mock), teachersSheet(mock), changesSheet(mock)];
  if (mock.past()) sheets.push(lastYearSheet(mock));
  if (!mock.state.namesOn) sheets.push(noteSheet());
  return sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map(cleanCell)) }));
}
