import { useCallback, useEffect, useState } from 'react';
import { blocksToMarkdown, countHeadingClamps } from './lib/markdownExport.js';
import Editor from './components/Editor.jsx';
import './App.css';

// Every format reader is loaded on demand (see handleFile below) rather than
// imported statically here. Each reader pulls in a real dependency — pdf.js,
// mammoth, jszip, remark/unified, read-excel-file — and someone converting
// one HTML file has no reason to download code for the other five formats
// too. Dynamic import() makes Vite split each reader into its own chunk,
// fetched only when that specific format is actually opened.

// Zip-based formats (docx/odt/epub/xlsx) all start with the same magic
// bytes ("PK", the ZIP signature) regardless of the file extension someone
// gave the file. Checking this catches a mislabelled or corrupted file
// before it fails deep inside a format-specific parser with a confusing
// error.
const ZIP_MAGIC = [0x50, 0x4b];

async function looksLikeZip(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 2));
  return bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

const ZIP_FORMATS = new Set(['docx', 'odt', 'epub', 'xlsx']);

export default function App() {
  const [blocks, setBlocks] = useState(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | error
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [notices, setNotices] = useState([]);
  const [pdfDoc, setPdfDoc] = useState(null); // kept alive so the source view can re-render pages on demand
  // Export options apply when downloading or previewing; the editor itself is unchanged.
  const [exportOpts, setExportOpts] = useState({
    headingOffset: 0,
    frontMatterOn: false,
    fm: { title: '', author: '', date: '', tags: '', description: '' },
  });

  // Safety net for the whole page: without this, dropping a file anywhere
  // outside the two designated drop targets (the idle-state Dropzone, or the
  // "New file" control in the editor header) makes the browser navigate away
  // to display the raw file — silently destroying whatever the person was
  // editing, with zero warning. The two specific drop targets already call
  // preventDefault() themselves; this only stops the *default* browser
  // behavior everywhere else on the page, it never reads or processes the
  // file itself.
  useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

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

      if (ZIP_FORMATS.has(ext) && !(await looksLikeZip(buffer))) {
        throw new Error(
          `This file has a .${ext} extension but doesn’t look like a valid ${ext.toUpperCase()} file ` +
            '(it’s missing the ZIP signature every .docx/.odt/.epub/.xlsx file starts with). ' +
            'It may be corrupted, or have the wrong extension.'
        );
      }

      setPdfDoc(null);
      let resultBlocks = [];

      if (ext === 'docx') {
        const { parseDocx } = await import('./lib/parsers/docxParser.js');
        const { blocks: parsed, warnings: w } = await parseDocx(buffer);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
      } else if (ext === 'odt') {
        const { parseOdt } = await import('./lib/parsers/odtParser.js');
        const { blocks: parsed, warnings: w } = await parseOdt(buffer);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
      } else if (ext === 'epub') {
        const { parseEpub } = await import('./lib/parsers/epubParser.js');
        const { blocks: parsed, warnings: w } = await parseEpub(buffer);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
        setNotices(['Images inside EPUB chapters are not extracted yet — see the README roadmap.']);
      } else if (ext === 'xlsx' || ext === 'xls') {
        if (ext === 'xls') {
          throw new Error('Legacy .xls files are not supported — please save as .xlsx first.');
        }
        const { parseXlsx } = await import('./lib/parsers/xlsxParser.js');
        const { blocks: parsed, warnings: w } = await parseXlsx(buffer);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
        setNotices([
          'Spreadsheets have no concept of a "header row" in the file itself — the first row of each sheet is assumed to be the header. Check this in the table editor if it looks wrong.',
        ]);
      } else if (ext === 'html' || ext === 'htm') {
        const { parseHtml } = await import('./lib/parsers/htmlParser.js');
        const text = new TextDecoder('utf-8').decode(buffer);
        const { blocks: parsed, warnings: w } = await parseHtml(text);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
      } else if (ext === 'md' || ext === 'markdown') {
        const { parseMarkdown } = await import('./lib/parsers/markdownParser.js');
        const text = new TextDecoder('utf-8').decode(buffer);
        const { blocks: parsed, warnings: w } = await parseMarkdown(text);
        resultBlocks = parsed;
        setBlocks(parsed);
        setWarnings(w);
      } else if (ext === 'pdf') {
        const { loadPdfDocument, extractPdfLines } = await import('./lib/parsers/pdfParser.js');
        const { classifyPdfLines } = await import('./lib/classifier.js');
        const doc = await loadPdfDocument(buffer);
        const lines = await extractPdfLines(doc);
        const parsed = classifyPdfLines(lines);

        const totalChars = lines.reduce((sum, l) => sum + l.text.length, 0);
        const avgCharsPerPage = totalChars / doc.numPages;

        if (parsed.length === 0) {
          // A specific, more useful message than the generic "no content
          // found" below — this is almost certainly a scanned/image PDF,
          // and the person should know that's *why*, not just that it failed.
          throw new Error(
            'No text could be read from this PDF — it’s likely a scanned/image-only document, which this tool can’t read without OCR.'
          );
        }

        resultBlocks = parsed;
        setBlocks(parsed);
        setPdfDoc(doc);

        setNotices([
          'This reads the text layer already inside the PDF — it doesn’t do OCR. Scanned pages saved as images will come through blank or garbled.',
        ]);

        if (avgCharsPerPage < 20) {
          setWarnings([
            'Almost no text was found in this PDF — it’s likely a scanned/image-only document, which this tool can’t read without OCR.',
          ]);
        }
      } else if (ext === 'doc') {
        throw new Error(
          'Legacy .doc files are not supported — please open the file in Word and save as .docx first.'
        );
      } else {
        throw new Error(`Unsupported file type: .${ext}`);
      }

      if (resultBlocks.length === 0) {
        throw new Error(
          'No content was found to convert — this file appears to be empty, or nothing in it could be read as text.'
        );
      }

      setStatus('ready');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong while reading this file.');
      setStatus('error');
    }
  }, []);

  const handleDownload = useCallback(() => {
    const markdown = blocksToMarkdown(blocks, toExportConfig(exportOpts));
    const outName = fileName.replace(/\.[^.]+$/, '') + '.md';
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    a.click();
    URL.revokeObjectURL(url);
  }, [blocks, fileName, exportOpts]);

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
            Documents and PDFs → clean Markdown, entirely in your browser. Nothing is ever uploaded.
          </p>
        </div>
        {status === 'ready' && (
          <div className="header-actions">
            <HeaderFileControl onFile={handleFile} />
            <ExportOptions blocks={blocks} opts={exportOpts} setOpts={setExportOpts} fileName={fileName} />
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
                <p key={i}>
                  <strong>Note:</strong> {n}
                </p>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="warnings">
              {warnings.map((w, i) => (
                <p key={i}>
                  <strong>Warning:</strong> {w}
                </p>
              ))}
            </div>
          )}
          <Editor blocks={blocks} onChange={setBlocks} pdfDoc={pdfDoc} />
        </>
      )}
      <footer className="app-footer">
        <a href="https://github.com/SethBodine/To-markdown" target="_blank" rel="noopener noreferrer">
          Source code on GitHub
        </a>
        <span> | MIT licensed | files never leave your browser</span>
      </footer>
    </div>
  );
}

