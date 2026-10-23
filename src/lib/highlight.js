// Syntax highlighting for code blocks. Loaded on demand (dynamic import), so
// documents without a code block never download it.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const ALIASES = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash',
  zsh: 'bash', html: 'xml', yml: 'yaml', 'c#': 'csharp', cs: 'csharp', 'c++': 'cpp', md: 'markdown', rb: 'ruby',
  rs: 'rust', kt: 'kotlin', golang: 'go',
};

// highlight.js returns an HTML string. It is parsed with DOMParser (inert: nothing runs) and then
// rebuilt from scratch, keeping only text and <span class="hljs-..."> elements, so nothing else
// can reach the page whatever the code contains.
function rebuild(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.nodeType === 3) out.push(document.createTextNode(n.nodeValue));
    else if (n.nodeType === 1 && n.tagName === 'SPAN') {
      const span = document.createElement('span');
      const cls = n.getAttribute('class') || '';
      if (/^[\w\s-]+$/.test(cls)) span.className = cls;
      span.append(...rebuild(n.childNodes));
      out.push(span);
    }
  }
  return out;
}

export function highlightInto(pre, code, lang) {
  const key = String(lang || '').trim().toLowerCase();
  const name = ALIASES[key] || key;
  if (!hljs.getLanguage(name)) {
    pre.replaceChildren(document.createTextNode(code));
    return;
  }
  const { value } = hljs.highlight(code, { language: name, ignoreIllegals: true });
  const doc = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
  pre.replaceChildren(...rebuild(doc.body.childNodes));
}
