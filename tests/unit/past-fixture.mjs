// Helper, not a test: parses fixtures/school/ and fixtures/past/ into a School with last year attached.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFiles, SLOTS, PAST_SLOTS } from "../../src/import.js";

const path = (dir, name) => fileURLToPath(new URL(`../../fixtures/${dir}/${name}`, import.meta.url));

export const pastFiles = PAST_SLOTS.map((name) => path("past", name));

export async function readPastSchool(random) {
  const paths = [...SLOTS.map((name) => path("school", name)), ...pastFiles];
  const files = await Promise.all(paths.map(async (p) => ({ name: basename(p), bytes: new Uint8Array(await readFile(p)) })));
  const out = await parseFiles(files, random);
  if (!out.school) throw new Error(`fixture school with past files refused: ${JSON.stringify(out.slots)}`);
  return out.school;
}
