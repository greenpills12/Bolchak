// Markdown + LaTeX renderer for chat bubbles (marked + KaTeX, bundled locally).
// Math is lifted out before Markdown parsing so `_`, `*`, `\\` inside LaTeX survive.
function renderMarkdown(src) {
  const math = [];
  const keep = (tex, display) => `\uE000M${math.push({ tex, display }) - 1}\uE000`;
  // Protect code (fenced + inline) from math extraction.
  const code = [];
  let s = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => `\uE000C${code.push(m) - 1}\uE000`);
  s = s
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => pre + keep(t, false));
  s = s.replace(/\uE000C(\d+)\uE000/g, (_, i) => code[i]);
  let html = marked.parse(s, { gfm: true, breaks: false });
  html = html.replace(/\uE000M(\d+)\uE000/g, (_, i) => {
    const { tex, display } = math[i];
    try { return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }); }
    catch { return display ? `$$${tex}$$` : `$${tex}$`; }
  });
  // Neutralise anything active in model output.
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('script,iframe,object,embed,style').forEach((n) => n.remove());
  t.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => {
    if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
  }));
  t.content.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  return t.innerHTML;
}
