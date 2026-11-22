// Orchestrator: lives in the side panel (stays alive while panel is open).
const NAMES = { chatgpt: 'ChatGPT', deepseek: 'DeepSeek' };
const URLS = {
  chatgpt: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  deepseek: ['https://chat.deepseek.com/*'],
};
const DEFAULTS = {
  marker: '[[CONSENSUS]]',
  opening:
`You are in a structured debate with another AI ({other}). Answer the topic below thoroughly and rigorously. Your answer will be sent to {other} for critique, and you will see its critique.
Formatting: use Markdown; write ALL math in LaTeX ($...$ inline, $$...$$ display).
When, and only when, you fully agree with the other AI's latest position and nothing remains to correct, end your reply with the exact line: {marker} followed by a final concise conclusion.

TOPIC:`,
  prefix: `Below is the latest reply from {other}. Critically review it: point out errors, gaps, or weak reasoning, acknowledge what is correct, and give your improved answer.\n\n----- {other} SAID -----`,
  suffix: `----- END -----\n\nReminder: use LaTeX for math. If you fully agree and nothing remains to correct, end with the line {marker} and a final concise conclusion.`,
};

const $ = (id) => document.getElementById(id);
const fields = ['first', 'maxTurns', 'timeout', 'stable', 'opening', 'prefix', 'suffix', 'marker'];
let running = false, transcript = [];

// ---- persist settings ----
chrome.storage.local.get([...fields, 'focusTab'], (s) => {
  for (const f of fields) $(f).value = s[f] ?? DEFAULTS[f] ?? $(f).value;
  if (s.focusTab != null) $('focusTab').checked = s.focusTab;
});
$('focusTab').addEventListener('change', () => chrome.storage.local.set({ focusTab: $('focusTab').checked }));
fields.forEach((f) => $(f).addEventListener('change', () => chrome.storage.local.set({ [f]: $(f).value })));
$('reset').onclick = () => { for (const k of ['opening', 'prefix', 'suffix', 'marker']) $(k).value = DEFAULTS[k]; chrome.storage.local.set(DEFAULTS); };

// ---------- Chat UI ----------
const AV = { chatgpt: 'G', deepseek: 'D' };
let turnNo = 0, typingEl = null, lastVia = '', pendingNotes = [];
const chat = $('log');
const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };
function status(t, err) {
  if (typingEl && !err) { typingEl.querySelector('.step').textContent = t; return; }
  $('status').textContent = t || ''; $('status').className = err ? 'err' : '';
}
function addEl(cls, html) {
  $('empty')?.remove();
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html;
  chat.append(d); scrollDown(); return d;
}
function showTyping(ai) {
  hideTyping();
  typingEl = addEl(ai + ' typing', `<div class="av">${AV[ai]}</div><div class="col">
    <div class="name">${NAMES[ai]}</div><div><span class="dots"><span></span><span></span><span></span></span><span class="step"></span></div></div>`);
}
function hideTyping() { typingEl?.remove(); typingEl = null; }
function log(who, text, note) {
  transcript.push({ who, text });
  if (who === 'user') {
    const d = addEl('user', `<div class="col">${note ? `<div class="tag">${note}</div>` : ''}<div class="bubble"></div></div>`);
    d.querySelector('.col').style.display = 'flex'; d.querySelector('.col').style.flexDirection = 'column'; d.querySelector('.col').style.alignItems = 'flex-end';
    d.querySelector('.bubble').textContent = text; return;
  }
  hideTyping();
  const marker = $('marker').value.trim() || DEFAULTS.marker;
  const d = addEl(who + (text.includes(marker) ? ' agree' : ''), `<div class="av">${AV[who]}</div><div class="col">
    <div class="name">${NAMES[who]} <span class="meta">turn ${++turnNo}${lastVia ? ' · ' + lastVia : ''}</span></div>
    <div class="md"></div>
    <div class="actions"><button data-a="copy">⧉ Copy</button><button data-a="raw">{ } Raw</button></div></div>`);
  const md = d.querySelector('.md');
  md.innerHTML = renderMarkdown(text);
  d.querySelector('[data-a=copy]').onclick = (e) => { navigator.clipboard.writeText(text); e.target.textContent = '✓ Copied'; setTimeout(() => (e.target.textContent = '⧉ Copy'), 1200); };
  d.querySelector('[data-a=raw]').onclick = (e) => {
    const raw = md.classList.toggle('raw');
    if (raw) md.textContent = text; else md.innerHTML = renderMarkdown(text);
    e.target.textContent = raw ? '◎ Rendered' : '{ } Raw';
  };
}
function sysNote(t) { hideTyping(); addEl('system', t); }

