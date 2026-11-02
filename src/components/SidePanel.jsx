import { useEffect, useState } from 'react';
import { BLOCK_TYPES, blockTypeKey, LIST_TYPES, TYPE_CHANGEABLE } from '../lib/blockModel.js';
import { isSafeHref, inlineSource, hasLinks } from '../lib/inlineMarkdown.js';
import { useInlineSelection, formatInline, applyLink, removeLink, setLinkHref } from '../lib/inlineSelection.js';

const LANGS = ['bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'html', 'java', 'javascript', 'json', 'kotlin',
  'markdown', 'php', 'python', 'ruby', 'rust', 'sql', 'swift', 'typescript', 'xml', 'yaml'];
const FLAGGABLE = new Set(['heading', 'paragraph', 'bullet', 'numbered', 'task', 'blockquote']);

// A text field that saves when you leave it (or press Enter), not on every key,
// so one edit is one undo step.
function CommitInput({ value, onCommit, ...rest }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <input
      type="text"
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value ?? '') && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function ConfidenceBar({ confidence }) {
  const level = confidence < 0.6 ? 'low' : confidence < 0.85 ? 'medium' : 'high';
  const label = { low: 'Low confidence: worth checking', medium: 'Medium confidence', high: 'High confidence' }[level];
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className={`confidence-fill confidence-${level}`} style={{ width: `${Math.round(confidence * 100)}%` }} />
      </div>
      <span className="confidence-label">{label}</span>
    </div>
  );
}

function Actions({ api, many }) {
  return (
    <div className="action-row">
      <button className="btn small" onClick={() => api.move(-1)}>Move up</button>
      <button className="btn small" onClick={() => api.move(1)}>Move down</button>
      <button className="btn small" onClick={api.duplicate}>Duplicate</button>
      <button className="btn small danger" onClick={api.remove}>{many ? 'Delete all' : 'Delete'}</button>
    </div>
  );
}

// Shown whenever the text selection or cursor is inside a link: edit its address or remove it.
function LinkCard({ multi }) {
  const sel = useInlineSelection();
  const [msg, setMsg] = useState('');
  useEffect(() => setMsg(''), [sel.href, sel.linkCount]);
  if (!sel.link) return null;
  return (
    <div className="link-card">
      <h4>{sel.linkCount > 1 ? `${sel.linkCount} links in the selection` : 'Link'}</h4>
      <label className="field">
        <span>Web address{sel.linkCount > 1 ? ' (sets all of them)' : ''}</span>
        <CommitInput id="link-edit-url" disabled={multi} value={sel.href} onCommit={(v) => setMsg(setLinkHref(v) || '')} />
      </label>
      <div className="action-row">
        <button className="btn small danger" disabled={multi} onClick={() => { removeLink(); setMsg(''); }}>
          {sel.linkCount > 1 ? 'Remove these links' : 'Remove link'}
        </button>
      </div>
      {multi && <p className="hint">Several blocks are selected, so use Remove all links below to unlink them all.</p>}
      {msg && <p className="panel-msg" role="alert">{msg}</p>}
    </div>
  );
}

// Link actions for whole selected blocks (as opposed to some selected words).
function LinkTools({ selected, api }) {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const texty = selected.filter((b) => FLAGGABLE.has(b.type));
  if (!texty.length) return null;
  const anyLinks = texty.some((b) => hasLinks(inlineSource(b)));
  const many = texty.length > 1;
  return (
    <div className="field">
      <span>Links in {many ? 'these blocks' : 'this block'}</span>
      <div className="link-row">
        <input type="text" placeholder="https://example.com" value={url} aria-label="Address for the whole block"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const err = api.linkBlocks(url); setMsg(err); if (!err) setUrl(''); } }} />
        <button className="btn small" onClick={() => { const err = api.linkBlocks(url); setMsg(err); if (!err) setUrl(''); }}>
          Link {many ? 'each block' : 'whole block'}
        </button>
      </div>
      <div className="action-row">
        <button className="btn small danger" disabled={!anyLinks} onClick={() => { api.unlinkBlocks(); setMsg(''); }}>Remove all links</button>
      </div>
      {msg && <p className="panel-msg" role="alert">{msg}</p>}
      <p className="hint">To link just some words, select them and use Insert, or press Ctrl/Cmd+K.</p>
    </div>
  );
}

