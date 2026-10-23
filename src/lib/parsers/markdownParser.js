import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import { makeBlock, makeTableBlock } from '../blockModel.js';
import { escapeText, wrap, codeSpan, encodeHref, normalizeMd } from '../inlineMarkdown.js';

// Lets a person open an existing .md file, fix its structure in the same
// editor used for every other format, then re-export it. Parses via
// remark/unified (CommonMark + GFM) into an mdast tree. Inline formatting
// (bold, italic, links, code, strikethrough, footnote references) is kept as
// inline Markdown on each block rather than flattened to plain text.

export async function parseMarkdown(markdownText) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdownText);
  const blocks = [];
  for (const node of tree.children) {
    const block = mdastNodeToBlock(node);
    if (!block) continue;
    if (block.multi) blocks.push(...block.multi);
    else blocks.push(block);
  }
  return { blocks, warnings: [] };
}

function inlineNode(node) {
  const kids = () => (node.children || []).map(inlineNode).join('');
  switch (node.type) {
    case 'text': return escapeText(node.value);
    case 'strong': return wrap('**', kids());
    case 'emphasis': return wrap('*', kids());
    case 'delete': return wrap('~~', kids());
    case 'inlineCode': return codeSpan(node.value);
    case 'link': return `[${kids()}](${encodeHref(node.url)})`;
    case 'image': return `![${escapeText(node.alt || '')}](${encodeHref(node.url)})`;
    case 'break': return ' ';
    case 'footnoteReference': return `[^${node.identifier}]`;
    case 'html': return '';
    default: return node.children ? kids() : escapeText(node.value || '');
  }
}

function textAndMd(node) {
  const text = mdastToString(node).trim();
  const md = (node.children || []).map(inlineNode).join('').trim();
  return { text, md: normalizeMd(md, text) };
}

function paragraphsOf(node) {
  // Joined text for containers whose children are paragraphs (list items, quotes, footnotes).
  const parts = (node.children || []).filter((c) => c.type !== 'list');
  const text = parts.map((c) => mdastToString(c)).join(' ').trim();
  const md = parts
    .map((c) => (c.type === 'paragraph' ? (c.children || []).map(inlineNode).join('') : escapeText(mdastToString(c))))
    .join(' ')
    .trim();
  return { text, md: normalizeMd(md, text) };
}

function mdastNodeToBlock(node, depth = 0) {
  const source = { format: 'markdown', page: null };

  switch (node.type) {
    case 'heading':
    {
      // "## Title {#custom-id}" carries an anchor ID: keep it as a property, not as text.
      const t = textAndMd(node);
      let headingId = '';
      const strip = (str) => str.replace(/\s*\{#([\w-]+)\}\s*$/, (m, id) => { headingId = id; return ''; });
      const text = strip(t.text);
      const md = t.md != null ? normalizeMd(strip(t.md), text) : null;
      return makeBlock({ type: 'heading', level: node.depth, text, md, headingId, confidence: 1, source });
    }

    case 'paragraph': {
      if (node.children.length === 1 && node.children[0].type === 'image') {
        const img = node.children[0];
        return makeBlock({ type: 'image', alt: img.alt || '', href: img.url || '', title: img.title || '', confidence: 1, source });
      }
      const { text, md } = textAndMd(node);
      if (!text) return null;
      // "Term" on one line and ": Definition" on the next is a definition list entry.
      const def = /^([^\n]+)\n: ([\s\S]+)$/.exec(text);
      if (def) {
        const full = md != null ? md : escapeText(text);
        const k = full.indexOf('\n: ');
        const termMd = k >= 0 ? full.slice(0, k) : def[1];
        const descMd = k >= 0 ? full.slice(k + 3) : def[2];
        return makeBlock({
          type: 'definition', text: def[1], md: normalizeMd(termMd, def[1]),
          desc: def[2], descMd: normalizeMd(descMd, def[2]), confidence: 1, source,
        });
      }
      return makeBlock({ type: 'paragraph', text, md, confidence: 1, source });
    }

    case 'blockquote':
      return makeBlock({ type: 'blockquote', ...paragraphsOf(node), confidence: 1, source });

    case 'code':
      return makeBlock({ type: 'code', text: node.value, lang: node.lang || '', confidence: 1, source });

    case 'thematicBreak':
      return makeBlock({ type: 'hr', confidence: 1, source });

    case 'footnoteDefinition':
      return makeBlock({ type: 'footnote', label: node.identifier, ...paragraphsOf(node), confidence: 1, source });

    case 'list': {
      const out = [];
      walkMdastList(node, depth, out);
      return out.length === 1 ? out[0] : { multi: out };
    }

    case 'table': {
      const rows = node.children.map((row) => row.children.map((cell) => mdastToString(cell).trim()));
      const align = (node.align || []).map((a) => a || null);
      return makeTableBlock(rows, {
        headerRow: rows.length ? 0 : null,
        align: align.some(Boolean) ? align : null,
        confidence: 1,
        source,
      });
    }

    case 'html':
      return null; // raw HTML has no block equivalent; dropped rather than shown as markup

    default: {
      const text = mdastToString(node).trim();
      return text ? makeBlock({ type: 'paragraph', text, confidence: 0.5, source }) : null;
    }
  }
}

function walkMdastList(listNode, depth, out) {
  const ordered = !!listNode.ordered;
  for (const item of listNode.children) {
    const nestedLists = item.children.filter((c) => c.type === 'list');
    const { text, md } = paragraphsOf(item);
    const isTask = item.checked !== null && item.checked !== undefined;
    if (text) {
      out.push(
        makeBlock({
          type: isTask ? 'task' : ordered ? 'numbered' : 'bullet',
          checked: !!item.checked,
          level: depth,
          text,
          md,
          confidence: 1,
          source: { format: 'markdown', page: null },
        })
      );
    }
    for (const nested of nestedLists) walkMdastList(nested, depth + 1, out);
  }
}
