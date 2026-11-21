# Bolchak – AI ↔ AI Debate Extension

Chrome/Edge (Manifest V3) extension that makes **ChatGPT** and **DeepSeek** critique each other in your already-logged-in browser sessions until they agree.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
2. Open `https://chatgpt.com` and `https://chat.deepseek.com` (logged in). Put them in **separate windows** so both stay "visible" and keep streaming.
3. Click the extension icon → side panel opens.

## Use
Type a topic, pick who starts, press **Start**. Each turn the extension:
1. **Copies** the latest answer from the DOM (KaTeX/MathJax → original LaTeX `$...$` / `$$...$$`, code blocks, tables, lists kept as Markdown — no clipboard, so no symbol loss).
2. **Inserts** your optional prefix/suffix system prompts around it (`{other}` and `{marker}` placeholders).
3. **Sends** it to the other AI, waits until generation finishes, and repeats.

Stops when both AIs end consecutive replies with the consensus marker (default `[[CONSENSUS]]`), at max turns, or on **Stop**. **Export** saves the transcript as Markdown.

## If a site changes its UI
Selectors live in the `SITES` object at the top of `extension/content.js`.
