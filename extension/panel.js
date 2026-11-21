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
const fields = ['topic', 'first', 'maxTurns', 'timeout', 'opening', 'prefix', 'suffix', 'marker'];
let running = false, transcript = [];

// ---- persist settings ----
chrome.storage.local.get(fields, (s) => {
  for (const f of fields) $(f).value = s[f] ?? DEFAULTS[f] ?? $(f).value;
});
fields.forEach((f) => $(f).addEventListener('change', () => chrome.storage.local.set({ [f]: $(f).value })));
$('reset').onclick = () => { for (const k of ['opening', 'prefix', 'suffix', 'marker']) $(k).value = DEFAULTS[k]; chrome.storage.local.set(DEFAULTS); };

const status = (t) => ($('status').textContent = t);
function log(who, text) {
  transcript.push({ who, text });
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.innerHTML = `<b>${NAMES[who] || who}</b>`;
  d.append(document.createTextNode(text));
  $('log').append(d); $('log').scrollTop = 1e9;
}
const fill = (tpl, other, marker) => (tpl || '').replaceAll('{other}', NAMES[other]).replaceAll('{marker}', marker);

async function findTab(ai) {
  const tabs = await chrome.tabs.query({ url: URLS[ai] });
  if (!tabs.length) throw new Error(`No ${NAMES[ai]} tab open`);
  const tab = tabs.find((t) => t.active) || tabs[0];
  try { await chrome.tabs.sendMessage(tab.id, { type: 'ping' }); }
  catch { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }
  return tab.id;
}

async function ask(tabId, text, timeoutMs) {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'ask', text, timeoutMs });
  if (!r?.ok) throw new Error(r?.error || 'No response from tab');
  return r.text;
}

$('start').onclick = async () => {
  const topic = $('topic').value.trim();
  if (!topic) return status('Enter a topic first.');
  running = true; transcript = []; $('log').innerHTML = '';
  $('start').disabled = true; $('stop').disabled = false;
  const marker = $('marker').value.trim() || DEFAULTS.marker;
  const maxTurns = +$('maxTurns').value || 8;
  const timeoutMs = (+$('timeout').value || 300) * 1000;
  let cur = $('first').value, other = cur === 'chatgpt' ? 'deepseek' : 'chatgpt';
  const agreed = { chatgpt: false, deepseek: false };

  try {
    const tabs = { chatgpt: await findTab('chatgpt'), deepseek: await findTab('deepseek') };
    log('user', topic);
    let message = `${fill($('opening').value, other, marker)}\n${topic}`.trim();

    for (let turn = 1; turn <= maxTurns && running; turn++) {
      status(`Turn ${turn}/${maxTurns}: waiting for ${NAMES[cur]}…`);
      const answer = await ask(tabs[cur], message, timeoutMs);
      if (!running) break;
      log(cur, answer);

      agreed[cur] = answer.includes(marker);
      if (agreed[cur] && agreed[other]) { status(`✅ Consensus reached after ${turn} turns.`); break; }

      // relay: prefix + answer + suffix -> other AI
      const pre = fill($('prefix').value, cur, marker), suf = fill($('suffix').value, cur, marker);
      message = [pre, answer, suf].filter(Boolean).join('\n\n');
      [cur, other] = [other, cur];
      if (turn === maxTurns) status(`Stopped: reached max turns (${maxTurns}).`);
    }
    if (!running) status('Stopped by user.');
  } catch (e) {
    status('Error: ' + e.message);
  } finally {
    running = false; $('start').disabled = false; $('stop').disabled = true;
  }
};

$('stop').onclick = () => { running = false; status('Stopping after current reply…'); };

$('export').onclick = () => {
  const md = transcript.map((m) => `## ${NAMES[m.who] || 'Topic'}\n\n${m.text}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  chrome.downloads ? chrome.downloads.download({ url, filename: 'bolchak-debate.md' })
    : Object.assign(document.createElement('a'), { href: url, download: 'bolchak-debate.md' }).click();
};

// ---- Custom element picker UI ----
const ROLES = { input: 'Paste box', send: 'Send btn', stop: 'Stop btn', answers: 'Copy from' };
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
