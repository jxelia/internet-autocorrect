# Internet Autocorrect

A Chrome extension that fixes misspellings and mixed-up words in the pages you **read** (forums, comments, articles),
and marks every change.

| Colour | Category | Examples |
|---|---|---|
| Blue | Wrong word (picked using the words around it) | their/there/they're, your/you're, its/it's, then/than, could of, a apple → an apple, fastly → fast, on a weekly bases → basis |
| Red | Misspelling | definately, recieve, seperate, alot |
| Amber | Typo | dont → don't, the the → the |
| Teal | Your spelling (off unless you pick a region) | canceled → cancelled, color → colour for UK readers |

It leaves deliberate language alone: dialect, eye dialect, regional spelling, slang, quotes, names, code, words being
talked about, and paragraphs in other languages. A wrong fix is worse than a missed one, so when in doubt it does nothing.
The full rules are in [POLICY.md](POLICY.md).

## How it decides
Every proposed change answers three questions: *how* could the writer have slipped (a neighbouring key, a sound-alike
word, a missing apostrophe)? *How much* does it matter to the reader? Is there *evidence* it's a slip here and not a
choice? Changes no slip can explain (*they → them*, *is → its*) are never made.

1. **Rules** (instant, offline): word lists plus context checks.
2. **AI checker** (optional, on your computer, off until you turn it on): double-checks rule fixes that depend on
   meaning, asking which of two sentences is right in both orders, and reads paragraphs for what the rules missed. Built-in
   runs as you browse. Chrome on-device and Ollama read only when you ask (Check the whole page, or right-click › Fix this
   comment), since a language model running on its own heats the computer.
   - **Built-in**: a small model that comes with the extension (65 MB). It compares the two words in place, so it finds
     real words used by mistake (*their/there*, *loose/lose*), and checks that the nearest word fits a misspelling's place
     (*probaby*). Works in any browser, no download.
   - **Chrome on-device**: Gemini Nano, built into Chrome 138+ on desktop. One-time model download.
   - **Ollama app**: any model you run with [Ollama](https://ollama.com), e.g. `ollama pull gemma3:4b`.
     If it says "refused", start Ollama with `OLLAMA_ORIGINS=chrome-extension://*`.
3. **Learning**: a spelling fix the AI finds 3 times (and you never undo) becomes an instant rule. You can teach fixes
   yourself, and add Wikipedia's list of ~4,000 common misspellings.

## Using it
- Hover a marked word: **Detailed card** (what changed, why, Undo, Never change this) or **Word only** (the original,
  crossed out, floats above the fixed word; click to undo, press and hold to never change it).
- Marks: underline, thin squiggle above, or none.
- Right-click a comment: **Fix this comment** asks the AI to correct it, however broken; **Leave this comment as
  written** takes back every change in it. Either choice is remembered.
- Undo is remembered across reloads. Undo the same change in two places and it goes on the never-change list.
- Casual spellings (*dont, ive, would of, alot*): left alone in casual writing by default; Settings can change that.
- Your spelling: Settings → *Your spelling* shows other regions' correct spellings in yours.
- Copying: selected text carries the fixes. Settings → *Copying* extends that to sites' own Copy buttons (off by default).
- Backup and restore: Settings → *Back up or restore…*. Restoring adds to what you have without removing anything.

## Privacy
Page text stays on your computer. No accounts, analytics or ads. Details: [PRIVACY.md](PRIVACY.md).

## Install from source
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension and reload any open tabs.

`./package.sh` builds the store zip in `dist/`. Tests and notes are in [CLAUDE.md](CLAUDE.md).
