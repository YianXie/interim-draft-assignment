// The reader's model calls, failed calls, whole-word quotes and the command itself, against stub servers on this machine.
// Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFiles, SLOTS, FIT } from "../../src/import.js";
import { readBook } from "../../src/xlsx.js";
import { checkTags } from "../../tools/reader/check.mjs";
import { readAll } from "../../tools/reader/read.mjs";
import { reach, makeAsk } from "../../tools/reader/model.mjs";
import { fitBook } from "../../tools/reader/book.mjs";
import { SKILL } from "../../tools/answers.mjs";

const EMAIL = "pat.lowe@fernhollow.example";
const OTHER = "sam.ford@fernhollow.example";
const ranked = [{ id: "C01", name: "Talloway Highland Trek" }, { id: "C02", name: "Eskmere Coast Kayaking" }];
const school = {
  courses: ranked.map((c) => ({ ...c })),
  teachers: [
    { email: EMAIL, prefs: [{ course: "C01", rank: 1, round: "Round 1" }] },
    { email: OTHER, prefs: [{ course: "C02", rank: 1, round: "Round 1" }] },
  ],
};
const answers = [
  { email: EMAIL, form: "Round 1", answer: "I do tent pitching." },
  { email: OTHER, form: "Round 1", answer: "I can swim." },
];
const reply = (tags) => JSON.stringify({ tags });
const pitching = { kind: "skill", tag: "Tent pitching", quote: "tent pitching", courses: ["Talloway Highland Trek"] };

test("checkTags drops a quote that starts or ends inside a word", () => {
  const answer = "I am unqualified as a lifeguard and uncomfortable near deep water, and I am inexperienced with kayaks.";
  const out = checkTags(
    [
      { kind: "certificate", tag: "Lifeguard", quote: "qualified as a lifeguard", courses: ["Eskmere Coast Kayaking"] },
      { kind: "experience", tag: "Deep water", quote: "comfortable near deep water", courses: [] },
      { kind: "experience", tag: "Kayaks", quote: "experienced with kayaks", courses: [] },
      { kind: "skill", tag: "Kayaks", quote: "inexperienced with kay", courses: [] },
    ],
    { email: EMAIL, answer, ranked },
  );
  assert.deepEqual(out, { rows: [], dropped: 4 });
});

test("checkTags treats an apostrophe or hyphen inside a word as part of it", () => {
  const answer = "I can't swim, I am a non-swimmer, and I hold a first-aid certificate. The teachers' kayaks are blue.";
  const t = (quote) => ({ kind: "skill", tag: "x", quote, courses: [] });
  const keep = (quote) => checkTags([t(quote)], { email: EMAIL, answer, ranked }).rows.length;
  assert.equal(keep("t swim"), 0);
  assert.equal(keep("swimmer"), 0);
  assert.equal(keep("aid certificate"), 0);
  assert.equal(keep("I can't swim"), 1);
  assert.equal(keep("a first-aid certificate."), 1);
  assert.equal(keep("The teachers"), 1);
  assert.equal(keep("non-swimmer"), 1);
});

test("checkTags keeps a whole-word quote found after a mid-word match", () => {
  const answer = "Unqualified last year, now qualified as a lifeguard.";
  const out = checkTags([{ kind: "certificate", tag: "Lifeguard", quote: "qualified as a lifeguard", courses: [] }], { email: EMAIL, answer, ranked });
  assert.deepEqual(out, { rows: [[EMAIL, "", "Certificate", "Lifeguard", "qualified as a lifeguard"]], dropped: 0 });
});

