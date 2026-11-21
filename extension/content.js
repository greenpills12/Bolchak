// Bolchak content script: runs inside ChatGPT / DeepSeek tabs.
// Three jobs: (1) insert text into the composer, (2) send it,
// (3) wait for the reply to finish and read it back as lossless Markdown + LaTeX.
(() => {
  if (window.__bolchakLoaded) return;
  window.__bolchakLoaded = true;

  // ---- Site configs. If a site changes its UI, patch selectors here. ----
  const SITES = {
    chatgpt: {
      input: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
      send: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send"]'],
      stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
      answers: '[data-message-author-role="assistant"]',
      answerBody: '.markdown',
    },
    deepseek: {
      input: ['textarea#chat-input', 'textarea'],
      send: ['div[role="button"][aria-disabled="false"]:has(svg)', 'button[type="submit"]'],
      stop: ['div[role="button"]:has(rect)', '[class*="stop"]'],
      answers: '.ds-markdown',
      answerBody: null,
      // R1 "thinking" blocks also use .ds-markdown; exclude them.
      exclude: '[class*="think"]',
    },
  };

  const site = location.hostname.includes('deepseek') ? 'deepseek' : 'chatgpt';
  const cfg = SITES[site];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (list) => { for (const s of list) { try { const el = document.querySelector(s); if (el) return el; } catch {} } return null; };
  const visible = (el) => el && el.offsetParent !== null;

  function answerNodes() {
    let nodes = [...document.querySelectorAll(cfg.answers)];
    if (cfg.exclude) nodes = nodes.filter((n) => !n.closest(cfg.exclude));
    // Drop nested matches (keep outermost)
    nodes = nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
    return nodes;
  }
  function lastAnswer() {
    const nodes = answerNodes();
    const n = nodes[nodes.length - 1];
    if (!n) return null;
    return (cfg.answerBody && n.querySelector(cfg.answerBody)) || n;
  }

  // ---------- 1. INSERT ----------
  async function insertText(text) {
    const el = q(cfg.input);
    if (!el) throw new Error('Input box not found');
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable (ProseMirror): clear, then paste so newlines/symbols survive.
      document.execCommand('selectAll');
      document.execCommand('delete');
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(300);
      if (!el.innerText.trim()) document.execCommand('insertText', false, text);
    }
    await sleep(500);
  }

  // ---------- 2. SEND ----------
  async function send() {
    for (let i = 0; i < 20; i++) {
      const btn = q(cfg.send);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); return; }
      await sleep(250);
    }
    // Fallback: press Enter in the input
    const el = q(cfg.input);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }

  // ---------- 3. WAIT + READ ----------
  async function waitForReply(prevCount, prevText, timeoutMs) {
    const start = Date.now();
    // wait for a new answer to appear
    while (Date.now() - start < timeoutMs) {
      const n = answerNodes().length;
      const t = lastAnswer()?.innerText || '';
      if (n > prevCount || (t && t !== prevText)) break;
      await sleep(500);
    }
    // wait until generation stops and text is stable for ~3s
    let last = '', stableSince = Date.now();
    while (Date.now() - start < timeoutMs) {
      const t = lastAnswer()?.innerText || '';
      const generating = visible(q(cfg.stop));
      if (t !== last) { last = t; stableSince = Date.now(); }
      if (!generating && t && Date.now() - stableSince > 3000) break;
      await sleep(700);
    }
    const node = lastAnswer();
    if (!node) throw new Error('No reply found');
    return htmlToMarkdown(node).replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- Lossless DOM -> Markdown (keeps LaTeX, code, tables) ----------
  function tex(el) {
    const a = el.querySelector('annotation[encoding="application/x-tex"]');
    return a ? a.textContent.trim() : null;
  }
  function htmlToMarkdown(root) {
    const walk = (node, ctx = {}) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      const el = node, tag = el.tagName.toLowerCase(), cls = el.className?.toString?.() || '';
      if (['button', 'svg', 'style', 'script'].includes(tag)) return '';
      // Math (KaTeX / MathJax)
      if (cls.includes('katex-display')) { const t = tex(el); if (t != null) return `\n$$\n${t}\n$$\n`; }
      if (cls.split(' ').includes('katex')) { const t = tex(el); if (t != null) return el.closest('.katex-display') ? `\n$$\n${t}\n$$\n` : `$${t}$`; }
      if (tag === 'math' && el.getAttribute('alttext')) return `$${el.getAttribute('alttext')}$`;
      if (tag === 'mjx-container') { const t = el.querySelector('annotation')?.textContent; if (t) return el.getAttribute('display') === 'true' ? `\n$$\n${t}\n$$\n` : `$${t}$`; }
      const kids = (c = ctx) => [...el.childNodes].map((n) => walk(n, c)).join('');
      switch (tag) {
        case 'pre': {
          const code = el.querySelector('code') || el;
          const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
          return `\n\`\`\`${lang}\n${code.innerText.replace(/\n$/, '')}\n\`\`\`\n`;
        }
        case 'code': return '`' + el.textContent + '`';
        case 'br': return '\n';
        case 'hr': return '\n---\n';
        case 'p': return `\n${kids()}\n`;
        case 'strong': case 'b': return `**${kids()}**`;
        case 'em': case 'i': return `*${kids()}*`;
        case 'a': return `[${kids()}](${el.href})`;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          return `\n${'#'.repeat(+tag[1])} ${kids().trim()}\n`;
        case 'blockquote': return '\n' + kids().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n';
        case 'ul': case 'ol': {
          const depth = ctx.depth || 0; let i = +(el.getAttribute('start') || 1);
          const items = [...el.children].filter((c) => c.tagName === 'LI').map((li) => {
            const bullet = tag === 'ol' ? `${i++}.` : '-';
            const body = [...li.childNodes].map((n) => walk(n, { depth: depth + 1 })).join('').trim().replace(/\n{2,}/g, '\n');
            return '  '.repeat(depth) + bullet + ' ' + body.replace(/\n/g, '\n' + '  '.repeat(depth + 1));
          });
          return '\n' + items.join('\n') + '\n';
        }
        case 'table': {
          const rows = [...el.querySelectorAll('tr')].map((tr) =>
            '| ' + [...tr.children].map((c) => walk(c).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
          if (!rows.length) return '';
          const cols = el.querySelector('tr').children.length;
          rows.splice(1, 0, '|' + ' --- |'.repeat(cols));
          return '\n' + rows.join('\n') + '\n';
        }
        default: return kids();
      }
    };
    return walk(root);
  }

  // ---------- Message handler ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'ping') { reply({ ok: true, site }); return; }
    if (msg.type === 'readLast') {
      const n = lastAnswer(); reply({ ok: !!n, text: n ? htmlToMarkdown(n).trim() : '' }); return;
    }
    if (msg.type === 'ask') {
      (async () => {
        try {
          const prevCount = answerNodes().length;
          const prevText = lastAnswer()?.innerText || '';
          await insertText(msg.text);
          await send();
          const text = await waitForReply(prevCount, prevText, msg.timeoutMs || 300000);
          reply({ ok: true, text });
        } catch (e) { reply({ ok: false, error: String(e.message || e) }); }
      })();
      return true; // async
    }
  });
})();
