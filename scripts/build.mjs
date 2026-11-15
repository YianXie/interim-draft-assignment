import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { SLOTS, PAST_SLOTS } from "../src/import.js";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  outfile: "dist/app.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  // The solver's CommonJS build: its ES module build needs top-level import.meta, which a browser bundle does not have. Its node: requires only run under Node.
  alias: { highs: "./node_modules/highs/build/highs.js" },
  external: ["fs", "path", "node:*"],
  logLevel: "warning",
});
await cp("public", "dist", { recursive: true });
await cp("node_modules/highs/build/highs.wasm", "dist/highs.wasm");
// The invented school, served next to the page for the Use sample data button.
await cp("fixtures/school", "dist/sample", { recursive: true });
// Last year's invented files, for the same button on the Last year tab.
await cp("fixtures/past", "dist/sample", { recursive: true });
// The same files as two zips, for the Download sample data link on each tab. The .xlsx files are already compressed, so they are stored as they are.
const zip = async (dir, names, out) => {
  const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, [new Uint8Array(await readFile(`${dir}/${n}`)), { level: 0 }]])));
  await writeFile(`dist/sample/${out}`, zipSync(files));
};
await zip("fixtures/school", SLOTS, "sample-this-year.zip");
await zip("fixtures/past", PAST_SLOTS, "sample-last-year.zip");
console.log("built dist/");
