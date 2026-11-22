// Matching helpers for tools/convert.mjs: course names, emails, sponsor names, column headers. Imports nothing.

// Trimmed, lower case, every dash with its spaces written " - ", runs of spaces made one.
export function norm(s) {
  if (s === null || s === undefined) return "";
  return String(s).toLowerCase().replace(/\s*[—–-]\s*/g, " - ").replace(/\s+/g, " ").trim();
}

// One address, trimmed and lower case, domain kept; null when it is not one plain address.
export function cleanEmail(raw) {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
}

// courses: [{ name, country }]. find(text) tries "Country - Name", then the bare name when only one course has it,
// then the text with its first dash-separated part (a country spelled differently) taken off.
export function courseIndex(courses) {
  const full = new Map();
  const bare = new Map();
  for (const c of courses) {
    full.set(norm(`${c.country} - ${c.name}`), c);
    const k = norm(c.name);
    bare.set(k, bare.has(k) ? null : c);
  }
  const duplicates = [...new Set(courses.filter((c) => bare.get(norm(c.name)) === null).map((c) => c.name))];
  const find = (text) => {
    const n = norm(text);
    if (!n) return null;
    if (full.has(n)) return full.get(n);
    if (bare.has(n)) return bare.get(n);
    const at = n.indexOf(" - ");
    return at < 0 ? null : bare.get(n.slice(at + 3)) ?? null;
  };
  return { find, duplicates };
}

const letters = (w) => w.normalize("NFD").toLowerCase().replace(/[^a-z]/g, "");

// "First Last" → the email's local part as the school writes it: first initial and last name. For a last name of
// several words both the last word and all later words joined are tried.
export function nameKeys(full) {
  const words = String(full ?? "").trim().split(/\s+/).map(letters).filter(Boolean);
  if (words.length < 2) return [];
  const i = words[0][0];
  return [...new Set([i + words.at(-1), i + words.slice(1).join("")])];
}

// Index of the first header holding every word (after norm), -1 if none.
export function findColumn(head, words) {
  return head.findIndex((h) => words.every((w) => norm(h).includes(w)));
}
