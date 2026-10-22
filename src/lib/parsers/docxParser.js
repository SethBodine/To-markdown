import mammoth from 'mammoth';
import { elementsToBlocks } from './htmlTreeWalker.js';

// DOCX already carries semantic style info (Word's built-in Heading 1..6,
// List Paragraph + numId, table structures). Mammoth maps most of that
// straight to clean HTML, so unlike PDF we don't need font-size clustering
// here — we just need to walk the HTML tree it produces via the shared
// htmlTreeWalker (also used by the plain-HTML and EPUB readers). Confidence
// is high (0.9) because it comes from the author's actual applied styles,
// not a guess.

export async function parseDocx(arrayBuffer) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // Keeps simple inline formatting so we can detect bold/italic runs.
      styleMap: [
        // Word's Title style: tagged so the editor can offer "Title as H1".
        "p[style-name='Title'] => p.docx-title:fresh",
        "p.Title => p.docx-title:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ],
    }
  );

  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const blocks = elementsToBlocks(doc.body, { format: 'docx', confidence: 0.9 });

  return {
    blocks,
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message),
  };
}
