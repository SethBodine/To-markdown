# To Markdown

**Source code:** [github.com/SethBodine/To-markdown](https://github.com/SethBodine/To-markdown)

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
4. **Edit** — the editor renders each block the way it will read once exported, with the text editable in place (see Editing below). Blocks below a confidence threshold are visually flagged so you know what to check first, and the flag clears once you change a block. Detected tables open in a grid editor where you can mark header rows/columns, set column alignment and edit cells.
5. **Export** — `src/lib/markdownExport.js` walks the (now user-corrected) block model and emits clean Markdown, downloaded as a `.md` file.

### Word "Title" style: optional H1

Word's Title style has no Markdown equivalent, so by default it comes through as a plain paragraph. When a DOCX contains one, a tick box appears above the editor: **Use the document Title as H1**. Ticking it makes the Title an H1 and moves every other heading down one level (H1 to H2, H2 to H3, and so on). Unticking restores the original levels, and the change is part of the normal Undo history. H6 has nowhere to go, so a document that already uses H6 keeps those at H6 and the bar says how many. The option is off by default and only appears when a Title style is actually present.

## Design note: readers → shared model → one exporter

This project's reader architecture — many independent format readers, each producing the same intermediate representation, with a single exporter walking that representation once — was chosen after looking at how [pandoc](https://github.com/jgm/pandoc) is structured, since pandoc's own reader/writer/AST separation is a clean example of the pattern. **No pandoc code or binary is used anywhere in this project.** Every reader here was written from scratch against the relevant public file-format specification or against the cited library's own documentation. See `NOTICE.md` for the full reasoning (this matters for licensing: pandoc is GPL, and depending on its code or compiled binary would pull that copyleft into this project — reusing the architecture as an idea, rather than the code, avoids that entirely).

Pandoc's own documentation makes a point worth repeating here: conversions from formats more expressive than the target's document model are inherently lossy, and complex tables may not fit a simple document model. That's exactly why the WYSIWYG correction layer exists on top of every reader in this project, not just the PDF one — a reader's best guess is a starting point, not a guarantee.

## Editing

Everything on the page is editable in place; there is no separate edit mode.

**Selecting blocks.** Click a block, **Ctrl/Cmd + click** to add or remove one, or tick the box at its left. **Shift + click** (on a block or on its tick box, the two behave identically) selects everything from the last block you clicked or ticked. Blocks you picked one at a time stay selected, and a new Shift range replaces the previous Shift range, so you can widen or shrink it. **Ctrl/Cmd + A** selects everything and **Esc** clears. With several blocks selected, the Properties panel changes the type of all of them, toggles bold/italic, indents list items, links or unlinks them, merges them into one block, and moves, duplicates or deletes them.

**Editing text.** Type directly. **Enter** splits a block at the caret (on an empty list item it outdents, then leaves the list), **Backspace** at the start joins a block to the one above (or turns a heading/list item back into a paragraph), **Tab / Shift+Tab** indents a list item, and the arrow keys move between blocks. Pasting inserts plain text only. Undo and Redo cover every change, including bulk ones.

**Links.** Selecting text that is already a link makes a **Link** card appear at the top of the Properties tab, showing its address: edit it there, or remove the link (select across several links and you can set or remove them all at once). The Insert tab is for **new** links only: with text selected, "Link selected text" turns it into a link; with only a cursor, "Insert new link" adds new linked text there (or, if there is no cursor, as a new paragraph). Its address box starts empty and is never filled in from an existing link. For whole blocks, Properties has "Link whole block" (one address for every selected block) and "Remove all links". **Ctrl/Cmd + K** jumps to the right place: the link's address if you are on a link, otherwise the new-link box. Only `http`, `https`, `mailto`, `tel` and relative addresses are accepted.

**Insert tab** (laid out like the [Markdown cheat sheet](https://www.markdownguide.org/cheat-sheet/)): select text to make it bold, italic, strikethrough, code, highlight, subscript or superscript, add a footnote (the `[^1]` reference and its definition at the end); and add a heading (H1-H6), paragraph, quote, bullet, numbered or task item, horizontal rule, definition, fenced code block with a language, table of any size, or image. New blocks go after or before the selection, or at the end. Emoji shortcodes are not offered; typing `:joy:` works as ordinary text.

**Reordering.** Drag the grip at the left of a block; if several blocks are selected they move together. Move up / Move down in the panel does the same from the keyboard.

**Markdown tab.** Switch between Structured and Markdown at any time. The Markdown tab shows the document as Markdown and is editable; what you type is read back into blocks as you go (and when you leave the tab), and the whole session is a single Undo step. Opening the tab and switching back without typing changes nothing. The tab shows the document itself: export options (below) are applied only when you download.

**Code blocks.** Each code block has a language box on the block itself (type any name, or pick one from the list) and is syntax-highlighted for common languages. Long lines scroll sideways inside the block rather than widening the page.

**Selecting text and changing type.** Select part of a line and change the Type in the Properties panel, and only that text changes: the block is split into before, selection and after. If the whole line is selected, or only the caret is in it, the whole block changes. Multi-select bulk changes always apply to whole blocks.

**Adding at the end.** The empty space below the last block is clickable: click it to start a new paragraph there.

**Tick boxes.** Tick boxes appear when you hover a block; the Tick boxes button in the toolbar keeps them visible on every block.

**Export options** (header, applied only to the downloaded file; a live preview is shown): shift every heading level up or down (levels are held at H1 and H6, and you are told how many were), and add YAML front matter (title, author, date, tags, description).

## Performance

Every format reader is loaded via a dynamic `import()` at the point it's actually needed, not bundled statically into the initial page load. Each reader pulls in a real dependency (pdf.js, mammoth, jszip, remark/unified, read-excel-file), and someone converting one small HTML file has no reason to download code for the other six formats. This keeps the initial JS bundle at about 202 KB (gzipped about 64 KB) plus 15 KB of CSS, against about 1,078 KB if everything were in one bundle; pdf.js (the largest dependency by far) is only fetched if a PDF is opened, and the syntax highlighter only when a code block has a language.

The block list has no virtualization (every block is a real DOM node). Measured on a modest shared CPU: a 4,000-block Word document opens in about 3 seconds and a 2,000-block Markdown file in about 3 seconds (the Markdown parser is about a third of that); once open, selecting, typing and select-all stay under half a second. The editing features added roughly 15-20% to load time compared with the earlier read-only build, measured side by side on the same machine. Absolute times depend heavily on the machine, so treat these as relative figures. Virtualizing the list is the obvious next step if much larger documents matter.

## Known limitations

- **No OCR — PDF text extraction relies entirely on the file's existing text layer.** Scanned pages saved as images have no text layer at all, so they'll come through blank or garbled. The app detects this case (very little or no text found relative to page count) and shows a warning rather than failing silently; a general "no OCR" notice is also shown for every PDF, since even a mostly-text PDF can have individual scanned pages mixed in.
- **PDF tables are not automatically reconstructed** by the initial parse pass — PDF has no table structure at all, only column-aligned text. Instead, the **Source (PDF) view** lets you drag a rectangle around a table on the actual rendered page; the text underneath is reconstructed into rows/columns using a column-gap heuristic and dropped into the same table-repair grid as any other detected table.
- **PDF paragraph merging is heuristic.** Consecutive same-size text lines on the same page are merged into one paragraph. This can occasionally merge or split paragraphs incorrectly — use the WYSIWYG editor to fix by editing the block's text directly.
- **`.doc` and `.xls` (legacy binary formats) are not supported.** Both are much harder to parse client-side than their modern zipped-XML successors. Users are asked to save as `.docx`/`.xlsx` first.
- **Only Word's "Title" style is recognised for the Title option** (matched by style name or style ID). "Subtitle" and custom title styles come through as ordinary paragraphs.
- **Inline formatting is kept for DOCX, HTML, EPUB and Markdown, but not for ODT, PDF or XLSX**, whose readers still produce plain text per block (you can add formatting yourself in the editor). Table cells are plain text: no links or emphasis inside a cell.
- **The Markdown tab reads text back into blocks.** Everything the editor can produce round-trips, including heading anchors and definition lists, but raw HTML, reference-style links and nested block quotes are simplified or dropped, and per-block details such as PDF source positions and review flags are reset when the text is re-read.
- **Changing type on selected text splits the block** (Markdown has no inline heading), so a selected word becomes its own block between the two halves.
- **Images are referenced, not extracted.** An `<img>` (or a Markdown image) becomes an image block holding its alt text and URL. Pictures embedded inside a DOCX or EPUB have no URL, so they come through as flagged image blocks with the URL left blank for you to fill in or delete. The editor never loads image URLs (nothing leaves your browser), it shows a placeholder.
- **XLSX header-row detection is a convention, not a fact.** Spreadsheets don't semantically mark a header row the way a real document format does, so the first row of each sheet is assumed to be the header, flagged with middling confidence for review in the table editor.

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
- **highlight.js** — syntax highlighting in code blocks, loaded on demand (BSD-3-Clause)
- **read-excel-file** — XLSX reading (MIT) — see `NOTICE.md` for why this was chosen over the more common `xlsx` (SheetJS) package

Full dependency license list in `NOTICE.md`.

## Security

- **No network calls.** This app has no upload endpoint, no telemetry, no third-party scripts — everything happens client-side. The `public/_headers` CSP enforces this at the browser level (`connect-src 'none'`).
- **No `dangerouslySetInnerHTML`, `innerHTML`, or `eval`/`new Function` anywhere in the codebase.** Every DOM/XML-based reader (DOCX, HTML, ODT, EPUB) runs its source through `DOMParser` to walk it, but only ever reads `.textContent`/attributes — a script tag embedded in a malicious file is parsed inert and never rendered or executed. All text reaches the DOM via React children, which escape by default.
- **pdf.js's worker is bundled locally** (via Vite's `?url` import) rather than loaded from a CDN at runtime, so there's no third-party script in the trust chain at load time.
- **The XLSX reader was deliberately chosen to avoid a known high-severity advisory.** The more widely-used SheetJS `xlsx` npm package has an unpatched (on npm) prototype-pollution/ReDoS vulnerability in exactly the code path this app exercises — parsing untrusted, user-supplied files. `read-excel-file` was used instead. See `NOTICE.md` for details.
- Run `npm audit` before deploying. As of this build: **0 vulnerabilities affecting the production bundle** (`npm audit --omit=dev`). The only finding in a full audit is a moderate advisory in `esbuild`/`vite`'s **dev server** (arbitrary requests accepted by `npm run dev`), which doesn't ship in the built static output.

- **Editing is built without `innerHTML`.** Formatted text is turned into DOM nodes with `createElement`/`createTextNode` and back into Markdown when you leave a block. Links are restricted to `http`, `https`, `mailto`, `tel` and relative/anchor addresses (`javascript:`, `data:` and other schemes are refused when you add one and dropped when a file is opened), and pasted content is reduced to plain text.
- **Syntax-highlighter output is rebuilt, not inserted.** highlight.js returns HTML; it is parsed with `DOMParser` (inert) and copied into new nodes keeping only text and `span` elements with highlight classes, so nothing in a code block can become a live element. Checked by typing `<script>` and `<img onerror>` into a code block: it stays text.

## Privacy

File contents never leave the browser. No upload endpoint exists in this codebase — parsing, classification, editing, and markdown generation all run client-side in JavaScript.

## Roadmap

- [ ] PDF table reconstruction from column-aligned text without manual region selection
- [ ] Image extraction (DOCX/PDF/EPUB) + `.zip` export with `/images` folder
- [ ] `.doc`/`.xls` (legacy binary) support
- [ ] RTF, LaTeX, Org-mode, reStructuredText readers (deferred — see licensing/quality bar in NOTICE.md before adding)
- [x] Rich inline formatting (mixed bold/italic runs, links, code, strike, highlight, sub/superscript)
- [x] Drag-to-reorder blocks
- [x] Export options: front matter, heading offset
- [ ] Inline formatting from ODT/PDF/XLSX; links and emphasis inside table cells
- [ ] Accessibility audit, phone-width layout, browsers other than Chrome
