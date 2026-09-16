// Builds markdown directly from the block model. Deliberately not using a
// full mdast/remark pipeline for the MVP — the block model is already a flat,
// simple structure and hand-rolling this keeps the dependency list small.
// Swap this out for remark/mdast if richer inline formatting (nested
// emphasis, footnotes, etc.) is needed later.

export function blocksToMarkdown(blocks) {
  const lines = [];
  let lastWasList = false;

  for (const block of blocks) {
    const isList = block.type === 'bullet' || block.type === 'numbered';

    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(Math.min(6, Math.max(1, block.level || 1)))} ${escapeInline(block.text)}`);
        lines.push('');
        break;

      case 'paragraph':
        lines.push(wrapEmphasis(escapeInline(block.text), block));
        lines.push('');
        break;

      case 'blockquote':
        lines.push(`> ${escapeInline(block.text)}`);
        lines.push('');
        break;

      case 'code':
        lines.push('```');
        lines.push(block.text);
        lines.push('```');
        lines.push('');
        break;

      case 'bullet':
        lines.push(`${'  '.repeat(block.level || 0)}- ${escapeInline(block.text)}`);
        break;

      case 'numbered':
        lines.push(`${'  '.repeat(block.level || 0)}1. ${escapeInline(block.text)}`);
        break;

      case 'table':
        lines.push(...tableToMarkdown(block));
        lines.push('');
        break;

      default:
        break;
    }

    if (isList && !lastWasList) {
      // no-op: list start needs no blank line before it in most renderers
    }
    if (!isList && lastWasList) {
      lines.push('');
    }
    lastWasList = isList;
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function tableToMarkdown(block) {
  const { rows, headerRow } = block;
  if (!rows || !rows.length) return [];

  const out = [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (row) => Array.from({ length: colCount }, (_, i) => row[i] ?? '');

  const headerIdx = headerRow ?? 0;
  const header = pad(rows[headerIdx]);
  out.push(`| ${header.map((c) => escapeCell(c)).join(' | ')} |`);
  out.push(`| ${header.map(() => '---').join(' | ')} |`);

  rows.forEach((row, i) => {
    if (i === headerIdx) return;
    out.push(`| ${pad(row).map((c) => escapeCell(c)).join(' | ')} |`);
  });

  return out;
}

function wrapEmphasis(text, block) {
  if (block.bold && block.italic) return `***${text}***`;
  if (block.bold) return `**${text}**`;
  if (block.italic) return `*${text}*`;
  return text;
}

function escapeInline(text) {
  return (text || '').replace(/([*_`\\])/g, '\\$1');
}

function escapeCell(text) {
  return escapeInline(text).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
