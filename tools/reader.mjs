// Writes fit.xlsx from the written answers in round1.xlsx and singapore.xlsx, with a model running locally in Ollama.
// Run by hand, never by the page. The office checks every row in Excel before fit.xlsx goes on Start.
// Usage: node tools/reader.mjs --dir <folder with the six> [--out fit.xlsx] [--host http://127.0.0.1:11434]
//        [--model qwen3.5:9b] [--prompt tools/reader-test/prompt_v3.txt] [--format json]
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseFiles, formAnswers, SLOTS, FIT } from "../src/import.js";
import { readAll } from "./reader/read.mjs";
import { reach, makeAsk } from "./reader/model.mjs";
import { fitBook } from "./reader/book.mjs";

const { values: opt } = parseArgs({
  options: {
    dir: { type: "string" },
    out: { type: "string", default: FIT },
    host: { type: "string", default: "http://127.0.0.1:11434" },
    model: { type: "string", default: "qwen3.5:9b" },
    format: { type: "string" },
    prompt: { type: "string", default: fileURLToPath(new URL("reader-test/prompt_v3.txt", import.meta.url)) },
  },
});
if (!opt.dir) {
  console.error("usage: node tools/reader.mjs --dir <folder with the six> [--out fit.xlsx] [--host URL] [--model NAME] [--prompt FILE] [--format json]");
  process.exit(1);
}

if (existsSync(opt.out)) {
  console.error(`${opt.out} already exists; move it or pass another --out, nothing was read`);
  process.exit(1);
}

const six = await Promise.all(SLOTS.map(async (name) => {
  try {
    return { name, bytes: new Uint8Array(await readFile(join(opt.dir, name))) };
  } catch {
    return null; // missing: parseFiles reports it as "file not added"
  }
}));
const bytesOf = Object.fromEntries(six.filter(Boolean).map((f) => [f.name, f.bytes]));
const { school, slots } = await parseFiles(six.filter(Boolean));
if (!school) {
  for (const file of SLOTS) if (slots[file] !== "ready") console.error(slots[file]);
  process.exit(1);
}

const FORMS = [["round1.xlsx", "Round 1"], ["singapore.xlsx", "Singapore"]];
const answers = [];
for (const [file, form] of FORMS) for (const a of await formAnswers(file, bytesOf[file])) answers.push({ ...a, form });
const order = FORMS.map(([, form]) => form);
answers.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : order.indexOf(a.form) - order.indexOf(b.form)));

const prompt = await readFile(opt.prompt, "utf8");
try {
  await reach({ host: opt.host });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const { rows, answersSheet, dropped, notRead, errors } = await readAll({ school, answers, ask: makeAsk({ host: opt.host, model: opt.model, format: opt.format }), prompt });
for (const e of errors) console.error(`a model call failed: ${e}`);
const read = new Set(answers.map((a) => a.email).filter((e) => !notRead.includes(e)));
if (!read.size) {
  console.error(`no answers were read, so nothing was written (not read ${notRead.length})`);
  process.exit(1);
}
try {
  // Never overwrite: the office may already have checked and corrected a fit.xlsx at this path.
  await writeFile(opt.out, await fitBook({ rows, answersSheet }), { flag: "wx" });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  console.error(`${opt.out} already exists; move it or pass another --out, nothing was written`);
  process.exit(1);
}
console.log(`teachers read ${read.size}, rows ${rows.length}, dropped ${dropped}, not read ${notRead.length}`);
