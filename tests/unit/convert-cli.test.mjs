// tools/convert.mjs end to end: invented raw files in a temp folder, the page's own import on the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBook } from "../../src/xlsx.js";
import { parseFiles, SLOTS } from "../../src/import.js";
import { rawSchool } from "./convert-fixture.mjs";

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL("../../tools/convert.mjs", import.meta.url));

// Every course matched, every code known, every email named: the page should take the output.
function cleanSchool() {
  const raw = rawSchool();
  raw["allocation.xlsx"].push(["MORV-1", "MORV-1 Glacier Camp", "Cara Lim", "", ""]);
  raw["returning.xlsx"][2][2] = "SING-1";
  raw["round1.xlsx"][3][2] = "Moravia — Glacier Camp";
  return raw;
}

async function rawFolder(raw) {
  const dir = await mkdtemp(join(tmpdir(), "convert-"));
  await mkdir(join(dir, "raw"));
  for (const [name, rows] of Object.entries(raw)) await writeFile(join(dir, "raw", name), await writeBook([{ name: "Form Responses 1", rows }]));
  return dir;
}

const convertInto = (dir) => run(process.execPath, [TOOL, "--in", join(dir, "raw"), "--out", join(dir, "out")]);
const six = async (dir) => (await Promise.all(SLOTS.map(async (name) => {
  try {
    return { name, bytes: new Uint8Array(await readFile(join(dir, "out", name))) };
  } catch {
    return null; // round2.xlsx is optional
  }
}))).filter(Boolean);

test("clean raw files become six files the page takes, with a report", async () => {
  const dir = await rawFolder(cleanSchool());
  const { stdout } = await convertInto(dir);
  const { school, slots } = await parseFiles(await six(dir));
  assert.ok(school, JSON.stringify(slots));
  assert.equal(school.teachers.length, 3);
  const report = await readFile(join(dir, "out", "convert-report.txt"), "utf8");
  assert.match(report.trim().split("\n").at(-1), /Start takes these files/);
  assert.match(stdout, /Start takes these files/);
});

test("a second run into the same folder stops and changes nothing", async () => {
  const dir = await rawFolder(cleanSchool());
  await convertInto(dir);
  const before = (await stat(join(dir, "out", "staff.xlsx"))).mtimeMs;
  await assert.rejects(convertInto(dir), (e) => e.code === 1 && /already/.test(e.stderr));
  assert.equal((await stat(join(dir, "out", "staff.xlsx"))).mtimeMs, before);
});

test("an unmatched choice still converts, and the report ends with the page's own line", async () => {
  const dir = await rawFolder(rawSchool());
  await convertInto(dir);
  const report = await readFile(join(dir, "out", "convert-report.txt"), "utf8");
  assert.match(report, /Atlantis — Sunken City/);
  assert.match(report.trim().split("\n").at(-1), /^Start would show: .*\.xlsx/);
});

test("a missing raw file stops the run with its name", async () => {
  const raw = cleanSchool();
  delete raw["allocation.xlsx"];
  const dir = await rawFolder(raw);
  await assert.rejects(convertInto(dir), (e) => e.code === 1 && /allocation\.xlsx/.test(e.stderr));
});
