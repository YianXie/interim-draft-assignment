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

// "(FEMALE)" or "(MALE)" after a course name on a form: the page has no such rule, so it is taken off before matching.
const MARK = /\(\s*(fe)?male\s*\)/i;
export const marker = (s) => {
  const m = String(s ?? "").match(MARK);
  return m ? (m[1] ? "FEMALE" : "MALE") : null;
};
export const stripMarker = (s) => String(s ?? "").replace(MARK, "").replace(/\s+/g, " ").trim();

// The key two spellings of one name share: marker, accents, case and punctuation dropped, "&" read as "and".
const loose = (s) => stripMarker(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// courses: [{ name, country }]. find(text) matches a name spelled the same apart from case, spacing, punctuation and a
// marker: "Country Name", then the bare name when only one course has it, then the text with the part before its first
// dash or colon (a country spelled differently) taken off. near(text) is for what find misses: the one course clearly
// closest in letters (a slip), or else (unless words is false) the only course holding every word of the text (a shortened name); null when unsure.
export function courseIndex(courses) {
  const full = new Map();
  const bare = new Map();
  for (const c of courses) {
    full.set(loose(`${c.country} ${c.name}`), c);
    const k = loose(c.name);
    bare.set(k, bare.has(k) ? null : c);
  }
  const duplicates = [...new Set(courses.filter((c) => bare.get(loose(c.name)) === null).map((c) => c.name))];
  const rest = (text) => {
    const m = stripMarker(text).match(/^[^—–:-]*[—–:-](.+)$/);
    return m ? loose(m[1]) : "";
  };
  const find = (text) => {
    const t = loose(text);
    if (!t) return null;
    if (full.has(t)) return full.get(t);
    if (bare.has(t)) return bare.get(t);
    return bare.get(rest(text)) ?? null;
  };
  const near = (text, { words = true } = {}) => {
    const tries = [...new Set([loose(text), rest(text)])].filter(Boolean);
    if (!tries.length || !courses.length) return null;
    const scored = courses.map((c) => {
      const keys = [loose(c.name), loose(`${c.country} ${c.name}`)];
      const d = Math.min(...tries.flatMap((t) => keys.map((k) => distance(t, k))));
      return { c, d, allow: Math.max(2, Math.floor(0.15 * keys[0].length)) };
    }).sort((a, b) => a.d - b.d);
    const [best, second] = scored;
    if (best.d <= best.allow && (!second || second.d >= best.d + 2)) return best.c;
    if (!words) return null;
    for (const t of tries) {
      const parts = t.split(" ");
      const hits = courses.filter((c) => {
        const own = new Set(loose(`${c.country} ${c.name}`).split(" "));
        return parts.every((w) => own.has(w));
      });
      if (hits.length === 1) return hits[0];
    }
    return null;
  };
  return { find, near, duplicates };
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
