import { groupItemsIntoLines } from './parsers/pdfParser.js';

// This is the manual escape hatch for the thing PDF genuinely can't tell us
// automatically: which whitespace gaps are column boundaries. The user draws
// a box around what they can see is a table; we take every text item whose
// center falls inside that box, group it into rows the same way the rest of
// the pipeline does, then split each row into cells wherever the horizontal
// gap between words is much wider than a normal inter-word space — the same
// "stream"-style heuristic tools like Camelot use for borderless tables.
//
// It won't be perfect. That's fine — the result lands in the same
// TableEditor grid used everywhere else, so misaligned columns are a few
// clicks to fix rather than a re-run.

const PADDING = 2; // pdf-space units of slack around the drawn selection

export async function extractTableFromRegion(pdfDoc, pageNum, selection) {
  const { xMin, xMax, yMin, yMax } = selection;
  const page = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();

  const inRegion = content.items.filter((item) => {
    const x = item.transform[4];
    const y = item.transform[5];
    const w = item.width || 0;
    const cx = x + w / 2;
    return cx >= xMin - PADDING && cx <= xMax + PADDING && y >= yMin - PADDING && y <= yMax + PADDING;
  });

  const lines = groupItemsIntoLines(inRegion).filter((l) => l.text);
  if (!lines.length) {
    return { rows: [], bbox: null };
  }

  // Split each line into cells wherever the gap between words is unusually
  // wide relative to the line's own font size (a real column break, not just
  // a space between two words in the same cell).
  const rowsOfCells = lines.map((line) => splitLineIntoCells(line));

  // Use the row with the most cells as the column reference; snap every
  // other row's cells onto those column positions by nearest x-start. Rows
  // with genuinely fewer values (merged/empty cells) get padded.
  const referenceRow = rowsOfCells.reduce((a, b) => (b.length > a.length ? b : a), rowsOfCells[0]);
  const colStarts = referenceRow.map((c) => c.x);
  const colCount = colStarts.length;

  const rows = rowsOfCells.map((cells) => {
    const row = Array(colCount).fill('');
    for (const cell of cells) {
      const colIdx = nearestIndex(colStarts, cell.x);
      row[colIdx] = row[colIdx] ? `${row[colIdx]} ${cell.text}` : cell.text;
    }
    return row;
  });

  const bbox = {
    xMin: Math.min(...lines.map((l) => l.x)),
    xMax: Math.max(...lines.map((l) => l.xMax)),
    yMin: Math.min(...lines.map((l) => l.yBottom)),
    yMax: Math.max(...lines.map((l) => l.yTop)),
  };

  return { rows, bbox };
}

function splitLineIntoCells(line) {
  const items = line.rawItems;
  const gapThreshold = line.fontSize * 1.6; // wider than a normal word-space, narrower than a real column gap
  const cells = [];
  let current = { x: items[0].x, text: items[0].text };
  let prevEnd = items[0].x + items[0].width;

  for (let i = 1; i < items.length; i += 1) {
    const item = items[i];
    const gap = item.x - prevEnd;
    if (gap > gapThreshold) {
      cells.push(current);
      current = { x: item.x, text: item.text };
    } else {
      current.text += ` ${item.text}`;
    }
    prevEnd = item.x + item.width;
  }
  cells.push(current);
  return cells.map((c) => ({ x: c.x, text: c.text.trim() }));
}

function nearestIndex(sortedXs, x) {
  let best = 0;
  let bestDist = Infinity;
  sortedXs.forEach((sx, i) => {
    const d = Math.abs(sx - x);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
