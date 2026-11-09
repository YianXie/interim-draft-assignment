// Helper, not a test: parses fixtures/school/ into a School.
import { readFile } from "node:fs/promises";
import { parseFiles, SLOTS } from "../../src/import.js";

const dir = new URL("../../fixtures/school/", import.meta.url);

export async function readSchool(random) {
  const files = await Promise.all(
    SLOTS.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(new URL(name, dir))) })),
  );
  const out = await parseFiles(files, random);
  if (!out.school) throw new Error(`fixture school refused: ${JSON.stringify(out.slots)}`);
  return out.school;
}
