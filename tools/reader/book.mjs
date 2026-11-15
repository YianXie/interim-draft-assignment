// The reader's workbook: the fit.xlsx rows on Fernhollow, and every answer on Answers.
import { FIT, HEADERS } from "../../src/import.js";
import { writeBook } from "../../src/xlsx.js";

export const fitBook = ({ rows, answersSheet }) => writeBook([
  { name: "Fernhollow", rows: [HEADERS[FIT], ...rows] },
  { name: "Answers", rows: [["Email", "Form", "Answer"], ...answersSheet] },
]);
