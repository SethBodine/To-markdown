import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BlockView from './BlockView.jsx';
import SidePanel from './SidePanel.jsx';
import PdfSourceView from './PdfSourceView.jsx';
import {
  insertTableAtRegion, makeTableBlock, makeBlock, createBlock, applyBlockType, cloneBlock,
  isTextBlock, LIST_TYPES, TYPE_CHANGEABLE, nextId,
  titleBlocks, titleAsH1Active, clampedHeadingCount, applyTitleAsH1, revertTitleAsH1,
} from '../lib/blockModel.js';
import { inlineSource, mdToPlain, normalizeMd } from '../lib/inlineMarkdown.js';
import { installSelectionTracking, insertFootnoteRef, splitAtSelection } from '../lib/inlineSelection.js';
import { blocksToMarkdown } from '../lib/markdownExport.js';
import { CODE_LANGS } from '../lib/codeLangs.js';
// extractTableFromRegion is imported dynamically inside handleCreateTableFromRegion:
// it pulls in all of pdf.js, and this component renders for every format.

const FLAGGABLE = new Set(['heading', 'paragraph', 'bullet', 'numbered', 'task', 'blockquote']);
const MERGEABLE = new Set(['heading', 'paragraph', 'bullet', 'numbered', 'task', 'blockquote']);
const DRAG_TYPE = 'application/x-to-markdown-blocks';
const HISTORY_LIMIT = 200;

