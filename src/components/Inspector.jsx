import { BLOCK_TYPES, blockTypeKey } from '../lib/blockModel.js';

export default function Inspector({ block, onChange }) {
  const currentKey = blockTypeKey(block);
  const isListType = block.type === 'bullet' || block.type === 'numbered';
  const isTable = block.type === 'table';

  return (
    <div className="inspector">
      <h3>Block properties</h3>

      <ConfidenceBar confidence={block.confidence} />

      {!isTable && (
        <>
          <label className="field">
            <span>Type</span>
            <select
              value={currentKey}
              onChange={(e) => {
                const def = BLOCK_TYPES.find((t) => t.value === e.target.value);
                onChange({ type: def.type, level: def.level });
              }}
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {isListType && (
            <label className="field">
              <span>Indent level</span>
              <div className="stepper">
                <button
                  className="btn"
                  onClick={() => onChange({ level: Math.max(0, (block.level || 0) - 1) })}
                >
                  −
                </button>
                <span>{block.level || 0}</span>
                <button className="btn" onClick={() => onChange({ level: (block.level || 0) + 1 })}>
                  +
                </button>
              </div>
            </label>
          )}

          <label className="field field-inline">
            <input
              type="checkbox"
              checked={!!block.bold}
              onChange={(e) => onChange({ bold: e.target.checked })}
            />
            <span>Bold</span>
          </label>

          <label className="field field-inline">
            <input
              type="checkbox"
              checked={!!block.italic}
              onChange={(e) => onChange({ italic: e.target.checked })}
            />
            <span>Italic</span>
          </label>
        </>
      )}

      {isTable && (
        <p className="hint">
          Click a row or column header in the table to mark it as a header, or edit cells directly.
        </p>
      )}

      {block.source?.page != null && <p className="hint">Source: page {block.source.page}</p>}
    </div>
  );
}

function ConfidenceBar({ confidence }) {
  const pct = Math.round(confidence * 100);
  const level = confidence < 0.6 ? 'low' : confidence < 0.85 ? 'medium' : 'high';
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className={`confidence-fill confidence-${level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="confidence-label">
        {level === 'low' && 'Low confidence — worth checking'}
        {level === 'medium' && 'Medium confidence'}
        {level === 'high' && 'High confidence'}
      </span>
    </div>
  );
}
