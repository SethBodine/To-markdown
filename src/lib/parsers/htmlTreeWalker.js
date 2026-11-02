import { makeBlock, makeTableBlock } from '../blockModel.js';
import { domToMarkdown, escapeText } from '../inlineMarkdown.js';

// One tree-walker, reused by every reader whose source material is (or gets
// converted to) an HTML/XHTML DOM tree: DOCX via mammoth's HTML output, plain
// .html files, and EPUB chapters (which are XHTML). Keeping the tag-mapping
// rules in one place means DOCX, HTML and EPUB documents all get identical
// treatment for headings/lists/tables/quotes rather than three slightly
// different reimplementations drifting apart over time.

export function elementsToBlocks(containerElement, { format, confidence = 0.9, styleNames = null }) {
  const blocks = [];
  for (const node of containerElement.children) {
    const result = elementToBlock(node, { format, confidence, styleNames });
    if (!result) continue;
    if (result.multi) blocks.push(...result.multi);
    else blocks.push(result);
  }
  return blocks;
}

// Inline Markdown for a block, but only when the text really has formatting or
// links: plain text stays plain so blocks without markup are untouched.
function inlineMd(node, text) {
  const md = domToMarkdown(node).trim();
  return md !== escapeText(text.replace(/\u00a0/g, ' ')) ? md : null;
}

function imageBlock(img, ctx) {
  const src = img.getAttribute('src') || '';
  // Embedded (data:) images can't be referenced from Markdown, so the block is
  // created with no URL and flagged for the person to fill in or remove.
  const href = /^data:/i.test(src) ? '' : src;
  return makeBlock({
    type: 'image',
    alt: img.getAttribute('alt') || '',
    href,
    confidence: href ? 0.8 : 0.4,
    source: { format: ctx.format, page: null },
  });
}

function elementToBlock(node, ctx) {
  const tag = node.tagName.toLowerCase();
  const source = { format: ctx.format, page: null };

  if (/^h[1-6]$/.test(tag)) {
    const text = node.textContent.trim();
    return makeBlock({
      type: 'heading',
      level: Number(tag[1]),
      text,
      md: node.querySelector('a,code') ? inlineMd(node, text) : null,
      confidence: ctx.confidence,
      source,
    });
  }

  if (tag === 'blockquote') {
    const text = node.textContent.trim();
    return makeBlock({
      type: 'blockquote',
      text,
      md: inlineMd(node, text),
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

  if (tag === 'hr') return makeBlock({ type: 'hr', confidence: ctx.confidence, source });

  if (tag === 'p' || tag === 'div') {
    const text = node.textContent.trim();
    if (!text) {
      // A paragraph holding only pictures (how Word images arrive).
      const imgs = Array.from(node.querySelectorAll('img'));
      if (!imgs.length) return null;
      const blocks = imgs.map((img) => imageBlock(img, ctx));
      return blocks.length === 1 ? blocks[0] : { multi: blocks };
    }
    if (node.classList && node.classList.contains('docx-title')) {
      // Word "Title" style: kept as a paragraph until the person opts in to
      // treating it as H1 (see applyTitleAsH1 in blockModel.js).
      return makeBlock({ type: 'paragraph', text, isTitle: true, confidence: ctx.confidence, source });
    }
    // A Word paragraph style with no Markdown equivalent was tagged "mdstyle-N" by the DOCX reader.
    const styleClass = node.classList ? Array.from(node.classList).find((c) => /^mdstyle-\d+$/.test(c)) : null;
    const docStyle = styleClass && ctx.styleNames ? ctx.styleNames[Number(styleClass.slice(8))] || '' : '';
    // A paragraph that is entirely one bold/italic run keeps the simple
    // whole-block flag; anything with partial formatting or links keeps its
    // inline Markdown instead.
    const onlyChild = node.children.length === 1 ? node.children[0] : null;
    const wholeTextMatches = onlyChild && onlyChild.textContent.trim() === text;
    const bold = !!wholeTextMatches && onlyChild.tagName === 'STRONG';
    const italic = !!wholeTextMatches && onlyChild.tagName === 'EM';
    const md = bold || italic ? null : inlineMd(node, text);
    return makeBlock({ type: 'paragraph', text, md, bold, italic, docStyle, confidence: ctx.confidence, source });
  }

  if (tag === 'pre' || tag === 'code') {
    const codeEl = node.querySelector ? node.querySelector('code') : null;
    const cls = `${node.className || ''} ${codeEl ? codeEl.className || '' : ''}`;
    const lang = (/(?:language|lang)-([\w+#.-]+)/.exec(cls) || [])[1] || '';
    return makeBlock({ type: 'code', text: node.textContent, lang, confidence: 0.7, source });
  }

  if (tag === 'img') return imageBlock(node, ctx);

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
    // Inline Markdown for the item's own text (nested lists removed).
    const own = li.cloneNode(true);
    own.querySelectorAll('ul,ol').forEach((n) => n.remove());
    out.push(
      makeBlock({
        type: ordered ? 'numbered' : 'bullet',
        level: depth,
        text: directText,
        md: inlineMd(own, directText),
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
