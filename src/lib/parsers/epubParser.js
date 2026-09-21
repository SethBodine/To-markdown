import JSZip from 'jszip';
import { makeBlock } from '../blockModel.js';
import { elementsToBlocks } from './htmlTreeWalker.js';

// EPUB is a zip of XHTML chapter files plus an OPF manifest that lists them
// in reading order (the "spine"). We follow that spine — reading chapters in
// file order would be wrong for many books — and hand each chapter's XHTML
// to the same tree-walker the plain-HTML and DOCX readers use, since EPUB
// content really is just HTML.

export async function parseEpub(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const warnings = [];

  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    throw new Error('This .epub file is missing META-INF/container.xml — it may not be a valid EPUB.');
  }

  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) {
    throw new Error('Could not find the EPUB\u2019s content manifest (.opf file).');
  }

  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) {
    throw new Error(`EPUB manifest ${opfPath} was listed but not found in the archive.`);
  }
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // manifest: id -> href; spine: ordered list of idrefs into the manifest.
  const manifest = new Map();
  for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
    manifest.set(item.getAttribute('id'), item.getAttribute('href'));
  }
  const spineIds = Array.from(opfDoc.getElementsByTagName('itemref')).map((ref) => ref.getAttribute('idref'));

  if (!spineIds.length) {
    warnings.push('This EPUB has an empty spine — no reading order could be determined.');
  }

  const blocks = [];
  let chapterNum = 0;
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const chapterPath = opfDir + href;
    const chapterXhtml = await zip.file(chapterPath)?.async('string');
    if (!chapterXhtml) {
      warnings.push(`Chapter file ${chapterPath} was listed in the spine but not found — skipped.`);
      continue;
    }
    chapterNum += 1;
    const doc = new DOMParser().parseFromString(chapterXhtml, 'text/html');
    const bodyEl = doc.body || doc.documentElement;
    const chapterBlocks = elementsToBlocks(bodyEl, { format: 'epub', confidence: 0.85 });

    if (!chapterBlocks.length) continue;
    // If the chapter didn't open with its own heading, add a synthetic one so
    // chapter boundaries survive into the markdown output.
    if (chapterBlocks[0].type !== 'heading') {
      blocks.push(
        makeBlock({
          type: 'heading',
          level: 1,
          text: `Chapter ${chapterNum}`,
          confidence: 0.3,
          source: { format: 'epub', page: null },
        })
      );
    }
    blocks.push(...chapterBlocks);
  }

  return { blocks, warnings };
}
