import { test } from "node:test";
import assert from "node:assert/strict";
import { readBook, writeBook } from "../../src/xlsx.js";

test("writeBook then readBook keeps sheet names and row values, and text stays text", async () => {
  const bytes = await writeBook([{ name: "Draft", rows: [["Teacher", "Course", "Seats"], ["T001", "=SUM(1)", 3]] }]);
  assert.ok(bytes instanceof Uint8Array);
  const book = await readBook(bytes);
  assert.equal(book.length, 1);
  assert.equal(book[0].name, "Draft");
  assert.deepEqual(book[0].rows, [["Teacher", "Course", "Seats"], ["T001", "=SUM(1)", 3]]);
  assert.equal(typeof book[0].rows[1][1], "string");
});
