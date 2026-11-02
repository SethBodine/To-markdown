import { memo, useEffect, useRef, useState } from 'react';
import EditableInline from './EditableInline.jsx';
import TableEditor from './TableEditor.jsx';
import { inlineSource, escapeText } from '../lib/inlineMarkdown.js';

// Renders one block the way it will read once exported, with the text editable
// in place. Selection is handled by the wrapper (click, Ctrl/Cmd+click,
// Shift+click, the tick box); reordering by the grip on the left.

// A code block is a transparent textarea laid over a highlighted copy of the same text, so you
// type in a normal text box and still see colours. Long lines scroll sideways inside the block
// instead of widening the page.
function CodeArea({ block, ops }) {
  const hlRef = useRef(null);
  const [value, setValue] = useState(block.text);
  const [lang, setLang] = useState(block.lang || '');
  useEffect(() => setValue(block.text), [block.text]);
  useEffect(() => setLang(block.lang || ''), [block.lang]);

  useEffect(() => {
    const pre = hlRef.current;
    if (!pre) return undefined;
    const code = `${value}\n`; // the trailing newline keeps the height of a last empty line
    pre.replaceChildren(document.createTextNode(code));
    if (!block.lang) return undefined;
    let cancelled = false;
    import('../lib/highlight.js').then(({ highlightInto }) => {
      if (!cancelled) highlightInto(pre, code, block.lang);
    });
    return () => { cancelled = true; };
  }, [value, block.lang]);

  return (
    <div className="code-wrap">
      <div className="code-head">
        <input
          className="code-lang-input"
          list="code-langs-shared"
          value={lang}
          placeholder="language"
          aria-label="Code language"
          spellCheck={false}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setLang(e.target.value)}
          onBlur={() => lang.trim() !== (block.lang || '') && ops.update(block.id, { lang: lang.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <div className="code-stack">
        <pre className="code-hl" ref={hlRef} aria-hidden="true" />
        <textarea
          className="code-area"
          wrap="off"
          value={value}
          spellCheck={false}
          aria-label="Code"
          onChange={(e) => setValue(e.target.value)}
          onScroll={(e) => { if (hlRef.current) hlRef.current.scrollLeft = e.target.scrollLeft; }}
          onBlur={() => value !== block.text && ops.commitCode(block.id, value)}
        />
      </div>
    </div>
  );
}

function BlockView({ block, selected, listNumber, focus, dropPos, ops }) {
  const { id } = block;
  const flagged = block.confidence < 0.6;
  const cls = [
    'block',
    `block-${block.type}`,
    selected ? 'block-selected' : '',
    flagged ? 'block-flagged' : '',
    dropPos ? `drop-${dropPos}` : '',
  ].filter(Boolean).join(' ');

  const emphasis = { fontWeight: block.bold ? 600 : undefined, fontStyle: block.italic ? 'italic' : undefined };
  const source = inlineSource(block);
  const common = {
    focus,
    onCommit: (md, plain) => ops.commitText(id, md, plain),
    onSplit: (h, t) => ops.split(id, h, t),
    onMergeBack: (md) => ops.mergeBack(id, md),
    onNavigate: (dir) => ops.navigate(id, dir),
    onTab: (d) => ops.tab(id, d),
    onExtend: (dir, atEdge) => ops.extend(id, dir, atEdge),
    onHistory: (kind) => ops.history(kind),
  };

  let content = null;
  switch (block.type) {
    case 'heading':
      content = (
        <EditableInline {...common} source={source} tag={`h${Math.min(6, Math.max(1, block.level || 1))}`} style={emphasis} placeholder="Heading" />
      );
      break;
    case 'paragraph':
      content = <EditableInline {...common} source={source} tag="p" style={emphasis} placeholder="Type some text" />;
      break;
    case 'blockquote':
      content = <EditableInline {...common} source={source} tag="blockquote" style={emphasis} placeholder="Quote" />;
      break;
    case 'bullet':
    case 'numbered':
    case 'task':
      content = (
        <div className="list-row" style={{ paddingLeft: (block.level || 0) * 24 }}>
          {block.type === 'task' ? (
            <input
              type="checkbox"
              className="task-box"
              checked={!!block.checked}
              aria-label="Task done"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => ops.update(id, { checked: e.target.checked })}
            />
          ) : (
            <span className="list-marker">{block.type === 'bullet' ? '\u2022' : `${listNumber || 1}.`}</span>
          )}
          <EditableInline {...common} source={source} tag="div" style={emphasis} placeholder="List item" />
        </div>
      );
      break;
    case 'code':
      content = <CodeArea block={block} ops={ops} />;
      break;
    case 'hr':
      content = <hr className="block-rule" />;
      break;
    case 'image':
      content = (
        <div className="image-box">
          <strong>Image</strong>
          <span>{block.alt ? ` \u2013 ${block.alt}` : ' \u2013 no alt text'}</span>
          <code>{block.href || 'no URL yet: set one in the Properties panel'}</code>
        </div>
      );
      break;
    case 'footnote':
      content = (
        <div className="footnote-row">
          <span className="fn-label">[^{block.label}]</span>
          <EditableInline {...common} source={source} tag="div" placeholder="Footnote text" />
        </div>
      );
      break;
    case 'definition':
      content = (
        <div className="definition-row">
          <EditableInline focus={focus} source={source} tag="div" className="def-term" placeholder="Term"
            onCommit={common.onCommit} onNavigate={common.onNavigate} />
          <EditableInline
            source={block.descMd != null ? block.descMd : escapeText(block.desc)}
            tag="div"
            className="def-desc"
            placeholder="Definition"
            onCommit={(md, plain) => ops.commitField(id, 'desc', md, plain)}
          />
        </div>
      );
      break;
    case 'table':
      content = <TableEditor block={block} onChange={(patch) => ops.update(id, patch)} />;
      break;
    default:
      content = null;
  }

  return (
    <div className={cls} data-block-id={id} onMouseDown={(e) => ops.mouseDown(e, id)} onClick={(e) => ops.click(e, id)}
      onDragOver={(e) => ops.dragOver(e, id)} onDrop={(e) => ops.drop(e, id)}>
      <span className="block-grip" draggable title="Drag to move" aria-label="Drag to reorder"
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => ops.dragStart(e, id)} onDragEnd={() => ops.dragEnd()} />
      {/* A styled span, not <input type="checkbox">: a real form control on every
          block made large documents several times slower to open. */}
      <span
        role="checkbox"
        aria-checked={selected}
        aria-label="Select this block"
        className={`block-check ${selected ? 'on' : ''}`}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => { e.stopPropagation(); ops.checkClick(e, id); }}
      />
      {content}
    </div>
  );
}

export default memo(BlockView);
