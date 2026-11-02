import mammoth from 'mammoth';
import { elementsToBlocks } from './htmlTreeWalker.js';

// DOCX already carries semantic style info (Word's built-in Heading 1..6, List Paragraph + numId,
// table structures). Mammoth maps most of that straight to clean HTML, so unlike PDF we don't
// need font-size clustering here: we walk the HTML tree it produces via the shared
// htmlTreeWalker (also used by the plain-HTML and EPUB readers).
//
// Paragraph styles mammoth does not recognise (TOC Heading, toc 1, Caption, custom styles ...)
// would otherwise be flattened to plain paragraphs. They are found from mammoth's own warnings,
// then the document is read a second time with each of those styles tagged, so every paragraph
// remembers its style and the editor can offer to map it (see StyleMapper).

const BASE_STYLE_MAP = [
  // Word's Title style: tagged so the editor can offer "Title as H1".
  "p[style-name='Title'] => p.docx-title:fresh",
  'p.Title => p.docx-title:fresh',
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

const UNKNOWN_STYLE = /^Unrecognised paragraph style: '(.*)' \(Style ID: (.*)\)$/;

export async function parseDocx(arrayBuffer) {
  let result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: BASE_STYLE_MAP });

  const styleNames = [];
  for (const m of result.messages) {
    const hit = UNKNOWN_STYLE.exec(m.message);
    if (hit && !styleNames.includes(hit[1])) styleNames.push(hit[1]);
  }
  if (styleNames.length) {
    const quote = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const tagged = styleNames.map((name, i) => `p[style-name='${quote(name)}'] => p.mdstyle-${i}:fresh`);
    result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: [...BASE_STYLE_MAP, ...tagged] });
  }

  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const blocks = elementsToBlocks(doc.body, { format: 'docx', confidence: 0.9, styleNames });

  return {
    blocks,
    // Unknown styles are handled by the mapping panel, so they are not repeated as warnings.
    warnings: result.messages
      .filter((m) => m.type === 'warning' && !UNKNOWN_STYLE.test(m.message))
      .map((m) => m.message),
  };
}
