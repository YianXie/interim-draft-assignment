// The reader's workbook: the fit.xlsx rows on Fit, and every answer on Answers.
import { FIT, HEADERS } from "../../src/import.js";
import { writeBook } from "../../src/xlsx.js";

export const fitBook = ({ rows, answersSheet }) => writeBook([
  { name: "Fit", rows: [HEADERS[FIT], ...rows] },
  { name: "Answers", rows: [["Email", "Form", "Answer"], ...answersSheet] },
]);
