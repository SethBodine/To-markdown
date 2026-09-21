import readXlsxFile from 'read-excel-file/universal';
import { makeBlock, makeTableBlock } from '../blockModel.js';

// A spreadsheet has no "this is a paragraph" content at all — every sheet
// just becomes a heading (the sheet name) followed by a table block, which
// then goes through the same table-repair grid as any other detected table.
// Unlike a real document, a spreadsheet's format never tells us which row is
// a header — "first row" is a convention, not a fact — so header-row
// confidence is deliberately middling rather than high.
//
// Uses read-excel-file rather than the more well-known SheetJS "xlsx"
// package: SheetJS's npm-published build has a known high-severity
// prototype-pollution/ReDoS advisory (GHSA-4r6h-8v6p-xvw6,
// GHSA-5pgg-2g8v-p4x9) in exactly the code path this app exercises
// (parsing untrusted, user-supplied files), and the fixed version was never
// republished to npm — only to SheetJS's own CDN, which this project's CSP
// and offline-build model can't and shouldn't depend on.

export async function parseXlsx(arrayBuffer) {
  const sheets = await readXlsxFile(arrayBuffer);
  const blocks = [];

  for (const { sheet: sheetName, data } of sheets) {
    const rows = data
      .filter((row) => row.some((cell) => cell != null && String(cell).trim() !== ''))
      .map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
    if (!rows.length) continue;

    blocks.push(
      makeBlock({
        type: 'heading',
        level: 1,
        text: sheetName,
        confidence: 0.9,
        source: { format: 'xlsx', page: null },
      })
    );
    blocks.push(
      makeTableBlock(rows, {
        headerRow: 0,
        confidence: 0.55, // "first row is the header" is a convention, not something the file states
        source: { format: 'xlsx', page: null },
      })
    );
  }

  return { blocks, warnings: [] };
}
