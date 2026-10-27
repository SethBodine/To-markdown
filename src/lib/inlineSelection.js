// Tracks the text selection inside editable blocks so the side panel can act on
// it, even after focus has moved to a panel field (for example the link URL
// box). Formatting is applied to the live DOM with execCommand (bold, italic,
// strikethrough, sub/superscript, link) or by wrapping the range (code,
// highlight); the block turns its DOM back into Markdown when editing ends.

import { useSyncExternalStore } from 'react';
import { normalizeHref, isSafeHref, domToMarkdown } from './inlineMarkdown.js';

const EMPTY = {
  hasEditor: false, hasText: false, text: '', linkCount: 0, bold: false, italic: false, strike: false,
  sub: false, sup: false, code: false, mark: false, link: false, href: '',
};
let snapshot = EMPTY;
let last = null; // { el, range }
const listeners = new Set();

function emit(next) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function editorOf(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return el && el.closest ? { el, editor: el.closest('[data-inline-editor]') } : { el: null, editor: null };
}

function compute() {
  const sel = window.getSelection();
  const active = document.activeElement;
  // Focus (or the browser's selection) sitting in the side panel, for example in the link address
  // box, is not "the person clicked away": keep the current selection context.
  const inPanelEl = (n) => {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest('.side-panel'));
  };
  const inPanel = inPanelEl(active) || (!!sel && inPanelEl(sel.anchorNode));
  const clear = () => {
    if (inPanel) return;
    last = null;
    if (snapshot !== EMPTY) emit(EMPTY);
  };
  if (!sel || !sel.rangeCount) return clear();
  const raw = sel.getRangeAt(0);
  const startEd = editorOf(raw.startContainer).editor;
  const endEd = editorOf(raw.endContainer).editor;
  const editor = startEd || endEd;
  if (!editor) return clear();
  // A selection can run past the edge of one block (a triple-click, or a drag beyond the end of
  // the line). It still belongs to that block, so clamp it to the block's own text.
  const range = raw.cloneRange();
  if (startEd !== editor) range.setStart(editor, 0);
  if (endEd !== editor) range.setEnd(editor, editor.childNodes.length);
  last = { el: editor, range };
  const q = (c) => {
    try { return document.queryCommandState(c); } catch { return false; }
  };
  const { el } = editorOf(range.commonAncestorContainer);
  const anchors = Array.from(editor.querySelectorAll('a')).filter((a) => range.intersectsNode(a));
  emit({
    hasEditor: true,
    hasText: !range.collapsed,
    text: range.toString().replace(/\s+/g, ' ').trim().slice(0, 80),
    bold: q('bold'), italic: q('italic'), strike: q('strikeThrough'),
    sub: q('subscript'), sup: q('superscript'),
    code: !!(el && el.closest('code')), mark: !!(el && el.closest('mark')),
    link: anchors.length > 0,
    linkCount: anchors.length,
    href: anchors.length ? anchors[0].getAttribute('href') || '' : '',
  });
}

export const getSelectionSnapshot = () => snapshot;

export function installSelectionTracking() {
  document.addEventListener('selectionchange', compute);
  return () => document.removeEventListener('selectionchange', compute);
}

export function useInlineSelection() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => snapshot
  );
}