function toExportConfig(opts) {
  return { headingOffset: opts.headingOffset, frontMatter: opts.frontMatterOn ? opts.fm : null };
}

// Front matter and a heading-level offset, applied only to the exported file.
function ExportOptions({ blocks, opts, setOpts, fileName }) {
  const [open, setOpen] = useState(false);
  const setFm = (patch) => setOpts((o) => ({ ...o, fm: { ...o.fm, ...patch } }));
  const clamped = countHeadingClamps(blocks, opts.headingOffset);

  const toggleFrontMatter = (on) =>
    setOpts((o) => {
      if (!on || o.fm.title) return { ...o, frontMatterOn: on };
      const first = blocks.find((b) => b.type === 'heading' && b.text.trim());
      return {
        ...o,
        frontMatterOn: on,
        fm: {
          ...o.fm,
          title: first ? first.text.trim() : fileName.replace(/\.[^.]+$/, ''),
          date: o.fm.date || new Date().toLocaleDateString('en-CA'),
        },
      };
    });

  return (
    <details className="export-options" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="btn">Export options</summary>
      <div className="export-panel">
        <label className="field">
          <span>Shift all heading levels by</span>
          <select value={opts.headingOffset} onChange={(e) => setOpts((o) => ({ ...o, headingOffset: Number(e.target.value) }))}>
            {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n > 0 ? `+${n}` : n} {n === 0 ? '(none)' : n > 0 ? '(deeper)' : '(higher)'}</option>
            ))}
          </select>
        </label>
        {clamped > 0 && (
          <p className="panel-msg">{clamped} heading{clamped === 1 ? '' : 's'} would go past H1 or H6 and {clamped === 1 ? 'is' : 'are'} held at the limit.</p>
        )}
        <label className="field field-inline">
          <input type="checkbox" checked={opts.frontMatterOn} onChange={(e) => toggleFrontMatter(e.target.checked)} />
          <span>Add front matter (YAML)</span>
        </label>
        {opts.frontMatterOn && (
          <div className="fm-fields">
            {[['title', 'Title'], ['author', 'Author'], ['date', 'Date (YYYY-MM-DD)'], ['tags', 'Tags (comma separated)'], ['description', 'Description']].map(([k, label]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <input type="text" value={opts.fm[k]} onChange={(e) => setFm({ [k]: e.target.value })} />
              </label>
            ))}
          </div>
        )}
        {open && (
          <>
            <span className="preview-label">Preview of the exported file</span>
            <pre className="export-preview">{blocksToMarkdown(blocks, toExportConfig(opts)).slice(0, 2500) || '(empty)'}</pre>
          </>
        )}
      </div>
    </details>
  );
}

// A compact drag-and-drop target that replaces "Start over" in the editor
// header: dropping (or choosing) a new file loads it directly, in one step,
// rather than making the person click "Start over" first and then face the
// full-size Dropzone again just to pick another file.
function HeaderFileControl({ onFile }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <label
      className={`header-drop-target ${dragOver ? 'header-drop-target-active' : ''}`}
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
      title="Drop a file here, or click to choose one — replaces the current document"
    >
      {dragOver ? 'Drop to convert' : 'New file'}
      <input
        type="file"
        accept=".pdf,.docx,.doc,.odt,.html,.htm,.md,.markdown,.epub,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files[0])}
      />
    </label>
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
      <p>Drag a file here, or</p>
      <label className="btn btn-primary">
        Choose file
        <input
          type="file"
          accept=".pdf,.docx,.doc,.odt,.html,.htm,.md,.markdown,.epub,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files[0])}
        />
      </label>
      <p className="hint">
        Supported: PDF, DOCX, ODT, HTML, Markdown, EPUB, XLSX. Legacy .doc and .xls: please save as .docx/.xlsx
        first.
      </p>
      <p className="hint">
        PDFs are read from their existing text layer — scanned/image-only PDFs won’t extract text, since this
        tool doesn’t do OCR.
      </p>
    </div>
  );
}
