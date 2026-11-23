// What a drop or the file chooser holds, as plain files. A dropped folder is opened at every level and a .zip is
// unpacked, each giving only its .xlsx files, so a folder made by the converter or the sample zip can be dropped as it
// is. Anything else is passed on as it came, so its line on Start still says what was dropped. No Node modules.
import { unzipSync } from "fflate";

// Hidden files and the Mac's own extras (.DS_Store, ._courses.xlsx, __MACOSX/) are never the office's files.
const hidden = (part) => part.startsWith(".") || part === "__MACOSX";
const isXlsx = (name) => /\.xlsx$/i.test(name);

const entriesOf = (dir) => new Promise((resolve, reject) => {
  const reader = dir.createReader(), all = [];
  // readEntries hands back one batch at a time, then an empty one.
  const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
  next();
});
const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function folder(dir) {
  const out = [];
  for (const entry of await entriesOf(dir)) {
    if (hidden(entry.name)) continue;
    if (entry.isDirectory) out.push(...(await folder(entry)));
    else if (isXlsx(entry.name)) out.push(await fileOf(entry));
  }
  return out;
}

// Each .xlsx in the zip under its own name, wherever it sits in the zip. A zip with none, or a file that is not a zip, comes back as it was.
async function unzip(file) {
  let parts;
  try {
    parts = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return [file];
  }
  const found = Object.entries(parts).filter(([path]) => isXlsx(path) && !path.split("/").some(hidden));
  if (!found.length) return [file];
  return found.map(([path, bytes]) => ({ name: path.split("/").pop(), arrayBuffer: async () => bytes.slice().buffer }));
}

// items: [{ entry, file }], taken while the drop event lasts. entry is the item's webkitGetAsEntry(), or null.
export async function expand(items) {
  const out = [];
  for (const { entry, file } of items) {
    if (entry && entry.isDirectory) out.push(...(await folder(entry)));
    else if (file && /\.zip$/i.test(file.name)) out.push(...(await unzip(file)));
    else if (file) out.push(file);
  }
  return out;
}
