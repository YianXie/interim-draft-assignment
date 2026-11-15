// Writes fit.xlsx from the written answers in round1.xlsx and singapore.xlsx, with a model running locally in Ollama.
// Run by hand, never by the page. The office checks every row in Excel before fit.xlsx goes on Start.
// Usage: node tools/reader.mjs --dir <folder with the six> [--out fit.xlsx] [--host http://127.0.0.1:11434]
//        [--model qwen3.5:9b] [--prompt tools/reader-test/prompt_v3.txt]
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseFiles, formAnswers, SLOTS, FIT, HEADERS } from "../src/import.js";
import { writeBook } from "../src/xlsx.js";
import { readAll } from "./reader/read.mjs";

const { values: opt } = parseArgs({
  options: {
    dir: { type: "string" },
    out: { type: "string", default: FIT },
    host: { type: "string", default: "http://127.0.0.1:11434" },
    model: { type: "string", default: "qwen3.5:9b" },
    prompt: { type: "string", default: new URL("reader-test/prompt_v3.txt", import.meta.url).pathname },
  },
});
if (!opt.dir) {
  console.error("usage: node tools/reader.mjs --dir <folder with the six> [--out fit.xlsx] [--host URL] [--model NAME] [--prompt FILE]");
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
const ask = async (system, user) => {
  const res = await fetch(new URL("/api/chat", opt.host), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opt.model,
      stream: false,
      think: false,
      options: { temperature: 0, seed: 1 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${opt.host} answered ${res.status}: ${await res.text()}`);
  return (await res.json()).message?.content ?? "";
};

const { rows, answersSheet, dropped, notRead } = await readAll({ school, answers, ask, prompt });
await writeFile(opt.out, await writeBook([
  { name: "Fernhollow", rows: [HEADERS[FIT], ...rows] },
  { name: "Answers", rows: [["Email", "Form", "Answer"], ...answersSheet] },
]));
const read = new Set(answers.map((a) => a.email).filter((e) => !notRead.includes(e)));
console.log(`teachers read ${read.size}, rows ${rows.length}, dropped ${dropped}, not read ${notRead.length}`);
