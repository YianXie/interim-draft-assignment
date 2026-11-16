// The reader that writes fit.xlsx, with a stubbed model: no network. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { writeBook } from "../../src/xlsx.js";
import { parseFiles, formAnswers, SLOTS, FIT, HEADERS } from "../../src/import.js";
import { parseReply, checkTags } from "../../tools/reader/check.mjs";
import { readAll } from "../../tools/reader/read.mjs";
import { SKILL } from "../../tools/answers.mjs";

const dir = new URL("../../fixtures/school/", import.meta.url);
const six = await Promise.all(SLOTS.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) })));
const bytesOf = (name) => six.find((f) => f.name === name).bytes;
const fixedRandom = () => {
  let k = 0;
  return (n) => (k++ * 7) % n;
};

const EMAIL = "pat.lowe@fernhollow.example";
const ANSWER = "On the Talloway Highland Trek I have experience in map reading and   tent pitching. I speak Eskmeri.";
const ranked = [{ id: "C01", name: "Talloway Highland Trek" }, { id: "C02", name: "Eskmere Coast Kayaking" }];
const tag = (over) => ({ kind: "experience", tag: "Tent pitching", quote: "tent pitching", courses: [], ...over });

test("parseReply strips a code fence and reads both shapes", () => {
  const one = { kind: "skill", tag: "Map reading", quote: "map reading", courses: ["Talloway Highland Trek"] };
  const two = { kind: "language", tag: "Eskmeri", quote: "I speak Eskmeri", courses: [] };
  assert.deepEqual(parseReply("```json\n" + JSON.stringify({ tags: [one] }) + "\n```"), [one]);
  const sentences = { sentences: [{ starts: "On the Talloway", tags: [one] }, { starts: "I speak", tags: [] }, { starts: "x", tags: [two] }] };
  assert.deepEqual(parseReply(JSON.stringify(sentences)), [one, two]);
  assert.deepEqual(parseReply("```\n{\"tags\": []}\n```"), []);
});

test("parseReply gives null for prose", () => {
  assert.equal(parseReply("Here are the facts I found: the teacher can read maps."), null);
  assert.equal(parseReply(""), null);
  assert.equal(parseReply("{\"facts\": []}"), null);
  assert.equal(parseReply("[1, 2]"), null);
});

test("checkTags drops a stitched quote", () => {
  const out = checkTags([tag({ quote: "I have experience in ... tent pitching" })], { email: EMAIL, answer: ANSWER, ranked });
  assert.deepEqual(out, { rows: [], dropped: 1 });
  // Whitespace is collapsed before the check, so the double space in the answer does not drop this one.
  const kept = checkTags([tag({ quote: "map reading and tent pitching" })], { email: EMAIL, answer: ANSWER, ranked });
  assert.equal(kept.dropped, 0);
  assert.equal(kept.rows.length, 1);
});

test("checkTags drops a course the teacher did not rank", () => {
  const out = checkTags([tag({ courses: ["Ombrine Reef Science"] }), tag({ courses: ["Highland Trek"] })], { email: EMAIL, answer: ANSWER, ranked });
  assert.deepEqual(out, { rows: [], dropped: 2 });
});

test("checkTags gives one row per named course, blank code for none", () => {
  const out = checkTags(
    [
      tag({ courses: ["Talloway Highland Trek", "Eskmere Coast Kayaking"] }),
      tag({ kind: "language", tag: "Eskmeri", quote: "I speak Eskmeri" }),
      tag({ kind: "hobby" }),
    ],
    { email: EMAIL, answer: ANSWER, ranked },
  );
  assert.deepEqual(out.rows, [
    [EMAIL, "C01", "Experience", "Tent pitching", "tent pitching"],
    [EMAIL, "C02", "Experience", "Tent pitching", "tent pitching"],
    [EMAIL, "", "Language", "Eskmeri", "I speak Eskmeri"],
  ]);
  assert.equal(out.dropped, 1); // the unknown kind
});