test("readAll counts a failed call as an unreadable reply: retried once, then not read, and goes on", async () => {
  const calls = { [EMAIL]: 0, [OTHER]: 0 };
  const ask = async (system, user) => {
    const who = user.includes("tent pitching") ? EMAIL : OTHER;
    calls[who]++;
    if (who === EMAIL && calls[who] === 1) throw new Error("fetch failed");
    if (who === OTHER) throw new Error("http://127.0.0.1:11434 answered 500: busy");
    return reply([pitching]);
  };
  const out = await readAll({ school, answers, ask, prompt: "PROMPT" });
  assert.deepEqual(calls, { [EMAIL]: 2, [OTHER]: 2 });
  assert.deepEqual(out.rows, [[EMAIL, "C01", "Skill", "Tent pitching", "tent pitching"]]);
  assert.deepEqual(out.notRead, [OTHER]);
  assert.deepEqual(out.errors, ["fetch failed", "http://127.0.0.1:11434 answered 500: busy"]);
  assert.equal(out.answersSheet.length, 2);
});

test("makeAsk posts the chat request, refuses redirects and reads message.content", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: { role: "assistant", content: "REPLY" } }), { status: 200 });
  };
  const ask = makeAsk({ host: "http://127.0.0.1:11434", model: "m:1", fetch });
  assert.equal(await ask("SYSTEM", "USER"), "REPLY");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    model: "m:1",
    stream: false,
    think: false,
    options: { temperature: 0, seed: 1, num_ctx: 8192 },
    messages: [{ role: "system", content: "SYSTEM" }, { role: "user", content: "USER" }],
  });
  const empty = makeAsk({ host: "http://127.0.0.1:11434", model: "m", fetch: async () => new Response("{}", { status: 200 }) });
  assert.equal(await empty("s", "u"), "");
  const busy = makeAsk({ host: "http://127.0.0.1:11434", model: "m", fetch: async () => new Response("busy", { status: 503 }) });
  await assert.rejects(busy("s", "u"), /answered 503: busy/);
});

// A stub server on this machine; handler(req, body, res). Gives its address and the bodies it was sent.
async function stub(handler) {
  const bodies = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      bodies.push({ url: req.url, body });
      handler(req, body, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { host: `http://127.0.0.1:${server.address().port}`, bodies, close: () => new Promise((r) => server.close(r)) };
}
const closedHost = async () => {
  const s = await stub(() => {});
  await s.close();
  return s.host;
};

test("a redirect is refused: the answer never reaches the other address", async () => {
  const elsewhere = await stub((req, body, res) => res.end(JSON.stringify({ message: { content: reply([]) } })));
  const proxy = await stub((req, body, res) => {
    res.writeHead(307, { location: `${elsewhere.host}/elsewhere` });
    res.end();
  });
  try {
    await assert.rejects(makeAsk({ host: proxy.host, model: "m" })("SYSTEM", "Answer: I can swim."));
    await assert.rejects(reach({ host: proxy.host }), /^Error: cannot reach the model at /);
    const out = await readAll({ school, answers, ask: makeAsk({ host: proxy.host, model: "m" }), prompt: "P" });
    assert.deepEqual(out.notRead, [EMAIL, OTHER]);
    assert.equal(proxy.bodies.length, 6);
    assert.equal(elsewhere.bodies.length, 0);
  } finally {
    await proxy.close();
    await elsewhere.close();
  }
});

test("reach gives one plain line when nothing is listening", async () => {
  const host = await closedHost();
  await assert.rejects(reach({ host }), (e) => e.message === `cannot reach the model at ${host}: ECONNREFUSED`);
});

test("readAll reports progress after each answer, read or not", async () => {
  const seen = [];
  let n = 0;
  const ask = async () => (++n === 1 ? reply([pitching]) : "not json");
  await readAll({ school, answers, ask, prompt: "P", progress: (done, total) => seen.push([done, total]) });
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test("fitBook writes the Fit and Answers sheets", async () => {
  const book = await readBook(await fitBook({ rows: [[EMAIL, "C01", "Skill", "Tent pitching", "tent pitching"]], answersSheet: [[EMAIL, "Round 1", "I do tent pitching."]] }));
  assert.deepEqual(book.map((s) => s.name), ["Fit", "Answers"]);
  assert.deepEqual(book[0].rows.slice(1), [[EMAIL, "C01", "Skill", "Tent pitching", "tent pitching"]]);
  assert.deepEqual(book[1].rows, [["Email", "Form", "Answer"], [EMAIL, "Round 1", "I do tent pitching."]]);
});

// The command itself, on the invented school.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCHOOL = join(ROOT, "fixtures/school");
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [join(ROOT, "tools/reader.mjs"), ...args], { cwd: ROOT }, (error, stdout, stderr) =>
    resolve({ code: error ? error.code : 0, stdout, stderr }));
});
const scratch = () => mkdtempSync(join(tmpdir(), "interim-reader-"));

