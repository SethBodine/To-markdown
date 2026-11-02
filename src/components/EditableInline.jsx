import { useEffect, useLayoutEffect, useRef } from 'react';
import { buildInlineDom, domToMarkdown } from '../lib/inlineMarkdown.js';

// One editable run of formatted text. React renders an *empty* element and the content is built
// into it directly (see the layout effect), so React never has to reconcile DOM the browser edited
// underneath it. Typing is turned back into Markdown when you pause for a moment or leave the
// block, which is what makes Undo step back through your typing in sensible pieces.

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

// Whether the moving end of the selection (the caret, or the end you are dragging with Shift) is
// on the first or last line of the block.
function caretLineEdge(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.focusNode || !el.contains(sel.focusNode)) return { first: false, last: false };
  const range = document.createRange();
  range.setStart(sel.focusNode, sel.focusOffset);
  range.collapse(true);
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

const IDLE_COMMIT_MS = 900;

export default function EditableInline({
  source, tag: Tag = 'div', className = '', style, placeholder, focus,
  onCommit, onSplit, onMergeBack, onNavigate, onTab, onExtend, onHistory,
}) {
  const ref = useRef(null);
  const built = useRef(false);
  const idle = useRef(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Compared without surrounding spaces: a trailing space you have just typed is not a reason to rebuild.
    if (!built.current || domToMarkdown(el).trim() !== source.trim()) {
      el.replaceChildren(buildInlineDom(source));
      built.current = true;
      if (document.activeElement === el) placeCaret(el, 'end'); // keep typing where you were
    }
  }, [source, Tag]);

  useEffect(() => {
    if (focus && ref.current) placeCaret(ref.current, focus.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce]);

  useEffect(() => () => clearTimeout(idle.current), []);

  const commit = () => {
    clearTimeout(idle.current);
    const el = ref.current;
    if (!el || !onCommit) return;
    const md = domToMarkdown(el).trim();
    if (md === source.replace(/\u00a0/g, ' ').trim()) return;
    onCommit(md, el.textContent.replace(/\u00a0/g, ' ').trim());
  };

  const handleKeyDown = (e) => {
    const el = ref.current;
    if (e.nativeEvent.isComposing) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('tomd-link')); // the editor opens the right link panel
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y') && onHistory) {
      e.preventDefault();
      commit(); // anything typed since the last pause becomes one step first, so Undo can take it back
      onHistory(k === 'y' || e.shiftKey ? 'redo' : 'undo');
      // If undoing lands on exactly the state the app already holds, React sees no change and does
      // not redraw, which would leave the text you just typed on screen. Re-sync the text ourselves.
      setTimeout(() => {
        const node = ref.current;
        if (node && domToMarkdown(node).trim() !== sourceRef.current.trim()) {
          node.replaceChildren(buildInlineDom(sourceRef.current));
          placeCaret(node, 'end');
        }
      }, 0);
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
      clearTimeout(idle.current);
      onSplit(domToMarkdown(el).trim(), domToMarkdown(frag).trim());
      return;
    }
    if (e.key === 'Backspace' && onMergeBack && caretAtStart(el)) {
      e.preventDefault();
      clearTimeout(idle.current);
      onMergeBack(domToMarkdown(el).trim());
      return;
    }
    if (e.key === 'Tab' && onTab) {
      e.preventDefault();
      onTab(e.shiftKey ? -1 : 1);
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && onExtend) {
      // Shift+Up/Down: past the first or last line, it extends the selection to the next block.
      const edge = caretLineEdge(el);
      const atEdge = e.key === 'ArrowUp' ? edge.first : edge.last;
      if (onExtend(e.key === 'ArrowUp' ? 'up' : 'down', atEdge)) e.preventDefault();
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
        clearTimeout(idle.current);
        idle.current = setTimeout(commit, IDLE_COMMIT_MS);
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
