// The reader's one retry after a reply that is not valid JSON: it sends the broken reply back with FIX_JSON, so the
// second request differs from the first (at temperature 0 with a fixed seed the same request gives the same reply).
// The broken replies below are the shapes qwen3.5:27b gave on 15 Nov 2026 for invented answers in tools/reader-test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAll, FIX_JSON } from "../../tools/reader/read.mjs";
import { makeAsk } from "../../tools/reader/model.mjs";

const EMAIL = "kit.lowe@fernhollow.example";
const ANSWER = "I am a qualified first aider (renewed this year) and have led overnight trips for six years. I speak Mandarin and Korean.";
const school = {
  courses: [{ id: "C01", name: "Talloway Highland Trek" }],
  teachers: [{ email: EMAIL, prefs: [{ course: "C01", rank: 1, round: "Round 1" }] }],
};
const answers = [{ email: EMAIL, form: "Round 1", answer: ANSWER }];

// A "{" is missing before the second sentence.
const MISSING_BRACE = '{"sentences":[{"starts":"I am a","tags":[{"kind":"certificate","tag":"qualified first aider","quote":"qualified first aider","courses":[]}]},"starts":"I speak Mandarin","tags":[{"kind":"language","tag":"Mandarin","quote":"Mandarin","courses":[]}]}]';
// An extra "]" after an empty course list.
const EXTRA_BRACKET = '{"sentences":[{"starts":"I speak Mandarin","tags":[{"kind":"language","tag":"Korean","quote":"Korean","courses":[]]}]}]';
const FIXED = JSON.stringify({
  sentences: [
    { starts: "I am a", tags: [{ kind: "certificate", tag: "qualified first aider", quote: "qualified first aider", courses: [] }] },
    { starts: "I speak Mandarin", tags: [{ kind: "language", tag: "Mandarin", quote: "Mandarin", courses: [] }] },
  ],
});

for (const [name, broken] of [["a missing brace", MISSING_BRACE], ["an extra bracket", EXTRA_BRACKET]]) {
  test(`readAll sends a reply with ${name} back with FIX_JSON and reads the corrected reply`, async () => {
    const asked = [];
    const ask = async (system, user, prior) => {
      asked.push({ system, user, prior });
      return asked.length === 1 ? broken : FIXED;
    };
    const out = await readAll({ school, answers, ask, prompt: "PROMPT" });
    assert.equal(asked.length, 2);
    assert.deepEqual(asked[0].prior, []);
    assert.equal(asked[1].user, asked[0].user);
    assert.deepEqual(asked[1].prior, [{ role: "assistant", content: broken }, { role: "user", content: FIX_JSON }]);
    assert.deepEqual(out.rows, [
      [EMAIL, "", "Certificate", "qualified first aider", "qualified first aider"],
      [EMAIL, "", "Language", "Mandarin", "Mandarin"],
    ]);
    assert.deepEqual(out.notRead, []);
  });
}

test("readAll still checks every quote in the corrected reply", async () => {
  const stitched = JSON.stringify({ tags: [{ kind: "experience", tag: "first aid trips", quote: "first aider for six years", courses: [] }] });
  const ask = async (s, u, prior) => (prior.length ? stitched : MISSING_BRACE);
  const out = await readAll({ school, answers, ask, prompt: "P" });
  assert.deepEqual(out.rows, []);
  assert.equal(out.dropped, 1);
  assert.deepEqual(out.notRead, []);
});

test("readAll lists the teacher as not read when the corrected reply is broken too, and asks only twice", async () => {
  let calls = 0;
  const ask = async () => (calls++, MISSING_BRACE);
  const out = await readAll({ school, answers, ask, prompt: "P" });
  assert.equal(calls, 2);
  assert.deepEqual(out.notRead, [EMAIL]);
  assert.deepEqual(out.rows, []);
});

test("readAll retries a failed call as it was, without FIX_JSON", async () => {
  const asked = [];
  const ask = async (s, u, prior) => {
    asked.push(prior);
    if (asked.length === 1) throw new Error("fetch failed");
    return FIXED;
  };
  const out = await readAll({ school, answers, ask, prompt: "P" });
  assert.deepEqual(asked, [[], []]);
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.errors, ["fetch failed"]);
});

test("makeAsk sends the later turns after the user's message, and format only when given", async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ message: { content: "R" } }), { status: 200 });
  };
  const prior = [{ role: "assistant", content: "BROKEN" }, { role: "user", content: FIX_JSON }];
  await makeAsk({ host: "http://127.0.0.1:11434", model: "m", fetch })("S", "U", prior);
  await makeAsk({ host: "http://127.0.0.1:11434", model: "m", format: "json", fetch })("S", "U");
  assert.deepEqual(bodies[0].messages, [{ role: "system", content: "S" }, { role: "user", content: "U" }, ...prior]);
  assert.equal("format" in bodies[0], false);
  assert.equal(bodies[1].format, "json");
  assert.deepEqual(bodies[1].messages, [{ role: "system", content: "S" }, { role: "user", content: "U" }]);
});