export default function Editor({ blocks, onChange, pdfDoc }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [view, setView] = useState('structured'); // 'structured' | 'markdown' | 'source'
  const [tab, setTab] = useState('properties');
  const [tableBusy, setTableBusy] = useState(false);
  const [focusReq, setFocusReq] = useState(null);
  const [drop, setDrop] = useState(null); // { id, pos: 'before' | 'after' }
  const [showChecks, setShowChecks] = useState(false); // keep the tick boxes visible
  const mdFlushRef = useRef(null); // lets the Markdown tab hand over unsaved edits before it closes
  const mdInitialRef = useRef('');
  const mdSessionRef = useRef({ pushed: false });

  // Refs hold the latest values so event handlers (which can fire several times
  // before React re-renders) never act on stale blocks or a stale selection.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const historyRef = useRef({ past: [], future: [] });
  const anchorRef = useRef(null);
  const nonceRef = useRef(0);
  const dragIdsRef = useRef([]);

  useEffect(() => installSelectionTracking(), []);

  // One entry in the undo history per change. Accepts new blocks, or a function
  // of the current blocks.
  const commit = useCallback((updater) => {
    const prev = blocksRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (!next || next === prev) return;
    const h = historyRef.current;
    h.past.push(prev);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    blocksRef.current = next;
    onChange(next);
  }, [onChange]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const prev = h.past.pop();
    h.future.push(blocksRef.current);
    blocksRef.current = prev;
    onChange(prev);
  }, [onChange]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const next = h.future.pop();
    h.past.push(blocksRef.current);
    blocksRef.current = next;
    onChange(next);
  }, [onChange]);

  const requestFocus = (id, at) => setFocusReq({ id, at, nonce: (nonceRef.current += 1) });
  const flushActive = () => {
    const a = document.activeElement;
    if (a && a.matches && a.matches('[data-inline-editor], textarea.code-area')) a.blur();
  };

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedBlocks = useMemo(() => blocks.filter((b) => selectedSet.has(b.id)), [blocks, selectedSet]);
  const lowConfidenceCount = useMemo(() => blocks.filter((b) => b.confidence < 0.6).length, [blocks]);

  const listNumbers = useMemo(() => {
    const map = new Map();
    const counters = [];
    for (const b of blocks) {
      if (b.type === 'numbered') {
        const level = b.level || 0;
        counters.length = level + 1;
        counters[level] = (counters[level] || 0) + 1;
        map.set(b.id, counters[level]);
      } else if (LIST_TYPES.has(b.type)) {
        counters.length = b.level || 0;
      } else {
        counters.length = 0;
      }
    }
    return map;
  }, [blocks]);

  // ---- "Use document Title as H1" (Word documents) ----
  const titleCount = useMemo(() => titleBlocks(blocks).length, [blocks]);
  const titleActive = useMemo(() => titleAsH1Active(blocks), [blocks]);
  const clampedCount = useMemo(() => clampedHeadingCount(blocks), [blocks]);

  // ---- selection ----
  const selectRange = (id) => {
    const list = blocksRef.current;
    const a = list.findIndex((b) => b.id === anchorRef.current);
    const z = list.findIndex((b) => b.id === id);
    if (a < 0 || z < 0) return false;
    setSelectedIds(list.slice(Math.min(a, z), Math.max(a, z) + 1).map((b) => b.id));
    return true;
  };
  const toggleId = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    anchorRef.current = id;
  };

  // ---- operations used by blocks (kept stable; see `ops` below) ----
  const opsRef = useRef({});
  opsRef.current = {
    mouseDown(e, id) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault(); // no text selection / caret move while building a block selection
        if (!(e.shiftKey && selectRange(id))) toggleId(id);
      }
    },
    click(e, id) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (selectedRef.current.length === 1 && selectedRef.current[0] === id) return;
      setSelectedIds([id]);
      anchorRef.current = id;
    },
    toggle: toggleId,
    commitText(id, md, plain) {
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, md: normalizeMd(md, plain), text: plain, confidence: 1 } : b)));
    },
    commitField(id, field, md, plain) {
      if (field !== 'desc') return;
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, desc: plain, descMd: normalizeMd(md, plain), confidence: 1 } : b)));
    },
    commitCode(id, text) {
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, text, confidence: 1 } : b)));
    },
    update(id, patch) {
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch, confidence: 1 } : b)));
    },
    // Enter: split the block at the caret.
    split(id, headMd, tailMd) {
      const list = blocksRef.current;
      const b = list.find((x) => x.id === id);
      if (!b) return;
      if (!headMd && !tailMd && LIST_TYPES.has(b.type)) {
        // Enter on an empty list item: outdent, or leave the list.
        commit((prev) => prev.map((x) => (x.id === id
          ? ((x.level || 0) > 0 ? { ...x, level: x.level - 1 } : { ...x, type: 'paragraph', level: 0 })
          : x)));
        requestFocus(id, 'start');
        return;
      }
      const headPlain = mdToPlain(headMd);
      const tailPlain = mdToPlain(tailMd);
      const type = ['heading', 'footnote', 'definition'].includes(b.type) ? 'paragraph' : b.type;
      const nb = makeBlock({
        type,
        level: LIST_TYPES.has(type) ? b.level || 0 : 0,
        text: tailPlain,
        md: normalizeMd(tailMd, tailPlain),
        source: { format: 'edited', page: null },
      });
      commit((prev) => {
        const i = prev.findIndex((x) => x.id === id);
        const head = { ...prev[i], text: headPlain, md: normalizeMd(headMd, headPlain), confidence: 1 };
        return [...prev.slice(0, i), head, nb, ...prev.slice(i + 1)];
      });
      setSelectedIds([nb.id]);
      anchorRef.current = nb.id;
      requestFocus(nb.id, 'start');
    },
    // Backspace at the start of a block.
    mergeBack(id, currentMd) {
      const list = blocksRef.current;
      const idx = list.findIndex((x) => x.id === id);
      const b = list[idx];
      if (!b) return;
      const plainNow = mdToPlain(currentMd);
      const mdNow = normalizeMd(currentMd, plainNow);
      if (b.type !== 'paragraph' && MERGEABLE.has(b.type)) {
        commit((prev) => prev.map((x) => (x.id === id ? { ...x, type: 'paragraph', level: 0, text: plainNow, md: mdNow, confidence: 1 } : x)));
        requestFocus(id, 0);
        return;
      }
      if (b.type !== 'paragraph') return;
      const before = list[idx - 1];
      if (before && MERGEABLE.has(before.type)) {
        const beforeMd = inlineSource(before);
        const joinAt = mdToPlain(beforeMd).length;
        const merged = beforeMd + currentMd;
        const mergedPlain = mdToPlain(merged);
        commit((prev) => {
          const i = prev.findIndex((x) => x.id === id);
          return [...prev.slice(0, i - 1), { ...prev[i - 1], text: mergedPlain, md: normalizeMd(merged, mergedPlain), confidence: 1 }, ...prev.slice(i + 1)];
        });
        setSelectedIds([before.id]);
        requestFocus(before.id, joinAt);
      } else if (before && !currentMd) {
        commit((prev) => prev.filter((x) => x.id !== id));
        setSelectedIds([before.id]);
      }
    },
    navigate(id, dir) {
      const list = blocksRef.current;
      const step = dir === 'up' ? -1 : 1;
      let i = list.findIndex((b) => b.id === id) + step;
      while (i >= 0 && i < list.length && !isTextBlock(list[i])) i += step;
      if (i < 0 || i >= list.length) return;
      setSelectedIds([list[i].id]);
      requestFocus(list[i].id, dir === 'up' ? 'end' : 'start');
    },
    tab(id, delta) {
      commit((prev) => prev.map((b) => (b.id === id && LIST_TYPES.has(b.type)
        ? { ...b, level: Math.max(0, Math.min(8, (b.level || 0) + delta)) } : b)));
    },
    // ---- drag to reorder ----
    dragStart(e, id) {
      const ids = selectedRef.current.includes(id) ? blocksRef.current.filter((b) => selectedRef.current.includes(b.id)).map((b) => b.id) : [id];
      dragIdsRef.current = ids;
      e.dataTransfer.setData(DRAG_TYPE, ids.join(','));
      e.dataTransfer.effectAllowed = 'move';
      if (!selectedRef.current.includes(id)) setSelectedIds([id]);
    },
    dragOver(e, id) {
      if (!Array.from(e.dataTransfer.types || []).includes(DRAG_TYPE)) return; // files etc. are not ours
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      setDrop((d) => (d && d.id === id && d.pos === pos ? d : { id, pos }));
    },
    drop(e, id) {
      if (!Array.from(e.dataTransfer.types || []).includes(DRAG_TYPE)) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      moveBlocksTo(dragIdsRef.current, id, e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      dragIdsRef.current = [];
      setDrop(null);
    },
    dragEnd() {
      dragIdsRef.current = [];
      setDrop(null);
    },
  };
  const ops = useMemo(() => {
    const names = ['mouseDown', 'click', 'toggle', 'commitText', 'commitField', 'commitCode', 'update', 'split',
      'mergeBack', 'navigate', 'tab', 'dragStart', 'dragOver', 'drop', 'dragEnd'];
    return Object.fromEntries(names.map((n) => [n, (...a) => opsRef.current[n](...a)]));
  }, []);

  function moveBlocksTo(ids, targetId, pos) {
    if (!ids.length || ids.includes(targetId)) return;
    commit((prev) => {
      const moving = prev.filter((b) => ids.includes(b.id));
      const rest = prev.filter((b) => !ids.includes(b.id));
      const t = rest.findIndex((b) => b.id === targetId);
      if (t < 0) return prev;
      const at = pos === 'before' ? t : t + 1;
      return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    });
  }

  // ---- actions for the side panel ----
  const mapSelected = (fn) => commit((prev) => prev.map((b) => (selectedSet.has(b.id) ? fn(b) : b)));
  const api = {
    selectedCount: selectedIds.length,
    updateSelected: (patch) => mapSelected((b) => ({ ...b, ...patch, confidence: 1 })),
    setType: (value) => {
      // With part of a line selected, only that text changes type: the block is split around it.
      const part = selectedBlocks.length === 1 && TYPE_CHANGEABLE.has(selectedBlocks[0].type) ? splitAtSelection() : null;
      if (part && part.blockId === selectedBlocks[0].id && (part.headMd || part.tailMd)) {
        partialTypeChange(selectedBlocks[0], part, value);
        return;
      }
      mapSelected((b) => (TYPE_CHANGEABLE.has(b.type) ? applyBlockType(b, value) : b));
    },
    indent: (delta) => mapSelected((b) => (LIST_TYPES.has(b.type)
      ? { ...b, level: Math.max(0, Math.min(8, (b.level || 0) + delta)), confidence: 1 } : b)),
    toggleFlag: (flag) => {
      const targets = selectedBlocks.filter((b) => FLAGGABLE.has(b.type));
      const all = targets.length > 0 && targets.every((b) => b[flag]);
      mapSelected((b) => (FLAGGABLE.has(b.type) ? { ...b, [flag]: !all, confidence: 1 } : b));
    },
    remove: () => {
      flushActive();
      commit((prev) => prev.filter((b) => !selectedSet.has(b.id)));
      setSelectedIds([]);
    },
    move: (dir) => commit((prev) => {
      const arr = [...prev];
      if (dir < 0) {
        for (let i = 1; i < arr.length; i += 1) {
          if (selectedSet.has(arr[i].id) && !selectedSet.has(arr[i - 1].id)) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        }
      } else {
        for (let i = arr.length - 2; i >= 0; i -= 1) {
          if (selectedSet.has(arr[i].id) && !selectedSet.has(arr[i + 1].id)) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        }
      }
      return arr;
    }),
    duplicate: () => {
      const copies = [];
      commit((prev) => prev.flatMap((b) => {
        if (!selectedSet.has(b.id)) return [b];
        const c = cloneBlock(b);
        copies.push(c.id);
        return [b, c];
      }));
      setSelectedIds(copies);
    },
    merge: () => {
      flushActive();
      const parts = blocksRef.current.filter((b) => selectedSet.has(b.id) && MERGEABLE.has(b.type));
      if (parts.length < 2) return;
      const md = parts.map(inlineSource).join(' ');
      const plain = mdToPlain(md);
      const keep = parts[0].id;
      const drop = new Set(parts.slice(1).map((b) => b.id));
      commit((prev) => prev.filter((b) => !drop.has(b.id)).map((b) => (b.id === keep ? { ...b, text: plain, md: normalizeMd(md, plain), confidence: 1 } : b)));
      setSelectedIds([keep]);
    },
    clear: () => setSelectedIds([]),
    insert: (kind, opts = {}, position = 'after') => {
      flushActive();
      const nb = createBlock(kind, opts);
      commit((prev) => {
        const idx = prev.map((b, i) => (selectedRef.current.includes(b.id) ? i : -1)).filter((i) => i >= 0);
        let at = prev.length;
        if (position !== 'end' && idx.length) at = position === 'before' ? Math.min(...idx) : Math.max(...idx) + 1;
        return [...prev.slice(0, at), nb, ...prev.slice(at)];
      });
      setSelectedIds([nb.id]);
      anchorRef.current = nb.id;
      if (isTextBlock(nb)) requestFocus(nb.id, 'start');
    },
    insertFootnote: () => {
      const used = new Set(blocksRef.current.filter((b) => b.type === 'footnote').map((b) => b.label));
      let n = 1;
      while (used.has(String(n))) n += 1;
      const label = String(n);
      if (!insertFootnoteRef(label)) {
        const only = selectedBlocks.length === 1 && MERGEABLE.has(selectedBlocks[0].type) ? selectedBlocks[0] : null;
        if (!only) return 'Click inside a block (or select one) first, so the footnote has somewhere to be referenced.';
        const md = `${inlineSource(only)}[^${label}]`;
        const plain = mdToPlain(md);
        commit((prev) => prev.map((b) => (b.id === only.id ? { ...b, text: plain, md: normalizeMd(md, plain), confidence: 1 } : b)));
      }
      const def = createBlock('footnote', { label });
      commit((prev) => [...prev, def]);
      setSelectedIds([def.id]);
      requestFocus(def.id, 'start');
      return '';
    },
  };

  // Bring a newly focused or inserted block into view.
  useEffect(() => {
    if (focusReq) {
      const el = document.querySelector(`[data-block-id="${focusReq.id}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusReq]);

  // Keyboard shortcuts that apply when you're not typing in a field.
  useEffect(() => {
    if (view !== 'structured') return undefined;
    const onKey = (e) => {
      const a = document.activeElement;
      const typing = a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'
        || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(a.type)));
      if (e.key === 'Escape') {
        if (typing && a.blur) a.blur();
        setSelectedIds([]);
        return;
      }
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current.length) {
        e.preventDefault();
        commit((prev) => prev.filter((b) => !selectedRef.current.includes(b.id)));
        setSelectedIds([]);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(blocksRef.current.map((b) => b.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, commit, undo, redo]);

  const handleCreateTableFromRegion = useCallback(async (pageNum, regionBbox) => {
    setTableBusy(true);
    try {
      const { extractTableFromRegion } = await import('../lib/pdfTableRegion.js');
      const { rows, bbox } = await extractTableFromRegion(pdfDoc, pageNum, regionBbox);
      if (!rows.length) return;
      const tableBlock = makeTableBlock(rows, {
        headerRow: 0,
        confidence: 0.5, // a heuristic reconstruction, so flag it like anything else uncertain
        source: { format: 'pdf', page: pageNum, ...bbox },
      });
      commit((prev) => insertTableAtRegion(prev, tableBlock, pageNum, bbox));
      setSelectedIds([tableBlock.id]);
      setView('structured');
    } finally {
      setTableBusy(false);
    }
  }, [commit, pdfDoc]);

  function partialTypeChange(b, part, value) {
    const piece = (md) => {
      const text = mdToPlain(md);
      return { text, md: normalizeMd(md, text) };
    };
    const out = [];
    if (part.headMd) out.push({ ...b, ...piece(part.headMd), confidence: 1 });
    const middle = applyBlockType({ ...b, ...piece(part.selMd), id: part.headMd ? nextId() : b.id, headingId: part.headMd ? '' : b.headingId }, value);
    out.push(middle);
    if (part.tailMd) out.push({ ...b, ...piece(part.tailMd), id: nextId(), headingId: '', confidence: 1 });
    commit((prev) => prev.flatMap((x) => (x.id === b.id ? out : [x])));
    setSelectedIds([middle.id]);
    anchorRef.current = middle.id;
  }

  // The empty space under the last block: click it to carry on writing.
  function addAtEnd() {
    const list = blocksRef.current;
    const last = list[list.length - 1];
    if (last && last.type === 'paragraph' && !(last.md != null ? last.md : last.text).trim()) {
      setSelectedIds([last.id]);
      requestFocus(last.id, 'end');
      return;
    }
    api.insert('paragraph', {}, 'end');
  }

  // Markdown tab: the text is parsed back into blocks as you type (and when you leave the tab).
  // The whole session is one undo step.
  async function applyMarkdown(text) {
    const { parseMarkdown } = await import('../lib/parsers/markdownParser.js');
    const { blocks: parsed } = await parseMarkdown(text);
    const hist = historyRef.current;
    if (!mdSessionRef.current.pushed) {
      hist.past.push(blocksRef.current);
      if (hist.past.length > HISTORY_LIMIT) hist.past.shift();
      mdSessionRef.current.pushed = true;
    }
    hist.future = [];
    blocksRef.current = parsed;
    onChange(parsed);
    setSelectedIds([]);
  }

  async function switchView(next) {
    if (next === view) return;
    if (view === 'markdown' && mdFlushRef.current) await mdFlushRef.current();
    if (next === 'markdown') {
      mdInitialRef.current = blocksToMarkdown(blocksRef.current);
      mdSessionRef.current = { pushed: false };
    }
    setView(next);
  }

  const h = historyRef.current;
  return (
    <div className={`editor ${selectedIds.length ? 'has-selection' : ''} ${showChecks ? 'show-checks' : ''}`}>
      <datalist id="code-langs-shared">{CODE_LANGS.map((l) => <option key={l} value={l} />)}</datalist>
      {titleCount > 0 && view === 'structured' && (
        <label className="option-bar">
          <input
            type="checkbox"
            checked={titleActive}
            onChange={(e) => commit(e.target.checked ? applyTitleAsH1(blocksRef.current) : revertTitleAsH1(blocksRef.current))}
          />
          <span>
            <strong>Use the document Title as H1.</strong> This Word document has a Title style
            {titleCount > 1 ? ` (${titleCount} paragraphs)` : ''}. Ticking this makes it a top-level
            heading and moves every other heading down one level (H1 to H2, H2 to H3, and so on).
            {titleActive && clampedCount > 0
              ? ` ${clampedCount} heading${clampedCount === 1 ? ' was' : 's were'} already H6, so ${clampedCount === 1 ? 'it stays' : 'they stay'} at H6.`
              : ''}
          </span>
        </label>
      )}
      <div className="editor-toolbar">
        <button className="btn" onClick={undo} disabled={!h.past.length}>Undo</button>
        <button className="btn" onClick={redo} disabled={!h.future.length}>Redo</button>
        <div className="view-toggle" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'structured'} className={`btn ${view === 'structured' ? 'btn-active' : ''}`} onClick={() => switchView('structured')}>Structured</button>
          <button role="tab" aria-selected={view === 'markdown'} className={`btn ${view === 'markdown' ? 'btn-active' : ''}`} onClick={() => switchView('markdown')}>Markdown</button>
          {pdfDoc && (
            <button role="tab" aria-selected={view === 'source'} className={`btn ${view === 'source' ? 'btn-active' : ''}`} onClick={() => switchView('source')}>Source (PDF)</button>
          )}
        </div>
        {view === 'structured' && (
          <div className="select-tools">
            <button className="btn small" onClick={() => setSelectedIds(blocks.map((b) => b.id))} disabled={!blocks.length}>Select all</button>
            <button className="btn small" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>Clear</button>
            <button className={`btn small ${showChecks ? 'btn-active' : ''}`} aria-pressed={showChecks} onClick={() => setShowChecks((v) => !v)}
              title="Show a tick box beside every block for selecting several at once">Tick boxes</button>
            {selectedIds.length > 0 && <span className="sel-count">{selectedIds.length} selected</span>}
          </div>
        )}
        {lowConfidenceCount > 0 && (
          <span className="flag-count">{lowConfidenceCount} block{lowConfidenceCount === 1 ? '' : 's'} flagged for review</span>
        )}
      </div>

      {view === 'markdown' ? (
        <MarkdownView initial={mdInitialRef.current} onText={applyMarkdown} flushRef={mdFlushRef} />
      ) : view === 'source' && pdfDoc ? (
        <PdfSourceView pdfDoc={pdfDoc} onCreateTable={handleCreateTableFromRegion} busy={tableBusy} />
      ) : (
        <div className="editor-body">
          <div className="block-list" aria-label="Document">
            {blocks.length === 0 && <p className="hint empty-doc">The document is empty. Use the Insert tab to add a block.</p>}
            {blocks.map((block) => (
              <BlockView
                key={block.id}
                block={block}
                selected={selectedSet.has(block.id)}
                listNumber={listNumbers.get(block.id)}
                focus={focusReq && focusReq.id === block.id ? focusReq : null}
                dropPos={drop && drop.id === block.id ? drop.pos : null}
                ops={ops}
              />
            ))}
            <div className="doc-end" onClick={addAtEnd} title="Click to add text at the end">
              <span>Click here to add text</span>
            </div>
          </div>
          <SidePanel tab={tab} setTab={setTab} selected={selectedBlocks} api={api} />
        </div>
      )}
    </div>
  );
}

// The document as Markdown, editable. Edits update the structured view as you type.
function MarkdownView({ initial, onText, flushRef }) {
  const [text, setText] = useState(initial);
  const timer = useRef(null);
  const latest = useRef(text);
  latest.current = text;
  const applied = useRef(initial);

  const apply = useCallback(() => {
    clearTimeout(timer.current);
    if (latest.current === applied.current) return Promise.resolve();
    applied.current = latest.current;
    return onText(latest.current);
  }, [onText]);

  useEffect(() => {
    flushRef.current = apply;
    return () => {
      clearTimeout(timer.current);
      flushRef.current = null;
    };
  }, [apply, flushRef]);

  return (
    <div className="markdown-view">
      <p className="hint">
        This is the document as Markdown. Edits here update the Structured view. Export options (front matter, heading shift)
        are applied when you download.
      </p>
      <textarea
        className="md-area"
        value={text}
        spellCheck={false}
        aria-label="Markdown source"
        onChange={(e) => {
          setText(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(apply, 500);
        }}
        onBlur={apply}
      />
    </div>
  );
}
