import mammoth from 'mammoth';
import { makeBlock, makeTableBlock } from '../blockModel.js';

// DOCX already carries semantic style info (Word's built-in Heading 1..6,
// List Paragraph + numId, table structures). Mammoth maps most of that
// straight to clean HTML, so unlike PDF we don't need font-size clustering
// here — we just need to walk the HTML tree it produces. Confidence is high
// (0.9) because it comes from the author's actual applied styles, not a guess,
// except for the header-row guess on tables which is still a heuristic.

export async function parseDocx(arrayBuffer) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // Keeps simple inline formatting so we can detect bold/italic runs.
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ],
    }
  );

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.value, 'text/html');
  const blocks = [];

  for (const node of doc.body.children) {
    const block = elementToBlock(node);
    if (block) blocks.push(block);
  }

  return {
    blocks,
    warnings: result.messages
      .filter((m) => m.type === 'warning')
      .map((m) => m.message),
  };
}

function elementToBlock(node) {
  const tag = node.tagName.toLowerCase();
  const source = { format: 'docx', page: null };

  if (/^h[1-6]$/.test(tag)) {
    return makeBlock({
      type: 'heading',
      level: Number(tag[1]),
      text: node.textContent.trim(),
      confidence: 0.9,
      source,
    });
  }

  if (tag === 'blockquote') {
    return makeBlock({ type: 'blockquote', text: node.textContent.trim(), confidence: 0.85, source });
  }

  if (tag === 'ul' || tag === 'ol') {
    // Flatten each <li> into its own block; nested lists become deeper level.
    const out = [];
    walkList(node, 0, tag === 'ol', out, source);
    return out.length === 1 ? out[0] : { multi: out };
  }

  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((cell) => cell.textContent.trim())
    );
    const firstRowIsHeader = node.querySelector('thead') !== null || rowLooksLikeHeader(rows[0], rows[1]);
    return makeTableBlock(rows, { headerRow: firstRowIsHeader ? 0 : null, confidence: 0.7, source });
  }

  if (tag === 'p') {
    const text = node.textContent.trim();
    if (!text) return null;
    const bold = node.children.length === 1 && node.children[0].tagName === 'STRONG';
    return makeBlock({ type: 'paragraph', text, bold, confidence: 0.9, source });
  }

  if (tag === 'pre' || tag === 'code') {
    return makeBlock({ type: 'code', text: node.textContent, confidence: 0.7, source });
  }

  // Fallback: treat unknown block-level elements as paragraphs so nothing is silently dropped.
  const text = node.textContent.trim();
  return text ? makeBlock({ type: 'paragraph', text, confidence: 0.5, source }) : null;
}

function walkList(listNode, depth, ordered, out, source) {
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
        confidence: 0.9,
        source,
      })
    );
    const nested = li.querySelector(':scope > ul, :scope > ol');
    if (nested) walkList(nested, depth + 1, nested.tagName === 'OL', out, source);
  }
}

// Heuristic: a header row usually differs in style from the body — mammoth
// doesn't preserve cell shading, so fall back to "first row, unless the
// document has no rows below it to compare against".
function rowLooksLikeHeader(first, second) {
  if (!first) return false;
  if (!second) return true;
  return true;
}

// docxParser.parseDocx can return blocks mixed with { multi: [...] } markers
// from list flattening — this flattens the final array before use.
export function flattenBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.multi) out.push(...b.multi);
    else out.push(b);
  }
  return out;
}
