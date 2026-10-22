import { useCallback, useMemo, useRef, useState } from 'react';
import BlockView from './BlockView.jsx';
import Inspector from './Inspector.jsx';
import PdfSourceView from './PdfSourceView.jsx';
import {
  insertTableAtRegion,
  makeTableBlock,
  titleBlocks,
  titleAsH1Active,
  clampedHeadingCount,
  applyTitleAsH1,
  revertTitleAsH1,
} from '../lib/blockModel.js';
// extractTableFromRegion is imported dynamically inside handleCreateTableFromRegion,
// not statically here — it transitively pulls in pdfParser.js and all of
// pdf.js, and Editor.jsx renders for every format, not just PDF. A static
// import here would put pdf.js in the initial bundle even for someone who
// only ever converts an HTML file.

// Undo/redo is a simple stack of full block-array snapshots. The block model
// is small enough (a few hundred blocks for a long document) that this is
// far simpler than a command-pattern diff stack, and correctness matters
// more than micro-optimizing memory here.

export default function Editor({ blocks, onChange, pdfDoc }) {
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState('structured'); // 'structured' | 'source'
  const [tableBusy, setTableBusy] = useState(false);
  const historyRef = useRef({ past: [], future: [] });

  const commit = useCallback(
    (nextBlocks) => {
      historyRef.current.past.push(blocks);
      historyRef.current.future = [];
      onChange(nextBlocks);
    },
    [blocks, onChange]
  );

  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (!past.length) return;
    const prev = past.pop();
    future.push(blocks);
    onChange(prev);
  }, [blocks, onChange]);

  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (!future.length) return;
    const next = future.pop();
    past.push(blocks);
    onChange(next);
  }, [blocks, onChange]);

  const updateBlock = useCallback(
    (id, patch) => {
      commit(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, commit]
  );

  const selectedBlock = useMemo(() => blocks.find((b) => b.id === selectedId) || null, [blocks, selectedId]);

  const lowConfidenceCount = useMemo(() => blocks.filter((b) => b.confidence < 0.6).length, [blocks]);

  // "Use document Title as H1": offered only when the source (a Word document)
  // actually contains Title-styled paragraphs. Ticking promotes them to H1 and
  // moves every other heading down one level; unticking puts it all back.
  const titleCount = useMemo(() => titleBlocks(blocks).length, [blocks]);
  const titleActive = useMemo(() => titleAsH1Active(blocks), [blocks]);
  const clampedCount = useMemo(() => clampedHeadingCount(blocks), [blocks]);
  const toggleTitleAsH1 = (checked) => {
    commit(checked ? applyTitleAsH1(blocks) : revertTitleAsH1(blocks));
  };

  // The editor rendered every numbered-list item as a literal "1." — correct
  // in the final markdown export (CommonMark renderers auto-number), but
  // wrong as a WYSIWYG preview: two consecutive list items both showing "1."
  // looks broken even though the exported file is fine. Compute a real
  // running number per contiguous run of numbered items at the same level.
  const listNumbers = useMemo(() => {
    const map = new Map();
    let counter = 0;
    let prevLevel = null;
    for (const b of blocks) {
      if (b.type === 'numbered') {
        const level = b.level || 0;
        counter = prevLevel === level ? counter + 1 : 1;
        map.set(b.id, counter);
        prevLevel = level;
      } else {
        counter = 0;
        prevLevel = null;
      }
    }
    return map;
  }, [blocks]);

  // The core of "select a section in the PDF and say this is a table": the
  // region comes back in PDF coordinate space from PdfSourceView, gets turned
  // into rows via the gap heuristic, and lands in the block list as a normal
  // table block — from there it's the same TableEditor grid as any other
  // detected table.
  const handleCreateTableFromRegion = useCallback(
    async (pageNum, regionBbox) => {
      setTableBusy(true);
      try {
        const { extractTableFromRegion } = await import('../lib/pdfTableRegion.js');
        const { rows, bbox } = await extractTableFromRegion(pdfDoc, pageNum, regionBbox);
        if (!rows.length) return;

        const tableBlock = makeTableBlock(rows, {
          headerRow: 0,
          confidence: 0.5, // it's a heuristic reconstruction — flag it like anything else uncertain
          source: { format: 'pdf', page: pageNum, ...bbox },
        });

        const nextBlocks = insertTableAtRegion(blocks, tableBlock, pageNum, bbox);
        commit(nextBlocks);
        setSelectedId(tableBlock.id);
        setView('structured');
      } finally {
        setTableBusy(false);
      }
    },
    [blocks, commit, pdfDoc]
  );

  return (
    <div className="editor">
      {titleCount > 0 && view === 'structured' && (
        <label className="option-bar">
          <input
            type="checkbox"
            checked={titleActive}
            onChange={(e) => toggleTitleAsH1(e.target.checked)}
          />
          <span>
            <strong>Use the document Title as H1.</strong> This Word document has a Title style
            {titleCount > 1 ? ` (${titleCount} paragraphs)` : ''}. Ticking this makes it a top-level
            heading and moves every other heading down one level (H1 to H2, H2 to H3, and so on).
            {titleActive && clampedCount > 0
              ? ` ${clampedCount} heading${clampedCount === 1 ? ' was' : 's were'} already H6, so ${
                  clampedCount === 1 ? 'it stays' : 'they stay'
                } at H6.`
              : ''}
          </span>
        </label>
      )}
      <div className="editor-toolbar">
        <button className="btn" onClick={undo} disabled={!historyRef.current.past.length}>
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!historyRef.current.future.length}>
          Redo
        </button>
        {pdfDoc && (
          <div className="view-toggle">
            <button
              className={`btn ${view === 'structured' ? 'btn-active' : ''}`}
              onClick={() => setView('structured')}
            >
              Structured
            </button>
            <button className={`btn ${view === 'source' ? 'btn-active' : ''}`} onClick={() => setView('source')}>
              Source (PDF)
            </button>
          </div>
        )}
        {lowConfidenceCount > 0 && (
          <span className="flag-count">
            {lowConfidenceCount} block{lowConfidenceCount === 1 ? '' : 's'} flagged for review
          </span>
        )}
      </div>

      {view === 'source' && pdfDoc ? (
        <PdfSourceView pdfDoc={pdfDoc} onCreateTable={handleCreateTableFromRegion} busy={tableBusy} />
      ) : (
        <div className="editor-body">
          <div className="block-list">
            {blocks.map((block) => (
              <BlockView
                key={block.id}
                block={block}
                selected={block.id === selectedId}
                onSelect={() => setSelectedId(block.id)}
                onChange={(patch) => updateBlock(block.id, patch)}
                listNumber={listNumbers.get(block.id)}
              />
            ))}
          </div>

          <div className="inspector-pane">
            {selectedBlock ? (
              <Inspector block={selectedBlock} onChange={(patch) => updateBlock(selectedBlock.id, patch)} />
            ) : (
              <p className="inspector-empty">Select a block to see and adjust its style.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
