import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBook } from "../../src/xlsx.js";

const dir = new URL("../../fixtures/", import.meta.url);
const HEADERS = {
  courses: ["Course Code", "Course Name", "Type", "Seats", "Offered", "Certificate"],
  staff: ["Email", "Name", "Certificates"],
  returning: ["Email", "Course Code"],
  round1: ["Email", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Choice 5", "Choice 6", "Choice 7"],
  round2: ["Email", "Choice 1", "Choice 2", "Choice 3"],
  singapore: ["Email", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Choice 5"],
};

async function load(name) {
  const book = await readBook(new Uint8Array(await readFile(new URL(`school/${name}.xlsx`, dir))));
  return book;
}
async function table(name) {
  const [sheet] = await load(name);
  const [head, ...rows] = sheet.rows;
  return { head, rows: rows.filter((r) => r.some((c) => c !== null && c !== undefined && c !== "")) };
}
const blank = (v) => v === null || v === undefined || v === "";

test("school has the agreed size", async () => {
  const staff = await table("staff");
  const courses = await table("courses");
  assert.equal(staff.rows.length, 96);
  assert.equal(courses.rows.length, 40);
  assert.equal(courses.rows.filter((r) => r[4] === "Yes").length, 34);
  assert.equal(new Set(courses.rows.map((r) => r[1])).size, 40, "course names are unique");
});

test("every file has sheet Fernhollow and exact headers", async () => {
  for (const [name, headers] of Object.entries(HEADERS)) {
    const book = await load(name);
    assert.equal(book[0].name, "Fernhollow", name);
    assert.deepEqual(book[0].rows[0], headers, name);
  }
});

test("all emails are on fernhollow.example", async () => {
  for (const name of ["staff", "returning", "round1", "round2", "singapore"]) {
    const { rows } = await table(name);
    assert.ok(rows.length > 0, name);
    for (const r of rows) assert.match(r[0], /^[a-z.]+@fernhollow\.example$/, name);
  }
});

test("no gender or comment columns anywhere", async () => {
  for (const name of Object.keys(HEADERS)) {
    const { head } = await table(name);
    for (const h of head) assert.doesNotMatch(h, /gender|comment/i, name);
  }
});

test("the Scuba course has one returning sponsor, the only Scuba holder", async () => {
  const courses = await table("courses");
  const scuba = courses.rows.filter((r) => !blank(r[5]));
  assert.equal(scuba.length, 1);
  const [code, , , , offered, cert] = scuba[0];
  assert.equal(offered, "Yes");
  const holders = (await table("staff")).rows.filter((r) => String(r[2] ?? "").split(";").map((s) => s.trim()).includes(cert));
  assert.equal(holders.length, 1);
  const returning = (await table("returning")).rows;
  const sponsors = returning.filter((r) => r[1] === code);
  assert.equal(sponsors.length, 1);
  assert.equal(sponsors[0][0], holders[0][0]);
});

test("one returning sponsor is on a not-offered course and sent a form", async () => {
  const courses = await table("courses");
  const notOffered = new Set(courses.rows.filter((r) => r[4] === "No").map((r) => r[0]));
  const returning = (await table("returning")).rows.filter((r) => notOffered.has(r[1]));
  assert.equal(returning.length, 1);
  const email = returning[0][0];
  let forms = 0;
  for (const name of ["round1", "round2", "singapore"]) forms += (await table(name)).rows.filter((r) => r[0] === email).length;
  assert.ok(forms >= 1);
});

test("expected results have no spread", async () => {
  const e = JSON.parse(await readFile(new URL("expected.json", dir), "utf8"));
  assert.deepEqual(Object.keys(e).sort(), ["placedMax", "placedMin", "runningMax", "runningMin", "values"]);
  assert.equal(e.values.length, 3);
  assert.equal(e.placedMin, e.placedMax);
  assert.equal(e.runningMin, e.runningMax);
});