test("readAll retries an unreadable reply once, then lists the teacher as not read", async () => {
  const school = {
    courses: ranked.map((c) => ({ ...c })),
    teachers: [
      { email: EMAIL, prefs: [{ course: "C02", rank: 2, round: "Round 1" }, { course: "C01", rank: 1, round: "Round 1" }] },
      { email: "sam.ford@fernhollow.example", prefs: [{ course: "C02", rank: 1, round: "Singapore" }] },
    ],
  };
  const answers = [
    { email: EMAIL, form: "Round 1", answer: ANSWER },
    { email: "sam.ford@fernhollow.example", form: "Singapore", answer: "I can swim." },
  ];
  const asked = [];
  const replies = {
    [EMAIL]: ["Sorry, I could not do that.", JSON.stringify({ tags: [tag({ courses: ["Talloway Highland Trek"] })] })],
    "sam.ford@fernhollow.example": ["Nothing here.", "Still prose."],
  };
  const ask = async (system, user) => {
    asked.push({ system, user });
    const email = user.includes(ANSWER) ? EMAIL : "sam.ford@fernhollow.example";
    return replies[email].shift();
  };
  const out = await readAll({ school, answers, ask, prompt: "PROMPT" });
  assert.equal(asked.length, 4);
  assert.ok(asked.every((a) => a.system === "PROMPT"));
  assert.equal(asked[0].user, `Ranked courses: Talloway Highland Trek; Eskmere Coast Kayaking\nAnswer: ${ANSWER}`);
  assert.equal(asked[2].user, "Ranked courses: Eskmere Coast Kayaking\nAnswer: I can swim.");
  assert.deepEqual(out.rows, [[EMAIL, "C01", "Experience", "Tent pitching", "tent pitching"]]);
  assert.equal(out.dropped, 0);
  assert.deepEqual(out.notRead, ["sam.ford@fernhollow.example"]);
  assert.deepEqual(out.answersSheet, answers.map((a) => [a.email, a.form, a.answer]));
});

// A model stand-in: the first skill line it finds in the answer, tied to the longest ranked course named in that sentence.
const LINES = Object.values(SKILL).flat();
const echo = async (system, user) => {
  const [, names, answer] = user.match(/^Ranked courses: (.*)\nAnswer: ([\s\S]*)$/);
  const tags = [];
  for (const s of answer.split(/(?<=\.)\s+/)) {
    const line = LINES.find((l) => s.includes(l));
    if (!line) continue;
    const course = names.split("; ").filter((n) => s.includes(n)).sort((a, b) => b.length - a.length)[0];
    tags.push({ kind: "experience", tag: "Course skill", quote: line, courses: course ? [course] : [] });
    break;
  }
  return "```json\n" + JSON.stringify({ tags }) + "\n```";
};

test("the reader's fit.xlsx is accepted by the page", async () => {
  const { school } = await parseFiles(six);
  assert.ok(school);
  const answers = [];
  for (const [file, form] of [["round1.xlsx", "Round 1"], ["singapore.xlsx", "Singapore"]]) {
    for (const a of await formAnswers(file, bytesOf(file))) answers.push({ ...a, form });
  }
  assert.ok(answers.length > 0);
  const out = await readAll({ school, answers, ask: echo, prompt: "PROMPT" });
  assert.ok(out.rows.length > 0);
  assert.equal(out.dropped, 0);
  assert.deepEqual(out.notRead, []);
  const bytes = await writeBook([
    { name: "Fernhollow", rows: [HEADERS[FIT], ...out.rows] },
    { name: "Answers", rows: [["Email", "Form", "Answer"], ...out.answersSheet] },
  ]);
  const { slots, school: withFit } = await parseFiles([...six, { name: FIT, bytes }]);
  assert.equal(slots[FIT], "ready");
  assert.equal(withFit.teachers.reduce((n, t) => n + t.fit.length, 0), out.rows.length);
});

test("formAnswers leaves parseFiles unchanged", async () => {
  const before = await parseFiles(six, fixedRandom());
  const r1 = await formAnswers("round1.xlsx", bytesOf("round1.xlsx"));
  const sg = await formAnswers("singapore.xlsx", bytesOf("singapore.xlsx"));
  const after = await parseFiles(six, fixedRandom());
  assert.deepEqual(after, before);
  for (const a of [...r1, ...sg]) {
    assert.deepEqual(Object.keys(a), ["email", "answer"]);
    assert.ok(a.answer.trim().length > 0);
    assert.ok(before.school.teachers.some((t) => t.email === a.email));
  }
  assert.ok(r1.length > 0 && sg.length > 0);
});