const fill = (tpl, other, marker) => (tpl || '').replaceAll('{other}', NAMES[other]).replaceAll('{marker}', marker);

async function findTab(ai) {
  const tabs = await chrome.tabs.query({ url: URLS[ai] });
  if (!tabs.length) throw new Error(`No ${NAMES[ai]} tab open`);
  const tab = tabs.find((t) => t.active) || tabs[0];
  try { await chrome.tabs.sendMessage(tab.id, { type: 'ping' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['hook.js'], world: 'MAIN' }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }
  return tab.id;
}

// ---------- Turn protocol ----------
// Every step is a short message + verification, so a dropped channel or
// re-rendered page only costs one retry instead of killing the run.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function dbg(t) {
  const d = document.createElement('div'); d.className = 'dbg';
  d.textContent = new Date().toLocaleTimeString() + '  ' + t;
  $('debug').prepend(d);
}
async function msg(ai, m, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const tabId = await findTab(ai);              // re-finds + re-injects each time
      return await chrome.tabs.sendMessage(tabId, m);
    } catch (e) { dbg(`${NAMES[ai]}: ${m.type} failed (${e.message}), retry ${i + 1}`); await sleep(1500); }
  }
  throw new Error(`${NAMES[ai]} tab not responding to "${m.type}"`);
}
async function focusTab(ai) {
  if (!$('focusTab').checked) return;
  const tabId = await findTab(ai), tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function ask(ai, text, timeoutMs) {
  await focusTab(ai);
  const before = await msg(ai, { type: 'state' });
  if (!before.inputFound) throw new Error(`${NAMES[ai]}: paste box not found — set it in Custom elements`);
  if (before.generating) { dbg(`${NAMES[ai]} still generating; waiting first`); await waitIdle(ai, timeoutMs); }
  const base = await msg(ai, { type: 'state' });

  // STEP 1: insert + verify
  let ins;
  for (let i = 0; i < 3; i++) {
    ins = await msg(ai, { type: 'insert', text });
    if (ins.ok && ins.inputLen >= Math.min(20, text.trim().length)) break;
    dbg(`${NAMES[ai]}: insert not confirmed (${ins.error || 'box empty'}), retry`); await sleep(1000);
  }
  if (!ins.ok || !ins.inputLen) throw new Error(`${NAMES[ai]}: could not paste text`);
  dbg(`${NAMES[ai]}: pasted ${text.length} chars`);

  // STEP 2: send + verify that something started (box cleared / generating / new reply)
  let started = false;
  for (let i = 0; i < 4 && !started; i++) {
    await msg(ai, { type: 'send', enterOnly: i % 2 === 1 });
    for (let k = 0; k < 10 && !started; k++) {
      await sleep(500);
      const s = await msg(ai, { type: 'state' });
      started = s.generating || s.count > base.count || s.inputLen === 0;
    }
    if (!started) dbg(`${NAMES[ai]}: send not confirmed, retry (${i % 2 ? 'button' : 'Enter key'})`);
  }
  if (!started) throw new Error(`${NAMES[ai]}: message did not send — set Send btn in Custom elements`);
  dbg(`${NAMES[ai]}: sent, waiting for reply`);

  // STEP 3: event-driven — content script pushes 'replyDone' the moment it finishes.
  const tabId = await findTab(ai);
  const done = await new Promise((resolve, reject) => {
    let poll, cap;
    const finish = (v, err) => {
      chrome.runtime.onMessage.removeListener(onMsg); clearInterval(poll); clearTimeout(cap);
      err ? reject(err) : resolve(v);
    };
    const onMsg = (m, sender) => { if (m.type === 'replyDone' && sender.tab?.id === tabId) finish(m); };
    chrome.runtime.onMessage.addListener(onMsg);
    msg(ai, { type: 'watch', base, quietMs: (+$('stable').value || 3) * 1000 }).catch((e) => finish(null, e));
    // Keep-alive: if the page reloaded (watcher lost) re-arm it; also honour Stop.
    poll = setInterval(async () => {
      if (!running) return finish(null, new Error('Stopped'));
      try { await msg(ai, { type: 'watch', base, quietMs: (+$('stable').value || 3) * 1000, rearm: true }, 1); } catch {}
    }, 20000);
    if (timeoutMs > 0) cap = setTimeout(() => finish({ text: null, via: 'safety cap' }), timeoutMs);
  });
  if (done.text) { lastVia = done.via.includes('copy button') ? 'via Copy button' : 'via page'; dbg(`${NAMES[ai]}: reply complete (${done.via}), ${done.text.length} chars`); return done.text; }
  dbg(`${NAMES[ai]}: safety cap reached — reading what exists`);

  // STEP 4: read (retry, page may be re-rendering)
  for (let i = 0; i < 4; i++) {
    const r = await msg(ai, { type: 'read' });
    if (r.ok && r.text) { lastVia = r.via === 'copy button' ? 'via Copy button' : 'via page'; dbg(`${NAMES[ai]}: read ${r.text.length} chars`); return r.text; }
    dbg(`${NAMES[ai]}: read failed (${r.error}), retry`); await sleep(1500);
  }
  throw new Error(`${NAMES[ai]}: reply not found — set "Copy from" in Custom elements`);
}

// Used only if a previous reply is still generating before we paste.
async function waitIdle(ai, timeoutMs) {
  timeoutMs = timeoutMs || 600000;
  const stableMs = (+$('stable').value || 3) * 1000, t0 = Date.now();
  let last = null, since = Date.now();
  while (Date.now() - t0 < Math.max(timeoutMs, 10000)) {
    if (!running) throw new Error('Stopped');
    const s = await msg(ai, { type: 'state' });
    const sig = s.len + '|' + s.tail;
    if (sig !== last) { last = sig; since = Date.now(); }
    if (!s.generating && s.len && Date.now() - since >= stableMs) return;
    await sleep(1000);
  }
  dbg(`${NAMES[ai]}: timeout while generating — reading what exists`);
}

async function startDebate(topic) {
  running = true; transcript = []; turnNo = 0; pendingNotes = [];
  chat.innerHTML = ''; $('debug').innerHTML = ''; status('');
  $('start').hidden = true; $('stop').hidden = false;
  const marker = $('marker').value.trim() || DEFAULTS.marker;
  const maxTurns = +$('maxTurns').value || 8;
  const timeoutMs = (+$('timeout').value || 0) * 60000;
  let cur = $('first').value, other = cur === 'chatgpt' ? 'deepseek' : 'chatgpt';
  const agreed = { chatgpt: false, deepseek: false };
  log('user', topic, 'Topic');
  try {
    await findTab('chatgpt'); await findTab('deepseek');
    let message = `${fill($('opening').value, other, marker)}\n${topic}`.trim();

    for (let turn = 1; turn <= maxTurns && running; turn++) {
      showTyping(cur); status('pasting & sending…');
      let answer;
      for (let attempt = 1; ; attempt++) {
        try { answer = await ask(cur, message, timeoutMs); break; }
        catch (e) {
          if (!running || attempt >= 2) throw e;
          dbg(`Turn failed: ${e.message}. Recovering latest reply…`);
          const r = await msg(cur, { type: 'read' }).catch(() => null);
          if (r?.ok && r.text && r.text !== transcript.at(-1)?.text) { lastVia = 'recovered'; answer = r.text; break; }
          dbg('Re-sending…'); status('retrying…');
        }
      }
      if (!running) break;
      log(cur, answer);

      agreed[cur] = answer.includes(marker);
      if (agreed[cur] && agreed[other]) { sysNote(`✅ Consensus reached after ${turn} turns`); break; }

      const pre = fill($('prefix').value, cur, marker), suf = fill($('suffix').value, cur, marker);
      const notes = pendingNotes.splice(0).map((n) => `[Moderator note from the user]: ${n}`).join('\n');
      message = [pre, answer, suf, notes].filter(Boolean).join('\n\n');
      [cur, other] = [other, cur];
      if (turn === maxTurns) sysNote(`Reached max turns (${maxTurns}) without full consensus`);
    }
    if (!running) sysNote('Stopped');
  } catch (e) {
    hideTyping(); if (e.message !== 'Stopped') { sysNote('⚠ ' + e.message); status('Open ⚙ → Step log for details', true); } else sysNote('Stopped');
  } finally {
    running = false; hideTyping(); $('start').hidden = false; $('stop').hidden = true;
  }
}

function submit() {
  const t = $('topic').value.trim(); if (!t) return;
  $('topic').value = ''; autoGrow();
  if (running) { pendingNotes.push(t); log('user', t, 'Moderator — sent with next relay'); return; }
  startDebate(t);
}
$('start').onclick = submit;
$('topic').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
const autoGrow = () => { const t = $('topic'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; };
$('topic').addEventListener('input', autoGrow);
$('stop').onclick = () => { running = false; status('stopping…'); };
$('settingsBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('newChat').onclick = () => { if (running) return; transcript = []; location.reload(); };

$('export').onclick = () => {
  const md = transcript.map((m) => `## ${NAMES[m.who] || 'You'}\n\n${m.text}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  chrome.downloads ? chrome.downloads.download({ url, filename: 'bolchak-debate.md' })
    : Object.assign(document.createElement('a'), { href: url, download: 'bolchak-debate.md' }).click();
};

// ---- Custom element picker UI ----
const ROLES = { input: 'Paste box', send: 'Send btn', stop: 'Stop btn', answers: 'Reply area', copy: 'Copy btn', doneMarks: 'Done mark' };
function buildPickers() {
  const root = $('pickers'); root.innerHTML = '';
  for (const ai of ['chatgpt', 'deepseek']) {
    const box = document.createElement('div'); box.className = 'pk';
    box.innerHTML = `<b>${NAMES[ai]}</b> <button data-test="${ai}" style="float:right;margin:0;padding:2px 6px">Test</button>`;
    for (const role in ROLES) {
      const r = document.createElement('div'); r.className = 'r';
      r.innerHTML = `<span>${ROLES[role]}</span><input data-ai="${ai}" data-role="${role}" placeholder="auto">` +
        `<button data-pick="${ai}:${role}">Pick</button><button data-clear="${ai}:${role}">✕</button>`;
      box.append(r);
    }
    root.append(box);
  }
  chrome.storage.local.get(['custom_chatgpt', 'custom_deepseek'], (s) => {
    root.querySelectorAll('input').forEach((i) => (i.value = s['custom_' + i.dataset.ai]?.[i.dataset.role] || ''));
  });
}
async function saveRole(ai, role, value) {
  const key = 'custom_' + ai, cur = (await chrome.storage.local.get(key))[key] || {};
  if (value) cur[role] = value; else delete cur[role];
  await chrome.storage.local.set({ [key]: cur });
}
$('pickers').addEventListener('change', (e) => { const i = e.target; if (i.dataset.role) saveRole(i.dataset.ai, i.dataset.role, i.value.trim()); });
$('pickers').addEventListener('click', async (e) => {
  const b = e.target;
  try {
    if (b.dataset.clear) { const [ai, role] = b.dataset.clear.split(':'); await saveRole(ai, role, ''); buildPickers(); }
    if (b.dataset.pick) {
      const [ai, role] = b.dataset.pick.split(':');
      const tabId = await findTab(ai);
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tabId, { active: true });
      status(`Click the ${ROLES[role]} in the ${NAMES[ai]} tab (Esc cancels)…`);
      const r = await chrome.tabs.sendMessage(tabId, { type: 'pick', role });
      status(r.ok ? `Saved ${NAMES[ai]} ${ROLES[role]}: ${r.selector} (matches ${r.count})` : 'Pick cancelled.');
      buildPickers();
    }
    if (b.dataset.test) {
      const r = await chrome.tabs.sendMessage(await findTab(b.dataset.test), { type: 'test' });
      status(`${NAMES[b.dataset.test]}: paste box ${r.input ? '✓' : '✗'}, send ${r.send ? '✓' : '✗'}, stop ${r.stop ? '✓ (generating)' : '– (idle)'}, replies found: ${r.answers}`);
    }
  } catch (err) { status('Error: ' + err.message); }
});
buildPickers();
