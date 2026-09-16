// This is the answer to "if a table isn't read correctly, let me flag
// columns/header rows" from the brief: a plain editable grid where clicking a
// row or column index toggles whether it's the header, and every cell is
// directly editable text — covering the common PDF-table failure mode where
// a wrapped cell gets split across two reconstructed rows.

export default function TableEditor({ block, onChange }) {
  const { rows, headerRow, headerCol } = block;

  const setCell = (r, c, text) => {
    const next = rows.map((row) => [...row]);
    next[r][c] = text;
    onChange({ rows: next });
  };

  const addRow = () => {
    const colCount = rows[0]?.length || 1;
    onChange({ rows: [...rows, Array(colCount).fill('')] });
  };

  const removeRow = (r) => {
    onChange({ rows: rows.filter((_, i) => i !== r) });
  };

  const addCol = () => {
    onChange({ rows: rows.map((row) => [...row, '']) });
  };

  const removeCol = (c) => {
    onChange({ rows: rows.map((row) => row.filter((_, i) => i !== c)) });
  };

  const colCount = Math.max(...rows.map((r) => r.length), 1);

  return (
    <div className="table-editor">
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r === headerRow ? 'header-row' : ''}>
              <td className="row-controls">
                <button
                  className="tag-btn"
                  title="Toggle header row"
                  onClick={() => onChange({ headerRow: headerRow === r ? null : r })}
                >
                  {r === headerRow ? 'Header' : `Row ${r + 1}`}
                </button>
                <button className="icon-btn" title="Remove row" onClick={() => removeRow(r)}>
                  ✕
                </button>
              </td>
              {Array.from({ length: colCount }, (_, c) => (
                <td key={c} className={c === headerCol ? 'header-col' : ''}>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="cell-text"
                    onBlur={(e) => setCell(r, c, e.currentTarget.textContent)}
                  >
                    {row[c] ?? ''}
                  </div>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="row-controls">
              <button className="tag-btn" onClick={addRow}>
                + Row
              </button>
            </td>
            {Array.from({ length: colCount }, (_, c) => (
              <td key={c}>
                <button
                  className="tag-btn small"
                  title="Toggle header column"
                  onClick={() => onChange({ headerCol: headerCol === c ? null : c })}
                >
                  {c === headerCol ? 'Header col' : `Col ${c + 1}`}
                </button>
                <button className="icon-btn" title="Remove column" onClick={() => removeCol(c)}>
                  ✕
                </button>
              </td>
            ))}
            <td>
              <button className="tag-btn" onClick={addCol}>
                + Col
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
