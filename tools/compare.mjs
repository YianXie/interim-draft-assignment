// Compares a downloaded draft with the office's final allocation, measured the same way against the same files.
// Run by hand, never by the page; nothing leaves this machine. Keep every file it reads or writes outside the repo.
// Usage: node tools/compare.mjs --six <folder> --draft <path to the download .xlsx> --office <allocation.xlsx> [--out <compare.xlsx>]
//   --six     the files loaded on Start: the six, plus past-*.xlsx and fit.xlsx if they were loaded too
//   --draft   path to the page's download, with names on (any folder, e.g. ~/Downloads/…)
//   --office  the office's final allocation (Trip Code, Course Name, Sponsor 1..n), as given to tools/convert.mjs
//   --out     optional: also writes the tables, teacher by teacher, to this new workbook (it never overwrites)
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readBook, writeBook } from "../src/xlsx.js";
import { parseFiles, SLOTS, PAST_SLOTS, FIT } from "../src/import.js";
import { compare, readDraft, readOffice } from "./compare/compare.mjs";

const stop = (line) => {
  console.error(line);
  process.exit(1);
};
const { values: opt } = parseArgs({ options: { six: { type: "string" }, draft: { type: "string" }, office: { type: "string" }, out: { type: "string" } } });
if (!opt.six || !opt.draft || !opt.office) stop("usage: node tools/compare.mjs --six <folder> --draft <path to the download .xlsx> --office <allocation.xlsx> [--out <compare.xlsx>]");
if (opt.out && existsSync(opt.out)) stop(`${opt.out} already exists; pass another --out, nothing was written`);

const book = async (path, what) => {
  try {
    return await readBook(new Uint8Array(await readFile(path)));
  } catch {
    stop(`${what}: ${path} is not a readable .xlsx file`);
  }
};

const wanted = new Set([...SLOTS, ...PAST_SLOTS, FIT]);
const names = (await readdir(opt.six)).filter((n) => wanted.has(n));
const files = await Promise.all(names.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(opt.six, name))) })));
const { school, slots } = await parseFiles(files);
if (!school) stop(["Start would refuse these files:", ...Object.values(slots).filter((s) => s !== "ready" && s !== "optional")].join("\n"));

const report = [];
let result;
try {
  const draft = readDraft(school, await book(opt.draft, "draft"), report);
  const office = readOffice(school, (await book(opt.office, "office"))[0]?.rows ?? [], report);
  result = compare(school, draft, office);
} catch (e) {
  stop(e.message);
}

// The terminal gets the summary and the choice table; names only go in --out.
const table = (rows) => {
  const width = [];
  for (const r of rows) r.forEach((c, i) => (width[i] = Math.max(width[i] ?? 0, String(c).length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ").trimEnd()).join("\n");
};
const loaded = [school.past && "last year's files", school.fit && "fit.xlsx"].filter(Boolean);
console.log(`Compared with ${loaded.length ? loaded.join(" and ") : "the six only"}.\n`);
console.log(table(result.summary));
console.log("\nWhat each teacher got: draft down the side, office across the top\n");
console.log(table(result.cross));
console.log(report.length ? `\n${report.length} things to check:\n${report.map((l) => `- ${l}`).join("\n")}` : "\nEvery row was matched.");

if (opt.out) {
  const sheets = [
    { name: "Summary", rows: result.summary },
    { name: "Choices", rows: result.cross },
    { name: "Teachers", rows: result.teachers },
    { name: "Courses", rows: result.courses },
    { name: "To check", rows: [["Line"], ...report.map((l) => [l])] },
  ];
  await writeFile(opt.out, await writeBook(sheets));
  console.log(`\nWrote ${opt.out}.`);
}
