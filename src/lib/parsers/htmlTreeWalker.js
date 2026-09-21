import { makeBlock, makeTableBlock } from '../blockModel.js';

// One tree-walker, reused by every reader whose source material is (or gets
// converted to) an HTML/XHTML DOM tree: DOCX via mammoth's HTML output, plain
// .html files, and EPUB chapters (which are XHTML). Keeping the tag-mapping
// rules in one place means DOCX, HTML and EPUB documents all get identical
// treatment for headings/lists/tables/quotes rather than three slightly
// different reimplementations drifting apart over time.

export function elementsToBlocks(containerElement, { format, confidence = 0.9 }) {
  const blocks = [];
  for (const node of containerElement.children) {
    const result = elementToBlock(node, { format, confidence });
    if (!result) continue;
    if (result.multi) blocks.push(...result.multi);
    else blocks.push(result);
  }
  return blocks;
}

function elementToBlock(node, ctx) {
  const tag = node.tagName.toLowerCase();
  const source = { format: ctx.format, page: null };

  if (/^h[1-6]$/.test(tag)) {
    return makeBlock({
      type: 'heading',
      level: Number(tag[1]),
      text: node.textContent.trim(),
      confidence: ctx.confidence,
      source,
    });
  }

  if (tag === 'blockquote') {
    return makeBlock({
      type: 'blockquote',
      text: node.textContent.trim(),
      confidence: ctx.confidence - 0.05,
      source,
    });
  }

  if (tag === 'ul' || tag === 'ol') {
    const out = [];
    walkList(node, 0, tag === 'ol', out, ctx);
    return out.length === 1 ? out[0] : { multi: out };
  }

  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((cell) => cell.textContent.trim())
    );
    const firstRowIsHeader = node.querySelector('thead') !== null || rowLooksLikeHeader(rows[0], rows[1]);
    return makeTableBlock(rows, { headerRow: firstRowIsHeader ? 0 : null, confidence: 0.7, source });
  }

  if (tag === 'p' || tag === 'div') {
    const text = node.textContent.trim();
    if (!text) return null;
    // Only mark the whole block bold/italic if that one child accounts for
    // the entire text content — otherwise this is a partial inline run
    // (e.g. "This is a **bold** word") which the block model has no
    // representation for. Better to lose the emphasis on part of a
    // paragraph than to wrongly bold the whole thing.
    const onlyChild = node.children.length === 1 ? node.children[0] : null;
    const wholeTextMatches = onlyChild && onlyChild.textContent.trim() === text;
    const bold = wholeTextMatches && onlyChild.tagName === 'STRONG';
    const italic = wholeTextMatches && onlyChild.tagName === 'EM';
    return makeBlock({ type: 'paragraph', text, bold, italic, confidence: ctx.confidence, source });
  }

  if (tag === 'pre' || tag === 'code') {
    return makeBlock({ type: 'code', text: node.textContent, confidence: 0.7, source });
  }

  if (tag === 'img') {
    // No image-block type yet (see README roadmap) — record it as a flagged
    // paragraph rather than silently dropping the reference.
    const alt = node.getAttribute('alt') || '(image)';
    return makeBlock({ type: 'paragraph', text: `[image: ${alt}]`, confidence: 0.3, source });
  }

  // Fallback: treat unknown block-level elements as paragraphs so nothing is
  // silently dropped, but flag them clearly as a low-confidence guess.
  const text = node.textContent.trim();
  return text ? makeBlock({ type: 'paragraph', text, confidence: 0.5, source }) : null;
}

function walkList(listNode, depth, ordered, out, ctx) {
  for (const li of listNode.children) {
    if (li.tagName !== 'LI') continue;
    const directText = Array.from(li.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE || !/^(UL|OL)$/.test(n.tagName || ''))
      .map((n) => n.textContent)
      .join('')
      .trim();
    out.push(
      makeBlock({
        type: ordered ? 'numbered' : 'bullet',
        level: depth,
        text: directText,
        confidence: ctx.confidence,
        source: { format: ctx.format, page: null },
      })
    );
    const nested = li.querySelector(':scope > ul, :scope > ol');
    if (nested) walkList(nested, depth + 1, nested.tagName === 'OL', out, ctx);
  }
}

// Heuristic: without cell-shading info (mammoth/HTML don't reliably preserve
// it) the best signal for "is the first row a header" is just "yes, unless
// there's nothing below it to be a header of".
function rowLooksLikeHeader(first, second) {
  if (!first) return false;
  if (!second) return true;
  return true;
}
