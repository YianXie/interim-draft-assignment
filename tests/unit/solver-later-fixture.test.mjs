// The solve on a kept draft matches the independent CP-SAT solve in tools/expected.py --later.
// fixtures/later/kept.json lists the kept pairs by email and course code (tools/make_later.mjs), three of them breaking rules.
// placed is everyone placed, kept and new together; running is the courses with at least one of them on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFiles, readForms, LATER, SLOTS } from "../../src/import.js";
import { loadHighs, solveDraft } from "../../src/solver.js";

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const dir = new URL("../../fixtures/school/", import.meta.url);
const fixture = async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) });

test("solve on the kept draft equals expected-later.json", async () => {
  const expected = await read("../../fixtures/expected-later.json");
  const kept = await read("../../fixtures/later/kept.json");
  let i = 0;
  const base = (await parseFiles(await Promise.all(SLOTS.filter((n) => !LATER.includes(n)).map(fixture)), (n) => i++ % n)).school;
  const later = (await readForms(base, await Promise.all(LATER.map(fixture)))).school;
  assert.ok(later);
  const id = new Map(later.teachers.map((t) => [t.email.trim().toLowerCase(), t.id]));
  const keep = kept.map(({ email, course }) => {
    assert.ok(id.has(email), email);
    return [id.get(email), course];
  });
  const r = solveDraft(await loadHighs({}), later, keep);
  assert.equal(r.status, "Optimal");
  assert.deepEqual(r.values, expected.values);
  const all = [...keep, ...r.pairs];
  assert.equal(all.length, expected.placedMin);
  assert.equal(all.length, expected.placedMax);
  const running = new Set(all.map(([, c]) => c)).size;
  assert.equal(running, expected.runningMin);
  assert.equal(running, expected.runningMax);
});
