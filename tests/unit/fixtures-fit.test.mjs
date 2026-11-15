import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBook } from "../../src/xlsx.js";
import { readFitSchool, readPastFitSchool, fitFile } from "./fit-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const school = (name) => new URL(`../../fixtures/school/${name}`, import.meta.url);
const rowsOf = async (url) => (await readBook(new Uint8Array(await readFile(url))))[0].rows;

// The written answers and the ranked course names of each teacher, from the six.
const courses = (await rowsOf(school("courses.xlsx"))).slice(1);
const nameOf = new Map(courses.map(([code, name]) => [code, name]));
const answers = new Map();
const ranked = new Map();
for (const form of ["round1.xlsx", "round2.xlsx", "singapore.xlsx"]) {
  const [head, ...rows] = await rowsOf(school(form));
  const at = head.indexOf("Enhancing Learning or Safety");
  const choiceCols = head.map((h, i) => (h.startsWith("Choice ") ? i : -1)).filter((i) => i >= 0);
  for (const row of rows) {
    const email = row[1];
    if (!ranked.has(email)) ranked.set(email, new Set());
    for (const i of choiceCols) if (row[i]) ranked.get(email).add(row[i]);
    if (at >= 0 && row[at]) answers.set(email, [...(answers.get(email) ?? []), row[at]]);
  }
}
const allRows = (s) => s.teachers.flatMap((t) => t.fit.map((r) => ({ email: t.email, ...r })));

test("fit.xlsx is accepted with the six", async () => {
  const s = await readFitSchool(() => 0);
  assert.equal(s.fit, true);
  assert.ok(allRows(s).length > 20, "the reader's rows are there");
  const p = await readPastFitSchool(() => 0);
  assert.equal(p.fit, true);
});

test("every non-blank Quote is word for word in that teacher's Enhancing Learning or Safety answer", async () => {
  for (const r of allRows(await readFitSchool(() => 0))) {
    if (!r.quote) continue;
    assert.ok((answers.get(r.email) ?? []).some((a) => a.includes(r.quote)), `${r.email}: ${r.quote}`);
  }
});

test("it holds the four hand-made rows", async () => {
  const rows = allRows(await readFitSchool(() => 0));
  const isRanked = (r) => r.course !== null && ranked.get(r.email)?.has(nameOf.get(r.course));
  const general = rows.filter((r) => r.course === null);
  assert.equal(general.length, 1, "one general fact");
  assert.ok(general[0].quote);
  const limits = rows.filter((r) => r.kind === "Limitation");
  assert.equal(limits.length, 1, "one limitation");
  assert.ok(isRanked(limits[0]), "the limitation is on a ranked course");
  const unranked = rows.filter((r) => r.course !== null && r.quote && !isRanked(r));
  assert.equal(unranked.length, 1, "one fit on a course the teacher did not rank");
  assert.equal(unranked[0].kind, "Experience");
  assert.ok(ranked.has(unranked[0].email), "that teacher sent a form");
  const office = rows.filter((r) => !r.quote);
  assert.equal(office.length, 1, "one office-added row");
  assert.equal(ranked.has(office[0].email), false, "for a teacher with no form");
  assert.notEqual(office[0].course, null);
});

test("make_fit.mjs writes the same bytes twice", async () => {
  const sums = [];
  for (let i = 0; i < 2; i++) {
    const dir = await mkdtemp(join(tmpdir(), "fit-"));
    try {
      execFileSync(process.execPath, ["tools/make_fit.mjs", dir], { cwd: root, stdio: "ignore" });
      sums.push(createHash("sha256").update(await readFile(join(dir, "fit.xlsx"))).digest("hex"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  assert.equal(sums[0], sums[1]);
  const committed = createHash("sha256").update(await readFile(join(root, fitFile))).digest("hex");
  assert.equal(sums[0], committed, "the committed fixture is what make_fit.mjs writes");
});
