// The two fixture generators draw from one shared piece of code, each with its own seed, and still write what is committed.
// The generators are run on a copy in a temporary folder, so fixtures/ itself is never written here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readBook } from "../../src/xlsx.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);
const GENERATORS = ["make_school.mjs", "make_past.mjs"];
let copy;

before(async () => {
  copy = await mkdtemp(join(tmpdir(), "fernhollow-generators-"));
  await mkdir(join(copy, "src"));
  await cp(join(root, "src/xlsx.js"), join(copy, "src/xlsx.js"));
  await cp(join(root, "tools"), join(copy, "tools"), { recursive: true });
  await symlink(join(root, "node_modules"), join(copy, "node_modules"), "dir");
  for (const script of GENERATORS) await run(process.execPath, [join(copy, "tools", script)]); // make_past reads what make_school wrote
});
after(() => rm(copy, { recursive: true, force: true }));

async function books(dir) {
  const out = {};
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".xlsx")).sort()) out[name] = await readBook(new Uint8Array(await readFile(join(dir, name))));
  return out;
}

test("the generators share one copy of the random draws", async () => {
  for (const script of GENERATORS) {
    const source = await readFile(join(root, "tools", script), "utf8");
    assert.ok(source.includes('from "./rng.mjs"'), `${script} takes its draws from tools/rng.mjs`);
    for (const name of ["mulberry32", "shuffle", "pickWeighted"]) assert.ok(!new RegExp(`function ${name}\\b`).test(source), `${script} has no ${name} of its own`);
  }
});

test("make_school still writes the committed school, cell for cell", async () => {
  const made = await books(join(copy, "fixtures/school"));
  assert.equal(Object.keys(made).length, 6);
  assert.deepEqual(made, await books(join(root, "fixtures/school")));
});

test("make_past still writes the committed past year, cell for cell", async () => {
  const made = await books(join(copy, "fixtures/past"));
  assert.equal(Object.keys(made).length, 4);
  assert.deepEqual(made, await books(join(root, "fixtures/past")));
});
