# To Markdown

A fully client-side PDF/DOCX → Markdown converter with a WYSIWYG structure editor. No files are ever uploaded to a server — parsing, editing, and export all happen in the browser. Sibling project to [docs.insecure.co.nz](https://docs.insecure.co.nz) (DocScan), intended for deployment at `md.insecure.co.nz`.

## How it works

1. **Parse** — `mammoth` converts DOCX to semantic HTML (Word's built-in heading/list/table styles come through directly). `pdf.js` extracts raw text runs from PDF along with font size, boldness, and position, since PDF has no semantic structure at all.
2. **Normalize** — both formats get converted into one shared block model (`src/lib/blockModel.js`): a flat list of `{ type, level, text, confidence, ... }` blocks. Nothing downstream cares which format a block came from.
3. **Classify** (PDF only — DOCX styles are already explicit) — `src/lib/classifier.js` clusters font sizes to guess heading levels, detects bullet/numbered list markers and indentation, and assigns a **confidence score** to every guess.
4. **Edit** — the WYSIWYG editor (`src/components/Editor.jsx`) renders each block using its assigned style, lets you click any block to select it, and shows a right-hand inspector to change its type, indent level, or formatting. Blocks below a confidence threshold are visually flagged so you know what to check first. Detected tables open in a dedicated grid editor where you can toggle header rows/columns and edit cells directly — for fixing the common PDF failure mode of a table being read as the wrong shape.
5. **Export** — `src/lib/markdownExport.js` walks the (now user-corrected) block model and emits clean Markdown, downloaded as a `.md` file.

## Known limitations (MVP)

- **`.doc` (legacy binary format) is not supported.** A robust client-side parser for the old binary Word format is a much bigger undertaking than DOCX (which is just zipped XML). Users are asked to save as `.docx` first.
- **No OCR — PDF text extraction relies entirely on the file's existing text layer.** Scanned pages saved as images have no text layer at all, so they'll come through blank or garbled. The app detects this case (very little or no text found relative to page count) and shows a warning rather than failing silently; a general "no OCR" notice is also shown for every PDF, since even a mostly-text PDF can have individual scanned pages mixed in.
- **PDF tables are not automatically reconstructed** by the initial parse pass — PDF has no table structure at all, only column-aligned text. Instead, the **Source (PDF) view** lets you drag a rectangle around a table on the actual rendered page; the text underneath is reconstructed into rows/columns using a column-gap heuristic and dropped into the same table-repair grid as any other detected table. DOCX tables (structured in the file format) are detected automatically with no manual step needed.
- **PDF paragraph merging is heuristic.** Consecutive same-size text lines on the same page are merged into one paragraph. This can occasionally merge or split paragraphs incorrectly — use the WYSIWYG editor to fix by editing the block's text directly.
- **Images are not yet extracted.** Planned: DOCX images via mammoth's image handler, PDF images via canvas rendering, both bundled into a `.zip` alongside the `.md` file.

## Local development

```
npm install
npm run dev
```

Visit `http://localhost:5173`.

## Build

```
npm run build
```

Output goes to `dist/`.

## Deploy to Cloudflare Pages

Same flow as the DocScan sibling project:

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages** → connect the repo.
3. Build settings: framework preset **None**, build command `npm run build`, output directory `dist`.
4. Deploy. Point `md.insecure.co.nz` at the resulting Pages project via a CNAME/custom domain.

## Tech stack

- **React 18** + **Vite**
- **pdfjs-dist** — PDF text + layout extraction
- **mammoth** — DOCX → semantic HTML
- **jszip** — reserved for the planned image-bundling export (not yet wired up)

## Privacy

File contents never leave the browser. No upload endpoint exists in this codebase — parsing, classification, editing, and markdown generation all run client-side in JavaScript/WASM.

## Roadmap

- [ ] PDF table reconstruction from column-aligned text
- [ ] Image extraction + `.zip` export with `/images` folder
- [ ] `.doc` (legacy binary) support
- [ ] Drag-to-reorder blocks
- [ ] Export options: front matter, custom heading offset
