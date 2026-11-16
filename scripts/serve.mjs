import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".zip": "application/zip",
};
const root = join(process.cwd(), "dist");
// 4173 unless INTERIM_PORT says otherwise, so the browser tests can run beside a demo that is already open.
const port = Number(process.env.INTERIM_PORT) || 4173;

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(root, path === "/" ? "index.html" : path));
    // Inside dist/ only: a sibling such as dist-old/ also starts with the same letters.
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
