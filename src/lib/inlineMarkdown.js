// Inline Markdown <-> DOM.
//
// A block's visible text is stored as Markdown source in `block.md` (when it
// has any formatting) and as plain text in `block.text` (always). The editor
// turns the Markdown into real DOM nodes (<strong>, <em>, <a>, <code> ...) so
// people edit what they see, and turns the DOM back into Markdown when they
// finish. Nothing here uses innerHTML: nodes are built with createElement /
// createTextNode only, and link targets are checked against an allow-list.

const ESCAPABLE = /[!-/:-@[-`{-~]/;

const MARK = { strong: '**', em: '*', del: '~~', mark: '==', sub: '~', sup: '^' };
const KEY = {
  strong: 'strong', b: 'strong',
  em: 'em', i: 'em',
  del: 'del', s: 'del', strike: 'del',
  mark: 'mark', sub: 'sub', sup: 'sup',
};

// ---------------------------------------------------------------- escaping

export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]^~<])/g, '\\$1');
}

export function codeSpan(text) {
  const t = String(text ?? '');
  if (!t) return '';
  let longest = 0;
  for (const m of t.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(t) || (/^ .* $/.test(t) && t.trim()) ? ' ' : '';
  return fence + pad + t + pad + fence;
}

export function wrap(marker, content) {
  if (!content.trim()) return content;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  return m[1] + marker + m[2] + marker + m[3];
}

// ------------------------------------------------------------------- links

// Only web links, mail and phone links, and relative/anchor links are allowed.
// Anything with another scheme (javascript:, data:, vbscript: ...) is refused.
export function isSafeHref(href) {
  const h = String(href ?? '').trim();
  if (!h) return false;
  if (/^(https?:|mailto:|tel:)/i.test(h)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false;
  return true;
}

export function normalizeHref(input) {
  const h = String(input ?? '').trim();
  if (!h) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(h);
  if (!hasScheme && !/^[#/.?]/.test(h) && !/\s/.test(h)) {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(h)) return `mailto:${h}`;
    if (/^[^\s/]+\.[^\s/]{2,}/.test(h)) return `https://${h}`;
  }
  return h;
}

export function encodeHref(href) {
  return String(href ?? '')
    .trim()
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
}

// ----------------------------------------------------------------- parsing

