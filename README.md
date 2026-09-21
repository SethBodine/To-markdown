# To Markdown

A fully client-side document → Markdown converter with a WYSIWYG structure editor. No files are ever uploaded to a server — parsing, editing, and export all happen in the browser. Sibling project to [docs.insecure.co.nz](https://docs.insecure.co.nz) (DocScan), intended for deployment at `md.insecure.co.nz`.

## Supported formats

**Via dedicated readers** (no OCR, no server round-trip — everything below runs client-side):

| Format | Reader | Notes |
|---|---|---|
| PDF | `pdfParser.js` + `classifier.js` | Text-layer only, no OCR. Font-size clustering infers headings; drag-to-select in **Source view** reconstructs tables (see limitations below). |
| DOCX | `docxParser.js` (via `mammoth`) | Word's built-in heading/list/table styles map directly — high confidence, not a guess. |
| ODT | `odtParser.js` | Reads OpenDocument's own XML vocabulary (`text:h`, `table:table`, etc.) directly against the ODF spec. |
| HTML | `htmlParser.js` | Direct DOM tree walk. |
| Markdown | `markdownParser.js` (via `remark`/`remark-gfm`) | For cleaning up or restructuring existing `.md` files in the same editor. |
| EPUB | `epubParser.js` | Follows the OPF spine in reading order; each chapter is XHTML, read with the same walker as plain HTML. |
| XLSX | `xlsxParser.js` (via `read-excel-file`) | Each sheet becomes a heading + table block. |

**Not supported:** legacy `.doc` and `.xls` (binary formats — save as `.docx`/`.xlsx` first).

**Important:** PDF cannot be read by most general-purpose document converters, including pandoc — PDF appears only as an *output* format in pandoc's own format list, never an input one. This isn't a gap unique to this tool; it's why the PDF path here is its own hand-built pipeline (`pdfParser.js`/`classifier.js`/`pdfTableRegion.js`) rather than routed through a shared library, and why it stays the way it is even as other formats are added.

## How it works

1. **Parse** — each format has its own reader (see table above), but every reader converges on the same output shape.
2. **Normalize** — all formats get converted into one shared block model (`src/lib/blockModel.js`): a flat list of `{ type, level, text, confidence, ... }` blocks. Nothing downstream cares which format or reader a block came from. DOCX, HTML, and EPUB share a common tree-walker (`src/lib/parsers/htmlTreeWalker.js`) since EPUB chapters and mammoth's DOCX output are both HTML trees at that point.
3. **Classify** (PDF only — every other format states its own structure explicitly) — `src/lib/classifier.js` clusters font sizes to guess heading levels, detects bullet/numbered list markers and indentation, and assigns a **confidence score** to every guess. Explicit structure from other formats (a real DOCX heading style, a real ODT table) gets `confidence: 1.0` or close to it — it isn't a guess and the editor shouldn't flag it as one.
4. **Edit** — the WYSIWYG editor (`src/components/Editor.jsx`) renders each block using its assigned style, lets you click any block to select it, and shows a right-hand inspector to change its type, indent level, or formatting. Blocks below a confidence threshold are visually flagged so you know what to check first. Detected tables open in a dedicated grid editor where you can toggle header rows/columns and edit cells directly.
5. **Export** — `src/lib/markdownExport.js` walks the (now user-corrected) block model and emits clean Markdown, downloaded as a `.md` file.

## Design note: readers → shared model → one exporter

This project's reader architecture — many independent format readers, each producing the same intermediate representation, with a single exporter walking that representation once — was chosen after looking at how [pandoc](https://github.com/jgm/pandoc) is structured, since pandoc's own reader/writer/AST separation is a clean example of the pattern. **No pandoc code or binary is used anywhere in this project.** Every reader here was written from scratch against the relevant public file-format specification or against the cited library's own documentation. See `NOTICE.md` for the full reasoning (this matters for licensing: pandoc is GPL, and depending on its code or compiled binary would pull that copyleft into this project — reusing the architecture as an idea, rather than the code, avoids that entirely).

Pandoc's own documentation makes a point worth repeating here: conversions from formats more expressive than the target's document model are inherently lossy, and complex tables may not fit a simple document model. That's exactly why the WYSIWYG correction layer exists on top of every reader in this project, not just the PDF one — a reader's best guess is a starting point, not a guarantee.

## Known limitations

- **No OCR — PDF text extraction relies entirely on the file's existing text layer.** Scanned pages saved as images have no text layer at all, so they'll come through blank or garbled. The app detects this case (very little or no text found relative to page count) and shows a warning rather than failing silently; a general "no OCR" notice is also shown for every PDF, since even a mostly-text PDF can have individual scanned pages mixed in.
- **PDF tables are not automatically reconstructed** by the initial parse pass — PDF has no table structure at all, only column-aligned text. Instead, the **Source (PDF) view** lets you drag a rectangle around a table on the actual rendered page; the text underneath is reconstructed into rows/columns using a column-gap heuristic and dropped into the same table-repair grid as any other detected table.
- **PDF paragraph merging is heuristic.** Consecutive same-size text lines on the same page are merged into one paragraph. This can occasionally merge or split paragraphs incorrectly — use the WYSIWYG editor to fix by editing the block's text directly.
- **`.doc` and `.xls` (legacy binary formats) are not supported.** Both are much harder to parse client-side than their modern zipped-XML successors. Users are asked to save as `.docx`/`.xlsx` first.
- **Inline formatting is block-level only.** A paragraph can be marked bold/italic as a whole, but a single bold *word* inside an otherwise plain paragraph has no representation in the block model — the emphasis is dropped rather than (incorrectly) applied to the whole paragraph. This was an actual bug caught during testing (partial inline bold was wrongly bolding entire paragraphs in the DOM-based readers) and fixed by only setting `bold`/`italic` when a single styled child accounts for the block's *entire* text content.
- **EPUB/HTML images are not extracted** — an `<img>` tag becomes a flagged, low-confidence placeholder line (`[image: alt text]`) rather than being silently dropped.
- **XLSX header-row detection is a convention, not a fact.** Spreadsheets don't semantically mark a header row the way a real document format does, so the first row of each sheet is assumed to be the header, flagged with middling confidence for review in the table editor.
- **Images are not yet extracted from DOCX/PDF.** Planned: DOCX images via mammoth's image handler, PDF images via canvas rendering, both bundled into a `.zip` alongside the `.md` file.

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

Cloudflare Pages automatically picks up `public/_headers` (copied to the build output root by Vite) and applies the security headers in it — no extra dashboard configuration needed. Since this app makes zero network calls by design, the CSP is deliberately strict: `connect-src 'none'`, `object-src 'none'`, `frame-ancestors 'none'`. `style-src` needs `'unsafe-inline'` because React sets some inline `style` attributes directly; everything else is `'self'`-only.

## Tech stack

- **React 18** + **Vite**
- **pdfjs-dist** — PDF text + layout extraction (Apache-2.0)
- **mammoth** — DOCX → semantic HTML (BSD-2-Clause)
- **jszip** — ZIP handling for ODT/EPUB/XLSX-adjacent formats (MIT)
- **unified** / **remark-parse** / **remark-gfm** — Markdown parsing, including GFM tables (all MIT)
- **read-excel-file** — XLSX reading (MIT) — see `NOTICE.md` for why this was chosen over the more common `xlsx` (SheetJS) package

Full dependency license list in `NOTICE.md`.

## Security

- **No network calls.** This app has no upload endpoint, no telemetry, no third-party scripts — everything happens client-side. The `public/_headers` CSP enforces this at the browser level (`connect-src 'none'`).
- **No `dangerouslySetInnerHTML`, `innerHTML`, or `eval`/`new Function` anywhere in the codebase.** Every DOM/XML-based reader (DOCX, HTML, ODT, EPUB) runs its source through `DOMParser` to walk it, but only ever reads `.textContent`/attributes — a script tag embedded in a malicious file is parsed inert and never rendered or executed. All text reaches the DOM via React children, which escape by default.
- **pdf.js's worker is bundled locally** (via Vite's `?url` import) rather than loaded from a CDN at runtime, so there's no third-party script in the trust chain at load time.
- **The XLSX reader was deliberately chosen to avoid a known high-severity advisory.** The more widely-used SheetJS `xlsx` npm package has an unpatched (on npm) prototype-pollution/ReDoS vulnerability in exactly the code path this app exercises — parsing untrusted, user-supplied files. `read-excel-file` was used instead. See `NOTICE.md` for details.
- Run `npm audit` before deploying. As of this build: **0 vulnerabilities affecting the production bundle** (`npm audit --omit=dev`). The only finding in a full audit is a moderate advisory in `esbuild`/`vite`'s **dev server** (arbitrary requests accepted by `npm run dev`), which doesn't ship in the built static output.

## Privacy

File contents never leave the browser. No upload endpoint exists in this codebase — parsing, classification, editing, and markdown generation all run client-side in JavaScript.

## Roadmap

- [ ] PDF table reconstruction from column-aligned text without manual region selection
- [ ] Image extraction (DOCX/PDF/EPUB) + `.zip` export with `/images` folder
- [ ] `.doc`/`.xls` (legacy binary) support
- [ ] RTF, LaTeX, Org-mode, reStructuredText readers (deferred — see licensing/quality bar in NOTICE.md before adding)
- [ ] Rich inline formatting (mixed bold/italic runs within one paragraph)
- [ ] Drag-to-reorder blocks
- [ ] Export options: front matter, custom heading offset