test("the command needs --out, so fit.xlsx is never written into the repo by default", async () => {
  const r = await run(["--dir", SCHOOL, "--host", "http://127.0.0.1:9"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^usage: node tools\/reader\.mjs --dir <folder with the six> --out <fit\.xlsx outside this repo>/);
  assert.equal(existsSync(join(ROOT, FIT)), false);
});

test("the command exits 1 with one plain line when the model cannot be reached, and writes nothing", async () => {
  const dir = scratch();
  try {
    const host = await closedHost();
    const out = join(dir, FIT);
    const r = await run(["--dir", SCHOOL, "--out", out, "--host", host]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `cannot reach the model at ${host}: ECONNREFUSED\n`);
    assert.equal(r.stdout, "");
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A stand-in Ollama: the first skill line it finds in the answer, tied to the longest ranked course named in that sentence.
// Every third chat call answers 500, so some teachers are read on the retry and the run still writes the workbook.
const LINES = Object.values(SKILL).flat();
function echo(user) {
  const [, names, answer] = user.match(/^Ranked courses: (.*)\nAnswer: ([\s\S]*)$/);
  for (const s of answer.split(/(?<=\.)\s+/)) {
    const line = LINES.find((l) => s.includes(l));
    if (!line) continue;
    const course = names.split("; ").filter((n) => s.includes(n)).sort((a, b) => b.length - a.length)[0];
    return reply([{ kind: "experience", tag: "Course skill", quote: line, courses: course ? [course] : [] }]);
  }
  return reply([]);
}

test("the command reads every answer through a stub Ollama and writes a fit.xlsx the page accepts", async () => {
  const dir = scratch();
  let chats = 0;
  const ollama = await stub((req, body, res) => {
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
    if (++chats % 3 === 0) {
      res.writeHead(500);
      return res.end("busy");
    }
    const { messages } = JSON.parse(body);
    res.end(JSON.stringify({ message: { role: "assistant", content: echo(messages[1].content) } }));
  });
  try {
    const out = join(dir, FIT);
    const prompt = join(dir, "prompt.txt");
    writeFileSync(prompt, "PROMPT");
    const r = await run(["--dir", SCHOOL, "--out", out, "--host", ollama.host, "--model", "stub:1", "--prompt", prompt]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^teachers read \d+, rows [1-9]\d*, dropped 0, not read 0\n$/);
    assert.match(r.stderr, /^a model call failed: http:\/\/127\.0\.0\.1:\d+ answered 500: busy\n$/);
    const chat = ollama.bodies.filter((b) => b.url === "/api/chat").map((b) => JSON.parse(b.body));
    assert.ok(chat.length > 0);
    assert.ok(chat.every((b) => b.model === "stub:1" && b.messages[0].content === "PROMPT"));
    const six = await Promise.all(SLOTS.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(SCHOOL, name))) })));
    const { slots, school: withFit } = await parseFiles([...six, { name: FIT, bytes: new Uint8Array(readFileSync(out)) }]);
    assert.equal(slots[FIT], "ready");
    const [fern, ans] = await readBook(readFileSync(out));
    assert.equal(withFit.teachers.reduce((n, t) => n + t.fit.length, 0), fern.rows.length - 1);
    assert.equal(ans.name, "Answers");
    assert.ok(ans.rows.length > 1);
  } finally {
    await ollama.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
