// Builds Markdown from the block model: one pass, one function per block kind.
// Inline formatting lives in each block's `md` (real Markdown); blocks with no
// formatting fall back to their plain `text`, escaped.

import { inlineSource, escapeText, encodeHref } from './inlineMarkdown.js';

const INDENT = '    '; // four spaces per list level: nests correctly under bullets and numbers

const LIST = new Set(['bullet', 'numbered', 'task']);
const BLANKABLE = new Set(['heading', 'paragraph', 'bullet', 'numbered', 'task', 'blockquote', 'footnote']);

function emphasis(text, block) {
  if (!text) return text;
  if (block.bold && block.italic) return `***${text}***`;
  if (block.bold) return `**${text}**`;
  if (block.italic) return `*${text}*`;
  return text;
}

// Stop a paragraph that merely *starts* like Markdown syntax from turning into it.
function escapeBlockStart(s) {
  return s
    .replace(/^(#{1,6})(\s)/, '\\$1$2')
    .replace(/^>/, '\\>')
    .replace(/^([-+])(\s)/, '\\$1$2')
    .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
}

function isEmptyText(b) {
  return BLANKABLE.has(b.type) && !(b.md != null ? b.md : b.text || '').trim();
}

function escapeCell(text) {
  return escapeText(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function tableLines(block) {
  const { rows, headerRow } = block;
  if (!rows || !rows.length) return [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (row) => Array.from({ length: colCount }, (_, i) => row[i] ?? '');
  const align = block.align || [];
  const rule = Array.from({ length: colCount }, (_, i) => {
    if (align[i] === 'center') return ':---:';
    if (align[i] === 'right') return '---:';
    if (align[i] === 'left') return ':---';
    return '---';
  });
  const headerIdx = headerRow ?? 0;
  const out = [`| ${pad(rows[headerIdx]).map(escapeCell).join(' | ')} |`, `| ${rule.join(' | ')} |`];
  rows.forEach((row, i) => {
    if (i !== headerIdx) out.push(`| ${pad(row).map(escapeCell).join(' | ')} |`);
  });
  return out;
}

function fenceFor(code) {
  let longest = 0;
  for (const m of String(code).matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

// Quote a value for YAML: double-quoted, with backslashes and quotes escaped.
function yamlString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

export function frontMatterYaml(fm) {
  if (!fm) return '';
  const lines = [];
  const add = (key, value) => {
    if (value && String(value).trim()) lines.push(`${key}: ${yamlString(String(value).trim())}`);
  };
  add('title', fm.title);
  add('author', fm.author);
  const date = String(fm.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) lines.push(`date: ${date}`);
  else add('date', date);
  const tags = String(fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length) lines.push(`tags: [${tags.map(yamlString).join(', ')}]`);
  add('description', fm.description);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

// How many headings an offset would push past H1/H6 (they are held at the limit).
export function countHeadingClamps(blocks, offset) {
  if (!offset) return 0;
  return blocks.filter((b) => {
    if (b.type !== 'heading' || isEmptyText(b)) return false;
    const level = (b.level || 1) + offset;
    return level < 1 || level > 6;
  }).length;
}

// options: { headingOffset: number (levels to add to every heading),
//            frontMatter: { title, author, date, tags, description } | null }
export function blocksToMarkdown(blocks, options = {}) {
  const { headingOffset = 0, frontMatter = null } = options;
  const chunks = []; // { text, list }
  const counters = []; // running numbers for numbered lists, by indent level

  for (const b of blocks) {
    if (isEmptyText(b)) continue;
    const list = LIST.has(b.type);
    if (!list) counters.length = 0;
    const md = inlineSource(b);
    let text = '';

    switch (b.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, (b.level || 1) + headingOffset));
        text = `${'#'.repeat(level)} ${md}${b.headingId ? ` {#${b.headingId}}` : ''}`;
        break;
      }
      case 'paragraph':
        text = escapeBlockStart(emphasis(md, b));
        break;
      case 'blockquote':
        text = `> ${emphasis(md, b)}`;
        break;
      case 'bullet':
      case 'numbered':
      case 'task': {
        const level = b.level || 0;
        let marker = '-';
        if (b.type === 'numbered') {
          counters.length = level + 1;
          counters[level] = (counters[level] || 0) + 1;
          marker = `${counters[level]}.`;
        } else {
          counters.length = level;
          if (b.type === 'task') marker = `- [${b.checked ? 'x' : ' '}]`;
        }
        text = `${INDENT.repeat(level)}${marker} ${emphasis(md, b)}`;
        break;
      }
      case 'code': {
        const body = String(b.text || '').replace(/\n+$/, '');
        const fence = fenceFor(body);
        text = `${fence}${(b.lang || '').trim()}\n${body}\n${fence}`;
        break;
      }
      case 'hr':
        text = '---';
        break;
      case 'image': {
        const title = b.title ? ` "${b.title.replace(/"/g, '\\"')}"` : '';
        text = `![${escapeText(b.alt)}](${encodeHref(b.href)}${title})`;
        break;
      }
      case 'footnote':
        text = `[^${b.label || '1'}]: ${md}`;
        break;
      case 'definition': {
        const desc = b.descMd != null ? b.descMd : escapeText(b.desc);
        text = `${md}\n: ${desc}`;
        break;
      }
      case 'table':
        text = tableLines(b).join('\n');
        break;
      default:
        continue;
    }
    if (text) chunks.push({ text, list, level: b.level || 0, fam: b.type === 'numbered' ? 'n' : 'u' });
  }

  // Blocks are separated by a blank line, except consecutive list items. A
  // switch between bulleted and numbered at the top level also gets a blank
  // line so the two lists are unmistakably separate.
  let out = '';
  let lastTopFam = null;
  chunks.forEach((c, i) => {
    if (i > 0) {
      const prev = chunks[i - 1];
      let sep = '\n\n';
      if (c.list && prev.list) {
        sep = c.level === 0 && lastTopFam && lastTopFam !== c.fam ? '\n\n' : '\n';
      }
      out += sep;
    }
    out += c.text;
    if (c.list) {
      if (c.level === 0) lastTopFam = c.fam;
    } else {
      lastTopFam = null;
    }
  });
  const body = out.trim() ? `${out.trim()}\n` : '';
  return frontMatterYaml(frontMatter) + body;
}