function Help() {
  return (
    <div className="panel-body">
      <p className="hint">Click a block to edit it and see its properties.</p>
      <h4>Selecting several blocks</h4>
      <ul className="help-list">
        <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + click adds or removes a block</li>
        <li><kbd>Shift</kbd> + click selects everything from the last block you clicked</li>
        <li>The tick box at the left of a block works the same way, Shift included</li>
        <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>A</kbd> selects all, <kbd>Esc</kbd> clears</li>
      </ul>
      <h4>Editing</h4>
      <ul className="help-list">
        <li><kbd>Enter</kbd> splits a block, <kbd>Backspace</kbd> at the start joins it to the one above</li>
        <li><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> indents list items and moves headings down or up a level, on every selected block</li>
        <li><kbd>Shift</kbd> + <kbd>Up</kbd>/<kbd>Down</kbd> extends the selection one block at a time</li>
        <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd> undoes and <kbd>Y</kbd> redoes, even while typing</li>
        <li>Drag the grip at the left of a block to reorder it</li>
        <li>Use the Insert tab for links, tables, code and more</li>
      </ul>
    </div>
  );
}

function SingleProps({ block: b, api }) {
  const sel = useInlineSelection();
  const isList = LIST_TYPES.has(b.type);
  return (
    <div className="panel-body">
      <ConfidenceBar confidence={b.confidence} />
      {TYPE_CHANGEABLE.has(b.type) && (
        <label className="field">
          <span>Type</span>
          <select value={blockTypeKey(b)} onChange={(e) => api.setType(e.target.value)}>
            {BLOCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      )}
      {sel.hasText && TYPE_CHANGEABLE.has(b.type) && (
        <p className="hint">Text is selected, so a change of type applies to just the selection.</p>
      )}
      {isList && (
        <div className="field">
          <span>Indent level</span>
          <div className="stepper">
            <button className="btn small" onClick={() => api.indent(-1)}>&minus;</button>
            <span>{b.level || 0}</span>
            <button className="btn small" onClick={() => api.indent(1)}>+</button>
          </div>
        </div>
      )}
      {FLAGGABLE.has(b.type) && (
        <>
          <label className="field field-inline"><input type="checkbox" checked={!!b.bold} onChange={() => api.toggleFlag('bold')} /><span>Whole block bold</span></label>
          <label className="field field-inline"><input type="checkbox" checked={!!b.italic} onChange={() => api.toggleFlag('italic')} /><span>Whole block italic</span></label>
        </>
      )}
      {FLAGGABLE.has(b.type) && <LinkTools selected={[b]} api={api} />}
      {b.type === 'heading' && (
        <label className="field">
          <span>Anchor ID (optional)</span>
          <CommitInput value={b.headingId} placeholder="custom-id"
            onCommit={(v) => api.updateSelected({ headingId: v.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') })} />
        </label>
      )}
      {b.type === 'task' && (
        <label className="field field-inline"><input type="checkbox" checked={!!b.checked} onChange={(e) => api.updateSelected({ checked: e.target.checked })} /><span>Done</span></label>
      )}
      {b.type === 'code' && (
        <label className="field">
          <span>Language</span>
          <CommitInput list="code-langs" value={b.lang} placeholder="python, bash, json ..." onCommit={(v) => api.updateSelected({ lang: v.trim() })} />
          <datalist id="code-langs">{LANGS.map((l) => <option key={l} value={l} />)}</datalist>
        </label>
      )}
      {b.type === 'image' && (
        <>
          <label className="field"><span>Alt text</span><CommitInput value={b.alt} onCommit={(v) => api.updateSelected({ alt: v })} /></label>
          <label className="field"><span>Image URL</span>
            <CommitInput value={b.href} placeholder="https://... or image.png"
              onCommit={(v) => (!v.trim() || isSafeHref(v) ? api.updateSelected({ href: v.trim() }) : null)} />
          </label>
          <label className="field"><span>Title (optional)</span><CommitInput value={b.title} onCommit={(v) => api.updateSelected({ title: v })} /></label>
          <p className="hint">Images are not loaded here (nothing leaves your browser); the Markdown just points at the URL.</p>
        </>
      )}
      {b.type === 'footnote' && (
        <label className="field"><span>Footnote label</span>
          <CommitInput value={b.label} onCommit={(v) => api.updateSelected({ label: v.trim().replace(/[^\w-]+/g, '') || b.label })} />
        </label>
      )}
      {b.type === 'table' && <p className="hint">Click a row or column tag to mark a header, set column alignment, or edit cells directly.</p>}
      {b.source && b.source.page != null && <p className="hint">Source: page {b.source.page}</p>}
      <Actions api={api} />
    </div>
  );
}

function MultiProps({ selected, api }) {
  const counts = {};
  selected.forEach((b) => { const k = b.type === 'heading' ? `H${b.level}` : b.type; counts[k] = (counts[k] || 0) + 1; });
  return (
    <div className="panel-body">
      <p><strong>{selected.length} blocks selected</strong></p>
      <p className="hint">{Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}</p>
      <label className="field">
        <span>Change type of all</span>
        <select value="" onChange={(e) => e.target.value && api.setType(e.target.value)}>
          <option value="">Choose a type...</option>
          {BLOCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <div className="field">
        <span>Format whole blocks</span>
        <div className="action-row">
          <button className="btn small" onClick={() => api.toggleFlag('bold')}>Toggle bold</button>
          <button className="btn small" onClick={() => api.toggleFlag('italic')}>Toggle italic</button>
        </div>
      </div>
      <div className="field">
        <span>Indent list items</span>
        <div className="stepper">
          <button className="btn small" onClick={() => api.indent(-1)}>&minus;</button>
          <button className="btn small" onClick={() => api.indent(1)}>+</button>
        </div>
      </div>
      <LinkTools selected={selected} api={api} />
      <div className="action-row">
        <button className="btn small" onClick={api.merge}>Merge into one block</button>
        <button className="btn small" onClick={api.clear}>Clear selection</button>
      </div>
      <Actions api={api} many />
    </div>
  );
}

const MARKS = [
  ['bold', 'Bold', '**text**', 'fmt-b'],
  ['italic', 'Italic', '*text*', 'fmt-i'],
  ['strike', 'Strike', '~~text~~', 'fmt-s'],
  ['code', 'Code', '`text`', 'fmt-c'],
  ['mark', 'Highlight', '==text==', ''],
  ['sub', 'Sub', 'H~2~O', ''],
  ['sup', 'Super', 'X^2^', ''],
];

function Insert({ api, setTab }) {
  const sel = useInlineSelection();
  const [pos, setPos] = useState('after');
  const [level, setLevel] = useState(2);
  const [lang, setLang] = useState('');
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [alt, setAlt] = useState('');
  const [href, setHref] = useState('');
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [linkText, setLinkText] = useState('');
  const noFocus = (e) => e.preventDefault(); // keep the text selection while using the panel
  const add = (kind, opts) => api.insert(kind, opts, pos);
  // Creating only: text that is already a link is edited in Properties instead.
  const createLink = () => {
    if (sel.hasText && sel.link) {
      setMsg('That text is already a link. Edit or remove it in Properties.');
      return;
    }
    const err = sel.hasText ? applyLink(url) : api.insertLink(linkText, url);
    setMsg(err || '');
    if (!err) {
      setUrl('');
      setLinkText('');
    }
  };

  return (
    <div className="panel-body">
      <h4>Selected text</h4>
      <div className="fmt-bar">
        {MARKS.map(([kind, label, syntax, cls]) => (
          <button key={kind} className={`fmt-btn ${cls} ${sel.hasText && sel[kind] ? 'on' : ''}`} title={syntax} disabled={!sel.hasText}
            onMouseDown={noFocus} onClick={() => formatInline(kind)}>{label}</button>
        ))}
        <button className="fmt-btn" disabled={!sel.hasEditor} onMouseDown={noFocus} onClick={() => formatInline('clear')}
          title="Remove formatting from the selection">Clear</button>
      </div>
      <h4>New link</h4>
      {sel.hasText ? (
        <p className="hint">Selected text: <strong>{sel.text}</strong></p>
      ) : (
        <label className="field">
          <span>Text to show</span>
          <input type="text" value={linkText} placeholder="optional; defaults to the address" onChange={(e) => setLinkText(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Web address</span>
        <input id="link-url-input" type="text" placeholder="https://example.com" value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createLink()} />
      </label>
      <button className="btn small" onClick={createLink}>{sel.hasText ? 'Link selected text' : 'Insert new link'}</button>
      {sel.link && (
        <p className="hint">
          The selection is already a link.{' '}
          <button className="linkish" onClick={() => setTab('properties')}>Edit or remove it in Properties</button>
        </p>
      )}
      <div className="action-row">
        <button className="btn small" disabled={!sel.hasEditor && api.selectedCount !== 1} onMouseDown={noFocus}
          onClick={() => setMsg(api.insertFootnote() || '')} title="[^1] in the text and a footnote at the end">Add footnote</button>
      </div>
      {msg && <p className="panel-msg" role="alert">{msg}</p>}
      {!sel.hasEditor && <p className="hint">Select some text inside a block to format it or make it a link.</p>}

      <h4>Add a block</h4>
      <div className="pos-row" role="radiogroup" aria-label="Where to add">
        {[['after', 'After selection'], ['before', 'Before selection'], ['end', 'End of document']].map(([v, l]) => (
          <label key={v}><input type="radio" name="pos" checked={pos === v} onChange={() => setPos(v)} /> {l}</label>
        ))}
      </div>
      <div className="insert-row">
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Heading level">
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>H{n}</option>)}
        </select>
        <button className="btn small grow" onClick={() => add('heading', { level })}>Heading <code>{'#'.repeat(level)}</code></button>
      </div>
      <div className="insert-grid">
        <button className="btn small" onClick={() => add('paragraph')}>Paragraph</button>
        <button className="btn small" onClick={() => add('quote')}>Quote <code>&gt;</code></button>
        <button className="btn small" onClick={() => add('bullet')}>Bullet <code>-</code></button>
        <button className="btn small" onClick={() => add('numbered')}>Numbered <code>1.</code></button>
        <button className="btn small" onClick={() => add('task')}>Task <code>- [ ]</code></button>
        <button className="btn small" onClick={() => add('hr')}>Line <code>---</code></button>
        <button className="btn small" onClick={() => add('definition')}>Definition <code>: </code></button>
      </div>
      <div className="insert-row">
        <input type="text" list="code-langs-insert" placeholder="language" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Code language" />
        <datalist id="code-langs-insert">{LANGS.map((l) => <option key={l} value={l} />)}</datalist>
        <button className="btn small grow" onClick={() => add('code', { lang: lang.trim() })}>Code block <code>```</code></button>
      </div>
      <div className="insert-row">
        <input type="number" min="1" max="50" value={rows} onChange={(e) => setRows(Number(e.target.value))} aria-label="Rows" className="num" />
        <span>&times;</span>
        <input type="number" min="1" max="20" value={cols} onChange={(e) => setCols(Number(e.target.value))} aria-label="Columns" className="num" />
        <button className="btn small grow" onClick={() => add('table', { rows, cols })}>Table <code>| a | b |</code></button>
      </div>
      <div className="insert-stack">
        <input type="text" placeholder="Image alt text" value={alt} onChange={(e) => setAlt(e.target.value)} aria-label="Image alt text" />
        <input type="text" placeholder="Image URL" value={href} onChange={(e) => setHref(e.target.value)} aria-label="Image URL" />
        <button className="btn small"
          onClick={() => (!href.trim() || isSafeHref(href) ? add('image', { alt, href: href.trim() }) : setMsg('That image address type is not allowed.'))}>
          Image <code>![alt](url)</code>
        </button>
      </div>
      <p className="hint">Syntax reference:{' '}
        <a href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noopener noreferrer">Markdown cheat sheet</a>
      </p>
    </div>
  );
}

export default function SidePanel({ tab, setTab, selected, api }) {
  return (
    <aside className="side-panel" aria-label="Block tools">
      <div className="panel-tabs" role="tablist">
        {[['properties', 'Properties'], ['insert', 'Insert']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`panel-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'insert' ? (
        <Insert api={api} setTab={setTab} />
      ) : (
        <>
          <LinkCard multi={selected.length > 1} />
          {selected.length === 0 ? (
            <Help />
          ) : selected.length === 1 ? (
            <SingleProps block={selected[0]} api={api} />
          ) : (
            <MultiProps selected={selected} api={api} />
          )}
        </>
      )}
    </aside>
  );
}
