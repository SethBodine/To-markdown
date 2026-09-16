import { useEffect, useRef, useState } from 'react';

// This is the visual counterpart to the block-list editor: instead of
// reading extracted text, you look at the real rendered page and drag a box
// around whatever your eyes tell you is a table. The rectangle is converted
// from canvas pixels back into PDF coordinate space via the page's own
// viewport transform, so it stays accurate regardless of render scale.

const RENDER_WIDTH = 820;

export default function PdfSourceView({ pdfDoc, onCreateTable, busy }) {
  const [pageNum, setPageNum] = useState(1);
  const [viewport, setViewport] = useState(null);
  const [drag, setDrag] = useState(null); // { startX, startY, x, y } in canvas pixel space
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const numPages = pdfDoc?.numPages || 1;

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = RENDER_WIDTH / baseViewport.width;
      const vp = page.getViewport({ scale });
      if (cancelled) return;

      const canvas = canvasRef.current;
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!cancelled) setViewport(vp);
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum]);

  const toLocalPoint = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e) => {
    const p = toLocalPoint(e);
    setDrag({ startX: p.x, startY: p.y, x: p.x, y: p.y });
  };

  const handleMouseMove = (e) => {
    if (!drag) return;
    const p = toLocalPoint(e);
    setDrag((d) => ({ ...d, x: p.x, y: p.y }));
  };

  const handleMouseUp = () => {
    if (!drag || !viewport) {
      setDrag(null);
      return;
    }
    const x1 = Math.min(drag.startX, drag.x);
    const x2 = Math.max(drag.startX, drag.x);
    const y1 = Math.min(drag.startY, drag.y);
    const y2 = Math.max(drag.startY, drag.y);

    if (x2 - x1 < 8 || y2 - y1 < 8) {
      // Treat as a stray click, not a real selection.
      setDrag(null);
      return;
    }

    // Canvas pixel corners -> PDF user-space coordinates via the page's viewport transform.
    const [px1, py1] = viewport.convertToPdfPoint(x1, y1);
    const [px2, py2] = viewport.convertToPdfPoint(x2, y2);

    onCreateTable(pageNum, {
      xMin: Math.min(px1, px2),
      xMax: Math.max(px1, px2),
      yMin: Math.min(py1, py2),
      yMax: Math.max(py1, py2),
    });
    setDrag(null);
  };

  const dragBoxStyle = drag
    ? {
        left: Math.min(drag.startX, drag.x),
        top: Math.min(drag.startY, drag.y),
        width: Math.abs(drag.x - drag.startX),
        height: Math.abs(drag.y - drag.startY),
      }
    : null;

  return (
    <div className="pdf-source-view">
      <div className="pdf-source-toolbar">
        <button className="btn" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
          ← Prev
        </button>
        <span>
          Page {pageNum} of {numPages}
        </span>
        <button className="btn" disabled={pageNum >= numPages} onClick={() => setPageNum((p) => p + 1)}>
          Next →
        </button>
        <span className="hint">Drag a box around a table to convert it</span>
        {busy && <span className="hint">Reading table…</span>}
      </div>

      <div
        ref={containerRef}
        className="pdf-page-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDrag(null)}
      >
        <canvas ref={canvasRef} />
        {dragBoxStyle && <div className="pdf-selection-box" style={dragBoxStyle} />}
      </div>
    </div>
  );
}
