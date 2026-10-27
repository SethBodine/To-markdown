import { useEffect, useLayoutEffect, useRef } from 'react';
import { buildInlineDom, domToMarkdown } from '../lib/inlineMarkdown.js';

// One editable run of formatted text. React renders an *empty* element and the
// content is built into it directly (see the layout effect), so React never
// has to reconcile DOM the browser edited underneath it. The text is turned
// back into Markdown when the person leaves the block, never on every key.

export function placeCaret(el, where) {
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  if (typeof where === 'number') {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = where;
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.nodeValue.length) {
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= node.nodeValue.length;
      node = walker.nextNode();
    }
    where = 'end';
  }
  range.selectNodeContents(el);
  range.collapse(where === 'start');
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretAtStart(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return false;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString() === '';
}

function caretLineEdge(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) {
    return { first: false, last: false };
  }
  const range = sel.getRangeAt(0).cloneRange();
  const elRect = el.getBoundingClientRect();
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : null;
  if (!rect || (rect.height === 0 && rect.top === 0)) {
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(range.endContainer, range.endOffset);
    return { first: before.toString() === '', last: after.toString() === '' };
  }
  const lh = parseFloat(window.getComputedStyle(el).lineHeight) || rect.height || 16;
  return {
    first: rect.top - elRect.top < lh * 0.75,
    last: elRect.bottom - rect.bottom < lh * 0.75,
  };
}

export default function EditableInline({
  source, tag: Tag = 'div', className = '', style, placeholder, focus,
  onCommit, onSplit, onMergeBack, onNavigate, onTab,
}) {
  const ref = useRef(null);
  const built = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!built.current || domToMarkdown(el) !== source) {
      el.replaceChildren(buildInlineDom(source));
      built.current = true;
    }
  }, [source, Tag]);

  useEffect(() => {
    if (focus && ref.current) placeCaret(ref.current, focus.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce]);

  const commit = () => {
    const el = ref.current;
    if (!el || !onCommit) return;
    const md = domToMarkdown(el).trim();
    if (md === source.replace(/\u00a0/g, ' ').trim()) return;
    onCommit(md, el.textContent.replace(/\u00a0/g, ' ').trim());
  };

  const handleKeyDown = (e) => {
    const el = ref.current;
    if (e.nativeEvent.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('tomd-link')); // the editor opens the right link panel
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!onSplit) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      range.deleteContents();
      const tail = document.createRange();
      tail.selectNodeContents(el);
      tail.setStart(range.endContainer, range.endOffset);
      const frag = tail.extractContents();
      onSplit(domToMarkdown(el).trim(), domToMarkdown(frag).trim());
      return;
    }
    if (e.key === 'Backspace' && onMergeBack && caretAtStart(el)) {
      e.preventDefault();
      onMergeBack(domToMarkdown(el).trim());
      return;
    }
    if (e.key === 'Tab' && onTab) {
      e.preventDefault();
      onTab(e.shiftKey ? -1 : 1);
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onNavigate && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const edge = caretLineEdge(el);
      if (e.key === 'ArrowUp' && edge.first) { e.preventDefault(); onNavigate('up'); }
      if (e.key === 'ArrowDown' && edge.last) { e.preventDefault(); onNavigate('down'); }
    }
  };

  return (
    <Tag
      ref={ref}
      className={`block-text ${className}`.trim()}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="false"
      data-inline-editor="true"
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onInput={() => {
        if (ref.current && !ref.current.textContent) ref.current.replaceChildren();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain').replace(/\s*\n+\s*/g, ' ');
        document.execCommand('insertText', false, text);
      }}
      onClick={(e) => {
        if (e.target.closest && e.target.closest('a')) e.preventDefault();
      }}
    />
  );
}
