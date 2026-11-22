// Runs in the PAGE's JS world. Captures whatever the site's own Copy button
// copies (exact Markdown + LaTeX from the site), without needing clipboard access.
(() => {
  if (window.__bolchakHook) return; window.__bolchakHook = true;
  const post = (text) => { if (text) window.postMessage({ __bolchakCopy: String(text) }, '*'); };
  const clip = navigator.clipboard;
  if (clip) {
    const wt = clip.writeText?.bind(clip), w = clip.write?.bind(clip);
    clip.writeText = (t) => { post(t); return wt ? wt(t).catch(() => {}) : Promise.resolve(); };
    clip.write = async (items) => {
      try {
        for (const it of items) {
          if (it.types.includes('text/plain')) { post(await (await it.getType('text/plain')).text()); break; }
        }
      } catch {}
      return w ? w(items).catch(() => {}) : undefined;
    };
  }
  // execCommand('copy') path: read data after the site's handler set it.
  window.addEventListener('copy', (e) => { try { post(e.clipboardData?.getData('text/plain')); } catch {} });
})();