function findCloseBracket(src, from) {
  let depth = 1;
  for (let j = from; j < src.length; j += 1) {
    const c = src[j];
    if (c === '\\') { j += 1; continue; }
    if (c === '`') {
      const e = src.indexOf('`', j + 1);
      if (e !== -1) { j = e; continue; }
    }
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findCloseParen(src, from) {
  let depth = 1;
  for (let j = from; j < src.length; j += 1) {
    const c = src[j];
    if (c === '\\') { j += 1; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findClose(src, from, marker) {
  const len = marker.length;
  const ch = marker[0];
  for (let j = from; j < src.length; j += 1) {
    const c = src[j];
    if (c === '\\') { j += 1; continue; }
    if (c === '`') {
      let n = 1;
      while (src[j + n] === '`') n += 1;
      const end = src.indexOf('`'.repeat(n), j + n);
      j = end !== -1 ? end + n - 1 : j + n - 1;
      continue;
    }
    if (c !== ch) continue;
    if (len === 1) {
      if (src[j + 1] === ch && (ch === '*' || ch === '~')) {
        const k = findClose(src, j + 2, ch + ch);
        if (k !== -1) { j = k + 1; continue; }
        j += 1;
        continue;
      }
      return j;
    }
    if (src.startsWith(marker, j)) {
      if (src[j + len] === ch) continue; // longer run: the closer is its last pair
      return j;
    }
  }
  return -1;
}

export function parseInline(src) {
  const nodes = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) { nodes.push({ t: 'text', v: buf }); buf = ''; }
  };
  const tryMark = (marker, type) => {
    if (!src.startsWith(marker, i)) return false;
    const close = findClose(src, i + marker.length, marker);
    if (close === -1 || close === i + marker.length) return false;
    flush();
    nodes.push({ t: type, c: parseInline(src.slice(i + marker.length, close)) });
    i = close + marker.length;
    return true;
  };
  const tryLink = () => {
    const fn = /^\[\^([^\]\s\\]+)\]/.exec(src.slice(i, i + 80));
    if (fn) {
      flush();
      nodes.push({ t: 'fn', label: fn[1] });
      i += fn[0].length;
      return true;
    }
    const cb = findCloseBracket(src, i + 1);
    if (cb === -1 || src[cb + 1] !== '(') return false;
    const cp = findCloseParen(src, cb + 2);
    if (cp === -1) return false;
    const dest = src.slice(cb + 2, cp).trim();
    const m = /^(<[^>]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'))?$/.exec(dest);
    let href = m ? m[1] : dest;
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    flush();
    nodes.push({ t: 'link', href, c: parseInline(src.slice(i + 1, cb)) });
    i = cp + 1;
    return true;
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (src[i + n] === '`') n += 1;
      const end = src.indexOf('`'.repeat(n), i + n);
      if (end !== -1) {
        let code = src.slice(i + n, end);
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        flush();
        nodes.push({ t: 'code', v: code });
        i = end + n;
        continue;
      }
    } else if (ch === '*') {
      if (tryMark('**', 'strong') || tryMark('*', 'em')) continue;
    } else if (ch === '~') {
      if (tryMark('~~', 'del') || tryMark('~', 'sub')) continue;
    } else if (ch === '=') {
      if (tryMark('==', 'mark')) continue;
    } else if (ch === '^') {
      if (tryMark('^', 'sup')) continue;
    } else if (ch === '[') {
      if (tryLink()) continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}

// -------------------------------------------------------- Markdown -> DOM

function appendNodes(parent, nodes, doc) {
  for (const n of nodes) {
    if (n.t === 'text') {
      parent.appendChild(doc.createTextNode(n.v));
    } else if (n.t === 'code') {
      const e = doc.createElement('code');
      e.textContent = n.v;
      parent.appendChild(e);
    } else if (n.t === 'fn') {
      const e = doc.createElement('sup');
      e.className = 'fn-ref';
      e.setAttribute('data-fn', n.label);
      e.setAttribute('contenteditable', 'false');
      e.textContent = n.label;
      parent.appendChild(e);
    } else if (n.t === 'link') {
      const e = doc.createElement('a');
      if (isSafeHref(n.href)) {
        e.setAttribute('href', n.href);
        e.setAttribute('rel', 'noopener noreferrer');
      }
      appendNodes(e, n.c, doc);
      parent.appendChild(e);
    } else {
      const e = doc.createElement(n.t);
      appendNodes(e, n.c, doc);
      parent.appendChild(e);
    }
  }
}

export function buildInlineDom(md, doc = document) {
  const frag = doc.createDocumentFragment();
  appendNodes(frag, parseInline(md || ''), doc);
  return frag;
}

export function mdToPlain(md, doc = document) {
  const holder = doc.createElement('div');
  holder.appendChild(buildInlineDom(md, doc));
  return holder.textContent;
}

// -------------------------------------------------------- DOM -> Markdown

function mergeKey(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return `a:${el.getAttribute('href') || ''}`;
  if (tag === 'sup' && el.hasAttribute('data-fn')) return null;
  return KEY[tag] || null;
}

// Browsers split formatting into neighbouring runs (<b>a</b><b>b</b>);
// joining them avoids "**a****b**", which Markdown would misread.
function mergeAdjacent(parent) {
  let node = parent.firstChild;
  while (node) {
    if (node.nodeType === 1) {
      const key = mergeKey(node);
      let sib = node.nextSibling;
      while (key && sib && sib.nodeType === 1 && mergeKey(sib) === key) {
        while (sib.firstChild) node.appendChild(sib.firstChild);
        const gone = sib;
        sib = sib.nextSibling;
        parent.removeChild(gone);
      }
      mergeAdjacent(node);
    }
    node = node.nextSibling;
  }
}

function ser(node, active) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      out += escapeText(n.nodeValue);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { out += ' '; continue; }
    if (tag === 'img') continue;
    if (tag === 'code') { out += codeSpan(n.textContent); continue; }
    if (tag === 'sup' && n.hasAttribute('data-fn')) {
      out += `[^${n.getAttribute('data-fn')}]`;
      continue;
    }
    if (tag === 'a') {
      const href = n.getAttribute('href');
      const inner = ser(n, active);
      out += href && isSafeHref(href) && inner.trim() ? `[${inner}](${encodeHref(href)})` : inner;
      continue;
    }
    const key = KEY[tag];
    if (key) {
      if (active.has(key)) out += ser(n, active);
      else out += wrap(MARK[key], ser(n, new Set(active).add(key)));
      continue;
    }
    const inner = ser(n, active);
    if ((tag === 'div' || tag === 'p') && out && !/\s$/.test(out)) out += ' ';
    out += inner;
  }
  return out;
}

export function domToMarkdown(root) {
  const clone = root.cloneNode(true);
  mergeAdjacent(clone);
  return ser(clone, new Set()).replace(/\u00a0/g, ' ');
}

// --------------------------------------------------------------- block glue

export function inlineSource(block) {
  return block.md != null ? block.md : escapeText(block.text);
}

// Store md only when it differs from the plain text (i.e. has real markup).
export function normalizeMd(md, plain) {
  return md === escapeText(plain) ? null : md;
}
