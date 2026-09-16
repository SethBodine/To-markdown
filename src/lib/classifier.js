import { makeBlock } from './blockModel.js';

// This is the part of the pipeline that's genuinely a guess, and it's
// designed to be reviewed and corrected in the WYSIWYG editor rather than
// trusted blindly. Every block gets a `confidence` score; the editor uses it
// to decide what to visually flag for the user to check.
//
// Strategy:
//  1. Cluster line font sizes to find "body text size" (the mode).
//  2. Sizes meaningfully larger than body, ranked by size, become H1..H6.
//  3. Leading bullet glyphs / numbering patterns become list items; x-position
//     relative to the page's left margin becomes indent depth.
//  4. Anything left is a paragraph. Consecutive paragraph lines at the same
//     size get merged into one paragraph block (PDF has no explicit paragraph
//     breaks — this is the best signal we have without layout analysis).

const BULLET_RE = /^[•·‣◦o]\s+/;
const NUMBERED_RE = /^(\d+[.)]|[a-hA-H][.)])\s+/;
const INDENT_STEP = 18; // px per indent level, tuned for typical 12pt-body documents

export function classifyPdfLines(lines) {
  if (!lines.length) return [];

  const bodySize = findModeSize(lines);
  const headingSizes = [...new Set(lines.map((l) => round1(l.fontSize)))]
    .filter((s) => s > bodySize * 1.05)
    .sort((a, b) => b - a)
    .slice(0, 6);

  const leftMargin = Math.min(...lines.map((l) => l.x));

  const rawBlocks = lines.map((line) => classifyLine(line, { bodySize, headingSizes, leftMargin }));
  return mergeParagraphs(rawBlocks);
}

function classifyLine(line, { bodySize, headingSizes, leftMargin }) {
  const source = {
    format: 'pdf',
    page: line.page,
    yTop: line.yTop,
    yBottom: line.yBottom,
    xMin: line.x,
    xMax: line.xMax,
  };
  const size = round1(line.fontSize);
  const indentLevel = Math.max(0, Math.round((line.x - leftMargin) / INDENT_STEP));

  const headingRank = headingSizes.indexOf(size);
  if (headingRank !== -1 && line.text.length < 150) {
    const sizeGap = size - bodySize;
    const confidence = Math.min(0.95, 0.55 + sizeGap / bodySize + (line.bold ? 0.15 : 0));
    return makeBlock({
      type: 'heading',
      level: headingRank + 1,
      text: line.text,
      bold: line.bold,
      confidence,
      source,
    });
  }

  const bulletMatch = line.text.match(BULLET_RE);
  if (bulletMatch) {
    return makeBlock({
      type: 'bullet',
      level: indentLevel,
      text: line.text.slice(bulletMatch[0].length),
      confidence: 0.75,
      source,
    });
  }

  const numberedMatch = line.text.match(NUMBERED_RE);
  if (numberedMatch) {
    return makeBlock({
      type: 'numbered',
      level: indentLevel,
      text: line.text.slice(numberedMatch[0].length),
      confidence: 0.75,
      source,
    });
  }

  if (line.bold && line.text.length < 80) {
    // Bold, body-sized, short line: often a sub-heading or label. Flag with
    // lower confidence rather than silently calling it a heading.
    return makeBlock({
      type: 'heading',
      level: Math.min(6, headingSizes.length + 1),
      text: line.text,
      bold: true,
      confidence: 0.45,
      source,
    });
  }

  return makeBlock({
    type: 'paragraph',
    text: line.text,
    confidence: 0.6,
    source,
    _fontSize: size, // internal, stripped before merge output
  });
}

function mergeParagraphs(blocks) {
  const out = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (
      block.type === 'paragraph' &&
      prev &&
      prev.type === 'paragraph' &&
      prev.source.page === block.source.page &&
      prev._fontSize === block._fontSize
    ) {
      prev.text = `${prev.text} ${block.text}`.trim();
      prev.confidence = Math.min(prev.confidence, block.confidence);
      // Extend the merged block's bbox downward to cover the absorbed line.
      prev.source.yBottom = Math.min(prev.source.yBottom, block.source.yBottom);
      prev.source.xMax = Math.max(prev.source.xMax, block.source.xMax);
      continue;
    }
    out.push(block);
  }
  out.forEach((b) => delete b._fontSize);
  return out;
}

function findModeSize(lines) {
  const counts = new Map();
  for (const line of lines) {
    const s = round1(line.fontSize);
    counts.set(s, (counts.get(s) || 0) + line.text.length); // weight by text length, not line count
  }
  let best = lines[0].fontSize;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
