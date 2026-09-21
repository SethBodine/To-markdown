import JSZip from 'jszip';
import { makeBlock, makeTableBlock } from '../blockModel.js';

// ODT is a zip archive containing content.xml (the document body) written in
// the OpenDocument XML vocabulary — text:h, text:p, text:list, table:table,
// etc. This walks that vocabulary directly per the ODF spec's element names,
// the same way docxParser.js walks mammoth's HTML output for DOCX. It is
// deliberately its own reader rather than routed through the shared HTML
// tree-walker, since ODF's tag set (text:*, table:*) is a different
// vocabulary from HTML, not a variant of it.

export async function parseOdt(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const contentXml = await zip.file('content.xml')?.async('string');
  if (!contentXml) {
    throw new Error('This .odt file has no content.xml — it may be corrupted or not a valid ODT file.');
  }
  const stylesXml = (await zip.file('styles.xml')?.async('string')) || '';

  const orderedListStyles = collectOrderedListStyles(contentXml, stylesXml);

  const doc = new DOMParser().parseFromString(contentXml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Could not parse this .odt file\u2019s content.xml as XML.');
  }

  const body = doc.getElementsByTagName('office:text')[0];
  if (!body) {
    return { blocks: [], warnings: ['No office:text body found in this ODT file.'] };
  }

  const blocks = [];
  for (const node of Array.from(body.children)) {
    const result = elementToBlock(node, orderedListStyles);
    if (!result) continue;
    if (result.multi) blocks.push(...result.multi);
    else blocks.push(result);
  }

  return { blocks, warnings: [] };
}

function elementToBlock(node, orderedListStyles) {
  const tag = node.tagName;
  const source = { format: 'odt', page: null };

  if (tag === 'text:h') {
    const level = Number(node.getAttribute('text:outline-level') || '1');
    return makeBlock({
      type: 'heading',
      level: Math.min(6, Math.max(1, level)),
      text: node.textContent.trim(),
      confidence: 0.9,
      source,
    });
  }

  if (tag === 'text:p') {
    const text = node.textContent.trim();
    if (!text) return null;
    const styleName = node.getAttribute('text:style-name') || '';
    const isQuote = /quotation/i.test(styleName);
    return makeBlock({
      type: isQuote ? 'blockquote' : 'paragraph',
      text,
      confidence: 0.85,
      source,
    });
  }

  if (tag === 'text:list') {
    const out = [];
    walkList(node, 0, orderedListStyles, out);
    return out.length === 1 ? out[0] : { multi: out };
  }

  if (tag === 'table:table') {
    const rows = Array.from(node.getElementsByTagName('table:table-row')).map((row) =>
      Array.from(row.getElementsByTagName('table:table-cell')).map((cell) => cell.textContent.trim())
    );
    const hasHeaderWrapper = node.getElementsByTagName('table:table-header-rows').length > 0;
    return makeTableBlock(rows, {
      headerRow: hasHeaderWrapper || rows.length > 1 ? 0 : null,
      confidence: hasHeaderWrapper ? 0.85 : 0.6,
      source,
    });
  }

  // Fallback: don't silently drop unknown block-level content.
  const text = node.textContent.trim();
  return text ? makeBlock({ type: 'paragraph', text, confidence: 0.4, source }) : null;
}

function walkList(listNode, depth, orderedListStyles, out) {
  const styleName = listNode.getAttribute('text:style-name') || '';
  const ordered = orderedListStyles.has(styleName);

  for (const item of Array.from(listNode.children)) {
    if (item.tagName !== 'text:list-item') continue;
    let directText = '';
    let nested = null;
    for (const child of Array.from(item.children)) {
      if (child.tagName === 'text:list') nested = child;
      else directText += child.textContent;
    }
    if (directText.trim()) {
      out.push(
        makeBlock({
          type: ordered ? 'numbered' : 'bullet',
          level: depth,
          text: directText.trim(),
          confidence: 0.8,
          source: { format: 'odt', page: null },
        })
      );
    }
    if (nested) walkList(nested, depth + 1, orderedListStyles, out);
  }
}

// ODF list styles are declared separately from where they're used (in
// content.xml's automatic-styles or in styles.xml) and say whether each
// level is a bullet or a number. Build a set of style names that resolve to
// an ordered (numbered) list so walkList can tell bullet from numbered
// without re-parsing on every list.
function collectOrderedListStyles(contentXml, stylesXml) {
  const ordered = new Set();
  for (const xml of [contentXml, stylesXml]) {
    if (!xml) continue;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) continue;
    for (const listStyle of Array.from(doc.getElementsByTagName('text:list-style'))) {
      const name = listStyle.getAttribute('style:name');
      if (!name) continue;
      if (listStyle.getElementsByTagName('text:list-level-style-number').length > 0) {
        ordered.add(name);
      }
    }
  }
  return ordered;
}
