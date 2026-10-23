# Third-party notices

This project is MIT-licensed (see LICENSE.md) and bundles the following
open-source dependencies. All are permissively licensed; none impose
copyleft obligations on this project.

| Package | Version | License |
|---|---|---|
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| mammoth | 1.12.3 | BSD-2-Clause |
| pdfjs-dist | 4.10.38 | Apache-2.0 |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later (used under MIT) |
| unified | 11.0.5 | MIT |
| remark-parse | 11.0.0 | MIT |
| remark-gfm | 4.0.1 | MIT |
| mdast-util-to-string | 4.0.0 | MIT |
| read-excel-file | 9.3.10 | MIT |
| highlight.js | 11.12.0 | BSD-3-Clause |

## A note on pandoc

This project's format-reader architecture (independent readers, each
targeting one shared intermediate document representation, with a single
exporter walking that representation once) was inspired by looking at how
[pandoc](https://github.com/jgm/pandoc) is structured. **No pandoc code,
binary, or npm package that bundles pandoc is included in this project.**
Pandoc is GPL-2.0-or-later; this project deliberately avoids taking any
dependency on it — including `pandoc-wasm`-style packages — so no copyleft
obligation applies here. Every format reader in `src/lib/parsers/` was
written from scratch against the relevant public file-format specification
(OOXML, ODF, RTF, CommonMark) or against the cited library's own
documentation, not against pandoc's implementation.

## A note on the XLSX reader

This project uses `read-excel-file` rather than the more widely-known
SheetJS `xlsx` package. SheetJS's npm-published build has a known
high-severity prototype-pollution/ReDoS advisory
([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9))
in exactly the code path this app exercises — parsing untrusted,
user-supplied files — and the fix was never republished to npm, only to
SheetJS's own CDN. Depending on that CDN at build time would be a real
option for some projects, but it doesn't fit this one's fully offline,
reproducible build model, so `read-excel-file` (MIT, actively maintained,
0 known vulnerabilities as of this writing) is used instead.
