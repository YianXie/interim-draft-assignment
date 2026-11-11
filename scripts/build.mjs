import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

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
console.log("built dist/");
