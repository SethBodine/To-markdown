import { useCallback, useState } from 'react';
import { parseDocx, flattenBlocks } from './lib/parsers/docxParser.js';
import { loadPdfDocument, extractPdfLines } from './lib/parsers/pdfParser.js';
import { classifyPdfLines } from './lib/classifier.js';
import { blocksToMarkdown } from './lib/markdownExport.js';
import Editor from './components/Editor.jsx';
import './App.css';

export default function App() {
  const [blocks, setBlocks] = useState(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | error
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [notices, setNotices] = useState([]);
  const [pdfDoc, setPdfDoc] = useState(null); // kept alive so the source view can re-render pages on demand

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setStatus('parsing');
    setError(null);
    setWarnings([]);
    setNotices([]);
    setFileName(file.name);

    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const buffer = await file.arrayBuffer();

      if (ext === 'docx') {
        const { blocks: parsed, warnings: w } = await parseDocx(buffer);
        setBlocks(flattenBlocks(parsed));
        setWarnings(w);
        setPdfDoc(null);
      } else if (ext === 'pdf') {
        const doc = await loadPdfDocument(buffer);
        const lines = await extractPdfLines(doc);
        setBlocks(classifyPdfLines(lines));
        setPdfDoc(doc);

        setNotices([
          'This reads the text layer already inside the PDF — it doesn\u2019t do OCR. Scanned pages saved as images will come through blank or garbled.',
        ]);

        const totalChars = lines.reduce((sum, l) => sum + l.text.length, 0);
        const avgCharsPerPage = totalChars / doc.numPages;
        if (avgCharsPerPage < 20) {
          setWarnings([
            'Almost no text was found in this PDF — it\u2019s likely a scanned/image-only document, which this tool can\u2019t read without OCR.',
          ]);
        }
      } else if (ext === 'doc') {
        throw new Error(
          'Legacy .doc files are not supported yet — please open the file in Word and save as .docx first.'
        );
      } else {
        throw new Error(`Unsupported file type: .${ext}`);
      }
      setStatus('ready');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong while reading this file.');
      setStatus('error');
    }
  }, []);

  const handleDownload = useCallback(() => {
    const markdown = blocksToMarkdown(blocks);
    const outName = fileName.replace(/\.[^.]+$/, '') + '.md';
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    a.click();
    URL.revokeObjectURL(url);
  }, [blocks, fileName]);

  const reset = useCallback(() => {
    setBlocks(null);
    setFileName('');
    setStatus('idle');
    setError(null);
    setWarnings([]);
    setNotices([]);
    setPdfDoc(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>To Markdown</h1>
          <p className="tagline">
            PDF and DOCX → clean Markdown, entirely in your browser. Nothing is ever uploaded.
          </p>
        </div>
        {status === 'ready' && (
          <div className="header-actions">
            <button className="btn" onClick={reset}>
              Start over
            </button>
            <button className="btn btn-primary" onClick={handleDownload}>
              Download .md
            </button>
          </div>
        )}
      </header>

      {status === 'idle' && <Dropzone onFile={handleFile} />}

      {status === 'parsing' && (
        <div className="status-panel">
          <p>Reading {fileName}…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="status-panel status-error">
          <p>{error}</p>
          <button className="btn" onClick={reset}>
            Try another file
          </button>
        </div>
      )}

      {status === 'ready' && blocks && (
        <>
          {notices.length > 0 && (
            <div className="notices">
              {notices.map((n, i) => (
                <p key={i}>ℹ {n}</p>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="warnings">
              {warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
          <Editor blocks={blocks} onChange={setBlocks} pdfDoc={pdfDoc} />
        </>
      )}
    </div>
  );
}

function Dropzone({ onFile }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`dropzone ${dragOver ? 'dropzone-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <p>Drag a PDF or DOCX file here, or</p>
      <label className="btn btn-primary">
        Choose file
        <input
          type="file"
          accept=".pdf,.docx,.doc"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files[0])}
        />
      </label>
      <p className="hint">.pdf and .docx supported. .doc: please save as .docx first.</p>
      <p className="hint">
        PDFs are read from their existing text layer — scanned/image-only PDFs won\u2019t extract text, since this
        tool doesn\u2019t do OCR.
      </p>
    </div>
  );
}