function restore() {
  if (!last || !last.el.isConnected) return null;
  last.el.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  try { sel.addRange(last.range); } catch { return null; }
  return sel;
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function toggleWrap(sel, tag) {
  const range = sel.getRangeAt(0);
  const { el } = editorOf(range.commonAncestorContainer);
  const existing = el && el.closest(tag);
  if (existing && last.el.contains(existing)) {
    unwrap(existing);
    return;
  }
  const wrapper = document.createElement(tag);
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  const r = document.createRange();
  r.selectNodeContents(wrapper);
  sel.removeAllRanges();
  sel.addRange(r);
}

export function formatInline(kind) {
  const sel = restore();
  if (!sel) return false;
  if (kind === 'clear') {
    document.execCommand('removeFormat');
    const range = sel.getRangeAt(0);
    last.el.querySelectorAll('code,mark,a').forEach((n) => {
      if (range.intersectsNode(n)) unwrap(n);
    });
    compute();
    return true;
  }
  if (sel.isCollapsed) return false;
  document.execCommand('styleWithCSS', false, false);
  const cmd = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', sub: 'subscript', sup: 'superscript' }[kind];
  if (cmd) document.execCommand(cmd);
  else if (kind === 'code') toggleWrap(sel, 'code');
  else if (kind === 'mark') toggleWrap(sel, 'mark');
  compute();
  return true;
}

// Returns an error message, or null on success.
export function applyLink(rawUrl) {
  const url = normalizeHref(rawUrl);
  if (!url) return 'Enter a web address first.';
  if (!isSafeHref(url)) return 'That address type is not allowed. Use http, https, mailto or tel.';
  const sel = restore();
  if (!sel) return 'Select some text in a block first.';
  const { el } = editorOf(sel.getRangeAt(0).commonAncestorContainer);
  const existing = el && el.closest('a');
  if (existing && last.el.contains(existing)) {
    existing.setAttribute('href', url);
    existing.setAttribute('rel', 'noopener noreferrer');
    compute();
    return null;
  }
  if (sel.isCollapsed) return 'Select the text you want to turn into a link.';
  document.execCommand('createLink', false, url);
  last.el.querySelectorAll('a[href]').forEach((a) => a.setAttribute('rel', 'noopener noreferrer'));
  compute();
  return null;
}

export function removeLink() {
  const sel = restore();
  if (!sel) return false;
  const range = sel.getRangeAt(0);
  const anchors = Array.from(last.el.querySelectorAll('a')).filter((a) => range.intersectsNode(a));
  anchors.forEach(unwrap);
  compute();
  return anchors.length > 0;
}

// Change the address of every link the selection touches. Returns an error message or null.
export function setLinkHref(raw) {
  const url = normalizeHref(raw);
  if (!url) return 'Enter a web address, or use Remove link.';
  if (!isSafeHref(url)) return 'That address type is not allowed. Use http, https, mailto or tel.';
  if (!last || !last.el.isConnected) return 'Select the link text again.';
  const anchors = Array.from(last.el.querySelectorAll('a')).filter((a) => last.range.intersectsNode(a));
  if (!anchors.length) return 'Select the link text again.';
  anchors.forEach((a) => {
    a.setAttribute('href', url);
    a.setAttribute('rel', 'noopener noreferrer');
  });
  const el = last.el;
  // The block saves its text when it loses focus, so hand the change over now.
  el.focus({ preventScroll: true });
  el.blur();
  compute();
  return null;
}

// Insert brand-new linked text at the cursor (replacing any selection). False if there is no
// text box to put it in.
export function insertLinkAtCaret(label, url) {
  const sel = restore();
  if (!sel) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const host = editorOf(range.startContainer).el;
  const inside = host && host.closest('a');
  if (inside) {
    range.setStartAfter(inside); // links can't nest
    range.collapse(true);
  }
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('rel', 'noopener noreferrer');
  a.textContent = label;
  range.insertNode(a);
  const after = document.createRange();
  after.setStartAfter(a);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  compute();
  return true;
}

export function insertFootnoteRef(label) {
  const sel = restore();
  if (!sel) return false;
  const range = sel.getRangeAt(0);
  range.collapse(false);
  const sup = document.createElement('sup');
  sup.className = 'fn-ref';
  sup.setAttribute('data-fn', label);
  sup.setAttribute('contenteditable', 'false');
  sup.textContent = label;
  range.insertNode(sup);
  range.setStartAfter(sup);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  last = { el: last.el, range: range.cloneRange() };
  return true;
}

// The three parts of the block around the current text selection (as Markdown), so a change of
// type can apply to just the selected text. Null when nothing is selected.
export function splitAtSelection() {
  if (!last || !last.el.isConnected || last.range.collapsed) return null;
  const el = last.el;
  const blockEl = el.closest('[data-block-id]');
  if (!blockEl) return null;
  const range = last.range;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  const sel = domToMarkdown(range.cloneContents()).trim();
  if (!sel) return null;
  return {
    blockId: blockEl.getAttribute('data-block-id'),
    headMd: domToMarkdown(before.cloneContents()).trim(),
    selMd: sel,
    tailMd: domToMarkdown(after.cloneContents()).trim(),
  };
}
