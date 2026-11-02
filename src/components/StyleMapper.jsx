import { useMemo } from 'react';
import { STYLE_TARGETS } from '../lib/blockModel.js';

// The Word paragraph styles in this document that have no Markdown equivalent, each with a
// dropdown to choose what it should become. A choice applies to every paragraph in that style
// and can be undone.
export default function StyleMapper({ blocks, onMap }) {
  const groups = useMemo(() => {
    const byName = new Map();
    for (const b of blocks) {
      if (!b.docStyle) continue;
      const g = byName.get(b.docStyle) || { name: b.docStyle, count: 0, target: b.docStyleTarget || '' };
      g.count += 1;
      byName.set(b.docStyle, g);
    }
    return [...byName.values()];
  }, [blocks]);

  if (!groups.length) return null;

  return (
    <details className="style-bar" open>
      <summary><strong>Word styles with no Markdown equivalent ({groups.length})</strong></summary>
      <table className="style-table">
        <tbody>
          {groups.map((g) => (
            <tr key={g.name}>
              <td className="style-name">{g.name}</td>
              <td className="style-count">{g.count}</td>
              <td>
                <select value={g.target} aria-label={`Map the ${g.name} style`} onChange={(e) => onMap(g.name, e.target.value)}>
                  {STYLE_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
