import { useCallback, useMemo, useRef, useState } from 'react';
import BlockView from './BlockView.jsx';
import Inspector from './Inspector.jsx';
import PdfSourceView from './PdfSourceView.jsx';
import { insertTableAtRegion } from '../lib/blockModel.js';
import { extractTableFromRegion } from '../lib/pdfTableRegion.js';
import { makeTableBlock } from '../lib/blockModel.js';

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

  // The core of "select a section in the PDF and say this is a table": the
  // region comes back in PDF coordinate space from PdfSourceView, gets turned
  // into rows via the gap heuristic, and lands in the block list as a normal
  // table block — from there it's the same TableEditor grid as any other
  // detected table.
  const handleCreateTableFromRegion = useCallback(
    async (pageNum, regionBbox) => {
      setTableBusy(true);
      try {
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
