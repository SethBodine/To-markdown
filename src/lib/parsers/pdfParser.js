import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// PDF has no semantic structure at all — no "this is a heading" flag anywhere
// in the format. All we get is: text runs, their font, their size, and their
// position on the page. Everything downstream (classifier.js, and the
// select-a-region-and-mark-as-table flow in pdfTableRegion.js) is inference
// from that raw layout.

const Y_TOLERANCE = 2.5; // pdf-space units; items within this y-delta are treated as the same line

export async function loadPdfDocument(arrayBuffer) {
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

// Groups pdf.js text items into visual lines (same logic used both for the
// whole-document extraction below and for reconstructing a table from a
// user-selected region in pdfTableRegion.js).
export function groupItemsIntoLines(items) {
  const buckets = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width || item.str.length * fontSize * 0.5;
    const bold = /bold/i.test(item.fontName || '');

    let bucket = buckets.find((b) => Math.abs(b.y - y) <= Y_TOLERANCE);
    if (!bucket) {
      bucket = { y, items: [] };
      buckets.push(bucket);
    }
    bucket.items.push({ text: item.str, fontSize, x, width, bold });
  }

  // PDF y-axis increases upward — sort top-to-bottom for reading order.
  buckets.sort((a, b) => b.y - a.y);

  return buckets.map((bucket) => {
    bucket.items.sort((a, b) => a.x - b.x);
    const text = bucket.items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
    const fontSize = Math.max(...bucket.items.map((i) => i.fontSize));
    const bold = bucket.items.some((i) => i.bold);
    const x = Math.min(...bucket.items.map((i) => i.x));
    const xMax = Math.max(...bucket.items.map((i) => i.x + i.width));
    // Approximate the line's vertical extent from its baseline (bucket.y) and font size.
    const yTop = bucket.y + fontSize * 0.8;
    const yBottom = bucket.y - fontSize * 0.3;
    return { text, fontSize, bold, x, xMax, yTop, yBottom, yBaseline: bucket.y, rawItems: bucket.items };
  });
}

export async function extractPdfLines(pdfDoc) {
  const lines = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageLines = groupItemsIntoLines(content.items).filter((l) => l.text);
    for (const line of pageLines) {
      lines.push({ ...line, page: pageNum });
    }
  }
  return lines;
}
