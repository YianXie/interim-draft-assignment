// Turns the office's raw workbooks into the six files the page reads, and writes convert-report.txt beside them.
// Run by hand, never by the page; nothing leaves this machine. Keep both folders outside the repo.
// Usage: node tools/convert.mjs --in <folder with the raw files> --out <new folder>
// The raw folder holds courses.xlsx, returning.xlsx, round1.xlsx, allocation.xlsx (the final allocation) and,
// when there are any, round2.xlsx and singapore.xlsx. Each is read from its first sheet.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readBook, writeBook } from "../src/xlsx.js";
import { parseFiles, SLOTS, OPTIONAL as OPTIONAL_SLOT } from "../src/import.js";
import { convert, REQUIRED, OPTIONAL } from "./convert/convert.mjs";

const REPORT = "convert-report.txt";
const stop = (line) => {
  console.error(line);
  process.exit(1);
};

const { values: opt } = parseArgs({ options: { in: { type: "string" }, out: { type: "string" } } });
if (!opt.in || !opt.out) stop("usage: node tools/convert.mjs --in <folder with the raw files> --out <new folder>");
const taken = [...SLOTS, REPORT].filter((name) => existsSync(join(opt.out, name)));
if (taken.length) stop(`${opt.out} already holds ${taken.join(", ")}; move them or pass another --out, nothing was written`);

const raw = {};
for (const name of [...REQUIRED, ...OPTIONAL]) {
  const path = join(opt.in, name);
  if (!existsSync(path)) {
    if (REQUIRED.includes(name)) stop(`${name}: not found in ${opt.in}`);
    continue;
  }
  try {
    const book = await readBook(new Uint8Array(await readFile(path)));
    raw[name] = book[0]?.rows ?? [];
  } catch {
    stop(`${name}: not a readable .xlsx file`);
  }
}

let result;
try {
  result = convert(raw);
} catch (e) {
  stop(e.message);
}
const { files, report } = result;

await mkdir(opt.out, { recursive: true });
const written = [];
for (const [name, rows] of Object.entries(files)) {
  const bytes = await writeBook([{ name: "Fernhollow", rows }]);
  await writeFile(join(opt.out, name), bytes);
  written.push({ name, bytes });
}

// The page's own reading of what was written.
const { slots } = await parseFiles(written);
const page = SLOTS.map((name) => slots[name]).filter((s) => s && s !== "ready" && s !== OPTIONAL_SLOT);
const lines = [
  `Wrote ${Object.keys(files).join(", ")} to ${opt.out}.`,
  report.length ? `${report.length} things to check:` : "Nothing to check.",
  ...report.map((l) => `- ${l}`),
  ...(page.length ? page.map((s) => `Start would show: ${s}`) : ["Start takes these files."]),
];
await writeFile(join(opt.out, REPORT), lines.join("\n") + "\n");
console.log(lines.join("\n"));
