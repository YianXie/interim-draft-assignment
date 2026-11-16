// Helper, not a test: parses the invented school with fixtures/fit/fit.xlsx added, with and without last year's four.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFiles, SLOTS, FIT } from "../../src/import.js";
import { pastFiles } from "./past-fixture.mjs";

const path = (dir, name) => fileURLToPath(new URL(`../../fixtures/${dir}/${name}`, import.meta.url));

export const fitFile = "fixtures/fit/fit.xlsx";

async function read(paths, random) {
  const files = await Promise.all(paths.map(async (p) => ({ name: basename(p), bytes: new Uint8Array(await readFile(p)) })));
  const out = await parseFiles(files, random);
  if (!out.school) throw new Error(`fixture school with fit.xlsx refused: ${JSON.stringify(out.slots)}`);
  return out.school;
}

const six = SLOTS.map((name) => path("school", name));
const fit = path("fit", FIT);

export const readFitSchool = (random) => read([...six, fit], random);
export const readPastFitSchool = (random) => read([...six, ...pastFiles, fit], random);
