// The reader's checks on one model reply. Pure: no files, no network.
import { KINDS } from "../../src/import.js";

const norm = (s) => s.split(/\s+/).filter(Boolean).join(" ");
const str = (v) => (typeof v === "string" ? v : "");
const WORD = /[\p{L}\p{N}\p{M}]/u;
const JOIN = /['’-]/;
// True when the quote is in the answer as whole words: it does not start or end inside a word of the answer, so
// "qualified" is not found in "unqualified", nor "swim" in "can't swim" read as "t swim". An apostrophe or hyphen
// with a letter beyond it is part of the word ("can't", "non-swimmer").
function inAnswer(said, quote) {
  const joined = (at, step) => WORD.test(said[at] ?? "") || (JOIN.test(said[at] ?? "") && WORD.test(said[at + step] ?? ""));
  for (let i = said.indexOf(quote); i !== -1; i = said.indexOf(quote, i + 1)) {
    const end = i + quote.length;
    const startsClean = !WORD.test(quote[0]) || !joined(i - 1, -1);
    const endsClean = !WORD.test(quote[quote.length - 1]) || !joined(end, 1);
    if (startsClean && endsClean) return true;
  }
  return false;
}

// The tags in a reply, as [{ kind, tag, quote, courses }], or null when the reply cannot be read.
// Takes {"tags": [...]} or {"sentences": [{ tags }]}, with or without a code fence around it.
export function parseReply(raw) {
  const s = String(raw ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let d;
  try {
    d = JSON.parse(s);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  let tags;
  if (Array.isArray(d.tags)) tags = d.tags;
  else if (Array.isArray(d.sentences)) tags = d.sentences.flatMap((x) => (x && Array.isArray(x.tags) ? x.tags : []));
  else return null;
  return shape(tags);
}

const shape = (tags) =>
  tags
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      kind: str(t.kind),
      tag: str(t.tag),
      quote: str(t.quote),
      courses: Array.isArray(t.courses) ? t.courses : typeof t.courses === "string" && t.courses ? [t.courses] : [],
    }));

// The tags in a reply that is not valid JSON, taken out one by one, or null when there are none. Each tag is a flat object
// ({ kind, tag, quote, courses }), so it can be read on its own when the brackets around it are broken: qwen3.5:27b's
// compact replies drop a "{" between sentences or add a "]" after an empty course list. Every tag still goes through checkTags.
export function salvageTags(raw) {
  const s = String(raw ?? "").replace(/\[\s*\]\s*\]/g, "[]");
  const tags = [];
  for (const m of s.matchAll(/\{[^{}]*\}/g)) {
    let t;
    try {
      t = JSON.parse(m[0]);
    } catch {
      continue;
    }
    if (t && typeof t === "object" && !Array.isArray(t) && "quote" in t) tags.push(t);
  }
  return tags.length ? shape(tags) : null;
}

// fit.xlsx rows [Email, Course Code, Kind, Fact, Quote] for one answer's tags, and how many tags were dropped.
// A tag is dropped when its quote is not word for word in the answer (whitespace collapsed, whole words only), a course is not one the
// teacher ranked on that form, its kind is not one of the five, or its quote or label is empty.
export function checkTags(tags, { email, answer, ranked }) {
  const said = norm(answer);
  const codeOf = new Map(ranked.map((c) => [c.name, c.id]));
  const rows = [];
  let dropped = 0;
  for (const t of tags) {
    const kind = KINDS.find((k) => k.toLowerCase() === t.kind.trim().toLowerCase());
    const quote = norm(t.quote);
    const fact = t.tag.trim();
    const codes = t.courses.map((c) => codeOf.get(typeof c === "string" ? c.trim() : c));
    if (!kind || !quote || !fact || !inAnswer(said, quote) || codes.some((c) => c === undefined)) {
      dropped++;
      continue;
    }
    for (const code of codes.length ? [...new Set(codes)] : [""]) rows.push([email, code, kind, fact, quote]);
  }
  return { rows, dropped };
}
