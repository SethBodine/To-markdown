import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import { makeBlock, makeTableBlock } from '../blockModel.js';

// Lets a person open an existing .md file, fix its structure in the same
// WYSIWYG editor used for every other format (re-level a heading, repair a
// table that hand-written markdown got wrong), then re-export it. Parses via
// remark/unified (MIT-licensed, CommonMark-based) into an mdast tree, then
// walks that tree the same way the other readers walk their own trees.
// remark-gfm adds table support, which isn't part of base CommonMark.

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

function mdastNodeToBlock(node, depth = 0) {
  const source = { format: 'markdown', page: null };

  switch (node.type) {
    case 'heading':
      return makeBlock({ type: 'heading', level: node.depth, text: mdastToString(node), confidence: 1, source });

    case 'paragraph': {
      const text = mdastToString(node).trim();
      if (!text) return null;
      const bold = node.children.length === 1 && node.children[0].type === 'strong';
      const italic = node.children.length === 1 && node.children[0].type === 'emphasis';
      return makeBlock({ type: 'paragraph', text, bold, italic, confidence: 1, source });
    }

    case 'blockquote':
      return makeBlock({ type: 'blockquote', text: mdastToString(node).trim(), confidence: 1, source });

    case 'code':
      return makeBlock({ type: 'code', text: node.value, confidence: 1, source });

    case 'list': {
      const out = [];
      walkMdastList(node, depth, out);
      return out.length === 1 ? out[0] : { multi: out };
    }

    case 'table': {
      const rows = node.children.map((row) => row.children.map((cell) => mdastToString(cell).trim()));
      return makeTableBlock(rows, { headerRow: rows.length ? 0 : null, confidence: 1, source });
    }

    case 'thematicBreak':
    case 'html':
      return null; // no block-model equivalent for a horizontal rule; dropping it loses nothing structural

    default: {
      const text = mdastToString(node).trim();
      return text ? makeBlock({ type: 'paragraph', text, confidence: 0.5, source }) : null;
    }
  }
}

function walkMdastList(listNode, depth, out) {
  const ordered = !!listNode.ordered;
  for (const item of listNode.children) {
    // A list item's first non-list child carries its direct text; any
    // nested `list` child is walked at depth + 1.
    const directChildren = item.children.filter((c) => c.type !== 'list');
    const nestedLists = item.children.filter((c) => c.type === 'list');
    const text = directChildren.map((c) => mdastToString(c)).join(' ').trim();

    if (text) {
      out.push(
        makeBlock({
          type: ordered ? 'numbered' : 'bullet',
          level: depth,
          text,
          confidence: 1,
          source: { format: 'markdown', page: null },
        })
      );
    }
    for (const nested of nestedLists) {
      walkMdastList(nested, depth + 1, out);
    }
  }
}
