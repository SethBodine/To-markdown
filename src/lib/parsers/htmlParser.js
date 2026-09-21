import { elementsToBlocks } from './htmlTreeWalker.js';

// A raw .html file needs no conversion step at all — just parse it and walk
// the same tree the DOCX and EPUB readers walk.

export async function parseHtml(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const bodyEl = doc.body || doc.documentElement;
  const blocks = elementsToBlocks(bodyEl, { format: 'html', confidence: 0.9 });
  return { blocks, warnings: [] };
}
