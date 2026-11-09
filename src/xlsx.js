// The only file that imports hucre. Everything else reads and writes workbooks through these two functions.
import { readXlsx, writeXlsx } from "hucre";

export async function readBook(bytes) {
  const book = await readXlsx(bytes);
  return book.sheets.map((s) => ({ name: s.name, rows: s.rows }));
}

export async function writeBook(sheets) {
  return writeXlsx({ sheets: sheets.map((s) => ({ name: s.name, rows: s.rows })) });
}
