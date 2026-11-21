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
