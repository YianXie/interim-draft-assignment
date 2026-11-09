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
  external: ["fs", "path"],
  logLevel: "warning",
});
await cp("public", "dist", { recursive: true });
await cp("node_modules/highs/build/highs.wasm", "dist/highs.wasm");
console.log("built dist/");
