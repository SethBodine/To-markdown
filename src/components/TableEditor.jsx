// A plain editable grid for tables: click a row or column tag to mark it as the
// header, edit any cell directly, add or remove rows and columns, and set each
// column's alignment. Cells are plain text (a pipe or line break is escaped on
// export). This is also where a table read badly from a PDF gets repaired.

export default function TableEditor({ block, onChange }) {
  const { rows, headerRow, headerCol } = block;
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const align = Array.from({ length: colCount }, (_, i) => (block.align || [])[i] ?? null);

  const setCell = (r, c, text) => {
    const next = rows.map((row) => [...row]);
    while (next[r].length < colCount) next[r].push('');
    next[r][c] = text;
    onChange({ rows: next });
  };
  const setAlign = (c, a) => {
    const next = [...align];
    next[c] = next[c] === a ? null : a;
    onChange({ align: next.some(Boolean) ? next : null });
  };

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
                <button
                  className="icon-btn"
                  title="Remove row"
                  aria-label={`Remove row ${r + 1}`}
                  onClick={() => onChange({ rows: rows.filter((_, i) => i !== r) })}
                >
                  &#10005;
                </button>
              </td>
              {Array.from({ length: colCount }, (_, c) => (
                <td key={c} className={c === headerCol ? 'header-col' : ''} style={{ textAlign: align[c] || undefined }}>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="cell-text"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const t = e.currentTarget.textContent;
                      if (t !== (row[c] ?? '')) setCell(r, c, t);
                    }}
                  >
                    {row[c] ?? ''}
                  </div>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="row-controls">
              <button
                className="tag-btn"
                onClick={() => onChange({ rows: [...rows, Array(colCount).fill('')] })}
              >
                + Row
              </button>
            </td>
            {Array.from({ length: colCount }, (_, c) => (
              <td key={c} className="col-controls">
                <button
                  className="tag-btn small"
                  title="Toggle header column"
                  onClick={() => onChange({ headerCol: headerCol === c ? null : c })}
                >
                  {c === headerCol ? 'Header col' : `Col ${c + 1}`}
                </button>
                {['left', 'center', 'right'].map((a) => (
                  <button
                    key={a}
                    className={`tag-btn small ${align[c] === a ? 'tag-on' : ''}`}
                    title={`Align ${a}`}
                    aria-pressed={align[c] === a}
                    onClick={() => setAlign(c, a)}
                  >
                    {a[0].toUpperCase()}
                  </button>
                ))}
                <button
                  className="icon-btn"
                  title="Remove column"
                  aria-label={`Remove column ${c + 1}`}
                  onClick={() =>
                    onChange({
                      rows: rows.map((row) => row.filter((_, i) => i !== c)),
                      align: align.filter((_, i) => i !== c).some(Boolean) ? align.filter((_, i) => i !== c) : null,
                    })
                  }
                >
                  &#10005;
                </button>
              </td>
            ))}
            <td>
              <button className="tag-btn" onClick={() => onChange({ rows: rows.map((row) => [...row, '']) })}>
                + Col
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
