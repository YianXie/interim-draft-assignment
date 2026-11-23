// What a drop or the file chooser holds, as plain files: folders opened, zips unpacked. Invented names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { expand } from "../../src/drop.js";

const file = (name, text = name) => new File([text], name);
const names = (list) => list.map((f) => f.name).sort();
const textOf = async (f) => new TextDecoder().decode(await f.arrayBuffer());

// The browser's folder entries, made up: readEntries hands back a batch at a time, then an empty one.
const fileEntry = (f) => ({ isDirectory: false, isFile: true, name: f.name, file: (ok) => ok(f) });
const dirEntry = (name, children, batch = 2) => ({
  isDirectory: true, isFile: false, name,
  createReader() {
    let at = 0;
    return { readEntries(ok) { const part = children.slice(at, at + batch); at += batch; setTimeout(() => ok(part)); } };
  },
});

test("loose files pass through as they came, whatever their name", async () => {
  const got = await expand([{ entry: null, file: file("courses.xlsx") }, { entry: null, file: file("notes.txt") }]);
  assert.deepEqual(names(got), ["courses.xlsx", "notes.txt"]);
});

test("a dropped folder gives its .xlsx files at every level, and nothing hidden", async () => {
  const folder = dirEntry("this year", [
    fileEntry(file("courses.xlsx")), fileEntry(file("staff.xlsx")), fileEntry(file(".DS_Store")),
    fileEntry(file("convert-report.txt")), fileEntry(file("._courses.xlsx")),
    dirEntry("forms", [fileEntry(file("round1.xlsx")), fileEntry(file("Round2 (1).xlsx"))]),
    dirEntry(".hidden", [fileEntry(file("returning.xlsx"))]),
  ]);
  const got = await expand([{ entry: folder, file: file("this year", "") }]);
  assert.deepEqual(names(got), ["Round2 (1).xlsx", "courses.xlsx", "round1.xlsx", "staff.xlsx"]);
});

test("a zip gives its .xlsx files by their own names, leaving out the Mac's extra entries", async () => {
  const zip = zipSync({
    "sample/courses.xlsx": strToU8("c"), "sample/staff.xlsx": strToU8("s"), "readme.txt": strToU8("r"),
    "__MACOSX/sample/._courses.xlsx": strToU8("x"), "sample/.~lock.staff.xlsx": strToU8("x"),
  });
  const got = await expand([{ entry: null, file: new File([zip], "sample-this-year.zip") }]);
  assert.deepEqual(names(got), ["courses.xlsx", "staff.xlsx"]);
  assert.equal(await textOf(got.find((f) => f.name === "courses.xlsx")), "c");
});

test("a zip with no .xlsx in it, or that is not a zip, is passed on so its line says what was dropped", async () => {
  const empty = new File([zipSync({ "readme.txt": strToU8("r") })], "notes.zip");
  const broken = file("broken.zip", "not a zip");
  assert.deepEqual(names(await expand([{ entry: null, file: empty }, { entry: null, file: broken }])), ["broken.zip", "notes.zip"]);
});
