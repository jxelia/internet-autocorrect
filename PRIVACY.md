# Privacy policy: Internet Autocorrect

Last updated: 3 November 2026

**Internet Autocorrect collects nothing and sends nothing to its developer or anyone else.** It has no server, accounts, analytics or ads.

- **What it reads:** the text of the pages you visit, to find and fix slips. This happens in your browser. It skips boxes you type in, password fields and code.
- **The AI checker (optional, off until you turn it on):**
  - *Built-in* uses a small model that comes inside the extension and runs on your computer. Sentences go only to that model, and nothing is downloaded.
  - *Chrome on-device* uses Gemini Nano, built into Chrome. Paragraphs go to that model on your computer. Chrome downloads the model from Google once; page text isn't part of that download.
  - *Ollama* sends paragraphs to the address you set, by default your own computer (`localhost`). If you enter another computer's address, text goes there.
- **What it stores, in Chrome's extension storage on your computer:** your settings and lists, and a history of the fixes it made with a few words around each and the page address. You can clear the history in Settings.
- **Stored only if you turn it on:** *Remember the AI's answers* (the changed words and a few around them, 30 days at most) and *Keep a debug log* (decisions with bits of the page and its address). Turning either off deletes it.
- **What syncs:** settings are kept in `chrome.storage.sync`. If Chrome sync is on, Google syncs them between your browsers under your account. That includes the never-change list and the sites you've turned it off for.
- **One optional download:** *Borrowed word lists* fetches Wikipedia's list of common misspellings from wikipedia.org when you ask for it. No page text is sent.
- **Who it shares data with:** nobody. Data is never sold or transferred.

Questions: open an issue at https://github.com/jxelia/internet-autocorrect-privacy/issues
