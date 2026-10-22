// The block model is the single normalized representation every source format
// (PDF, DOCX) gets converted into, and the only thing the editor and the
// markdown exporter ever touch. Neither of them needs to know where a block
// came from.
//
// Block shape:
// {
//   id: string,                 // stable id, used for React keys + undo stack
//   type: 'heading'|'paragraph'|'bullet'|'numbered'|'table'|'blockquote'|'code'|'image',
//   level: number,               // heading level 1-6, or list indent depth (0-based)
//   text: string,                // inline text content (not used for 'table')
//   bold: boolean,
//   italic: boolean,
//   rows: string[][]|null,       // only for type === 'table'
//   headerRow: number|null,      // index of the header row within rows, or null
//   headerCol: number|null,      // index of the header column within rows, or null
//   confidence: number,          // 0-1, how sure the classifier was. 1 = certain (e.g. DOCX built-in style)
//   source: { format: 'pdf'|'docx', page: number|null },
// }

let idCounter = 0;
export function nextId() {
  idCounter += 1;
  return `blk_${idCounter}_${Date.now().toString(36)}`;
}

export function makeBlock(partial) {
  return {
    id: nextId(),
    type: 'paragraph',
    level: 0,
    text: '',
    bold: false,
    italic: false,
    rows: null,
    headerRow: null,
    headerCol: null,
    isTitle: false, // Word "Title" style paragraph
    titleApplied: false, // Title has been promoted to H1
    titleShift: 0, // 1 = heading moved down a level, -1 = was H6 and could not move
    confidence: 1,
    source: { format: 'unknown', page: null },
    ...partial,
  };
}

export function makeTableBlock(rows, { headerRow = 0, headerCol = null, confidence = 0.6, source } = {}) {
  return makeBlock({
    type: 'table',
    rows,
    headerRow: rows.length ? headerRow : null,
    headerCol,
    confidence,
    source,
  });
}

export const BLOCK_TYPES = [
  { value: 'heading-1', label: 'Heading 1', type: 'heading', level: 1 },
  { value: 'heading-2', label: 'Heading 2', type: 'heading', level: 2 },
  { value: 'heading-3', label: 'Heading 3', type: 'heading', level: 3 },
  { value: 'heading-4', label: 'Heading 4', type: 'heading', level: 4 },
  { value: 'heading-5', label: 'Heading 5', type: 'heading', level: 5 },
  { value: 'heading-6', label: 'Heading 6', type: 'heading', level: 6 },
  { value: 'paragraph', label: 'Paragraph', type: 'paragraph', level: 0 },
  { value: 'bullet', label: 'Bulleted list item', type: 'bullet', level: 0 },
  { value: 'numbered', label: 'Numbered list item', type: 'numbered', level: 0 },
  { value: 'blockquote', label: 'Quote', type: 'blockquote', level: 0 },
  { value: 'code', label: 'Code block', type: 'code', level: 0 },
];

export function blockTypeKey(block) {
  if (block.type === 'heading') return `heading-${block.level || 1}`;
  return block.type;
}

// Used by the "select a region and mark it as a table" flow (PdfSourceView).
// Removes every PDF-sourced block that falls fully inside the user's drawn
// region on the given page, and inserts the reconstructed table block in
// their place. Blocks only partially overlapping the region (e.g. a
// paragraph the box just brushes the edge of) are left alone — better to
// leave a stray line for the user to clean up than to eat real content.
export function insertTableAtRegion(blocks, tableBlock, pageNum, regionBbox) {
  const isFullyInside = (b) =>
    b.source?.format === 'pdf' &&
    b.source.page === pageNum &&
    b.source.yTop != null &&
    b.source.yTop <= regionBbox.yMax + 1 &&
    b.source.yBottom >= regionBbox.yMin - 1;

  const kept = [];
  let insertIndex = null;
  for (const b of blocks) {
    if (isFullyInside(b)) {
      if (insertIndex === null) insertIndex = kept.length;
      continue;
    }
    kept.push(b);
  }
  kept.splice(insertIndex ?? kept.length, 0, tableBlock);
  return kept;
}

// ---- "Use document Title as H1" option (Word documents) -------------------
//
// Word's Title style has no Markdown equivalent of its own. When a document
// has one, the person can choose to promote it to H1; every other heading then
// moves down a level (H1 -> H2 ... H5 -> H6) so the outline stays consistent.
// H6 has nowhere to go, so it stays H6 and is counted so the UI can say so.
// Both directions are reversible, and both go through the editor's undo stack.

export function titleBlocks(blocks) {
  return blocks.filter((b) => b.isTitle);
}

export function titleAsH1Active(blocks) {
  return blocks.some((b) => b.isTitle && b.titleApplied);
}

export function clampedHeadingCount(blocks) {
  return blocks.filter((b) => b.titleShift === -1).length;
}

export function applyTitleAsH1(blocks) {
  return blocks.map((b) => {
    if (b.isTitle && !b.titleApplied) {
      return { ...b, type: 'heading', level: 1, titleApplied: true, confidence: 1 };
    }
    if (b.type === 'heading' && !b.isTitle && !b.titleShift) {
      const level = Math.min(6, (b.level || 1) + 1);
      return { ...b, level, titleShift: level === b.level ? -1 : 1 };
    }
    return b;
  });
}

export function revertTitleAsH1(blocks) {
  return blocks.map((b) => {
    if (b.isTitle && b.titleApplied) {
      return { ...b, type: 'paragraph', level: 0, titleApplied: false };
    }
    if (b.type === 'heading' && b.titleShift === 1) {
      return { ...b, level: Math.max(1, (b.level || 2) - 1), titleShift: 0 };
    }
    if (b.titleShift === -1) return { ...b, titleShift: 0 };
    return b;
  });
}
