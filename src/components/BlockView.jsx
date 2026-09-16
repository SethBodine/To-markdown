import TableEditor from './TableEditor.jsx';

// This is the "WYSIWYG" half: each block renders using the tag/style implied
// by its current type, so what the user sees approximates the final
// markdown's visual shape (a heading-2 block actually looks like a heading).
// Editing the text happens inline via contentEditable; editing the *type*
// happens in the Inspector panel on the right.

export default function BlockView({ block, selected, onSelect, onChange }) {
  const flagged = block.confidence < 0.6;

  if (block.type === 'table') {
    return (
      <div
        className={`block block-table ${selected ? 'block-selected' : ''} ${flagged ? 'block-flagged' : ''}`}
        onClick={onSelect}
      >
        <TableEditor block={block} onChange={onChange} />
      </div>
    );
  }

  const Tag = tagFor(block);
  const className = `block block-${block.type} ${selected ? 'block-selected' : ''} ${
    flagged ? 'block-flagged' : ''
  }`;

  return (
    <div className={className} onClick={onSelect} style={{ paddingLeft: (block.level || 0) * 20 }}>
      {(block.type === 'bullet' || block.type === 'numbered') && (
        <span className="list-marker">{block.type === 'bullet' ? '•' : '1.'}</span>
      )}
      <Tag
        className="block-text"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => onChange({ text: e.currentTarget.textContent })}
        style={{
          fontWeight: block.bold ? 600 : undefined,
          fontStyle: block.italic ? 'italic' : undefined,
        }}
      >
        {block.text}
      </Tag>
    </div>
  );
}

function tagFor(block) {
  if (block.type === 'heading') return `h${Math.min(6, Math.max(1, block.level || 1))}`;
  if (block.type === 'blockquote') return 'blockquote';
  if (block.type === 'code') return 'pre';
  return 'p';
}
