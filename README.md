# Bolchak – AI ↔ AI Debate Extension

Chrome/Edge (Manifest V3) extension that makes **ChatGPT** and **DeepSeek** critique each other in your already-logged-in browser sessions until they agree.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
2. Open `https://chatgpt.com` and `https://chat.deepseek.com` (logged in). Put them in **separate windows** so both stay "visible" and keep streaming.
3. Click the extension icon → a chat-style side panel opens. Type a topic and press Enter.

## Use
Type a topic, pick who starts, press **Start**. Each turn the extension:
1. **Copies** the latest answer from the DOM (KaTeX/MathJax → original LaTeX `$...$` / `$$...$$`, code blocks, tables, lists kept as Markdown — no clipboard, so no symbol loss).
2. **Inserts** your optional prefix/suffix system prompts around it (`{other}` and `{marker}` placeholders).
3. **Sends** it to the other AI, waits until generation finishes, and repeats.

Stops when both AIs end consecutive replies with the consensus marker (default `[[CONSENSUS]]`), at max turns, or on **Stop**. **Export** saves the transcript as Markdown.

## If a site changes its UI
Selectors live in the `SITES` object at the top of `extension/content.js`.

## Custom elements (manual fallback)
If a button or box isn't detected, open **Custom elements** in the side panel. For each AI:
- **Paste box** – where text is inserted
- **Send btn** – button clicked to send (if missing, Enter is pressed)
- **Stop btn** – visible while the AI is generating (optional; text-stability is also used)
- **Copy from** – click any AI *reply*; the selector is generalized to match all replies, and the last one is copied

Click **Pick**, then click the element on the page (it's highlighted pink; Esc cancels). Selectors are saved and can be hand-edited. **Test** shows what is currently detected.

## How a turn works (protocol)
1. **Paste** into the AI's box, then check the box actually contains the text (up to 3 retries).
2. **Send** by clicking the button. If nothing starts, press Enter instead, alternating up to 4 tries.
3. **Wait for completion (event-driven, no fixed timeout):** the page reports back the moment a *new* reply is finished. Finished means the Stop button is gone **and** the reply's action buttons (Copy etc., settable as "Done mark") appear after it. If there are no such buttons, it waits for the page to go quiet for a few seconds ("Quiet fallback").
4. **Read** the reply as Markdown + LaTeX and relay it. A failed turn is retried once, and the latest reply is recovered if it exists.

Works with both AIs in the **same window** (each tab is brought to the front during its turn) or in **two windows**. "Safety cap" (minutes, 0 = off) is only a last resort. Open **Step log** in the panel to see exactly which step failed.

## Chat interface
The side panel works like an AI chat app. The debate appears as chat bubbles, with Markdown, LaTeX (KaTeX) and tables rendered. Each message has **Copy** and **Raw** buttons. Typing while a debate is running sends your message as a *moderator note* attached to the next relay. ⚙ holds the settings, prompts, element pickers and step log; ＋ starts a new chat; ⇩ exports the transcript.

## Copying via the site's own Copy button
When a reply finishes, the extension clicks that reply's **Copy** button. A small page hook (`hook.js`) captures the exact text the site copies (its own Markdown + LaTeX) without touching your clipboard. If there's no Copy button, it falls back to reading the page. Each bubble shows which path was used ("via Copy button" / "via page"). If the button isn't found, mark it as **Copy btn** under Custom elements.

Everything runs locally in your browser using your logged-in sessions. No server, API key, or Cloudflare Worker is needed.
