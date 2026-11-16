// The only file that imports hucre. Everything else reads and writes workbooks through these two functions.
import { readXlsx, writeXlsx } from "hucre";

export async function readBook(bytes) {
  const book = await readXlsx(bytes);
  return book.sheets.map((s) => ({ name: s.name, rows: s.rows }));
}

// properties is optional; a fixed { modified } date makes the bytes repeatable, as the fixture tools need.
export async function writeBook(sheets, properties) {
  return writeXlsx({ sheets: sheets.map((s) => ({ name: s.name, rows: s.rows })), ...(properties && { properties }) });
}
