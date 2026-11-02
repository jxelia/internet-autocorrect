# Chrome Web Store listing

**Name:** Internet Autocorrect

**Summary (132 max):** Quietly fixes misspellings, typos and mixed-up words on the pages you read, and marks every change.

**Category:** Productivity → Tools

**Language:** English

## Description

Typos are everywhere online, and you notice them whether you want to or not. Internet Autocorrect fixes the slips in the text you read, the way an attentive reader would, and shows you every change.

WHAT IT FIXES
• Wrong words: their/there/they're, your/you're, its/it's, then/than, could of, a apple → an apple
• Misspellings: definately, recieve, seperate
• Typos: dont → don't, the the → the

WHAT IT LEAVES ALONE
Dialect, slang, regional spelling, names, quotes, code, words being talked about, and other languages. A wrong fix is worse than a missed one, so when in doubt it does nothing.

YOU STAY IN CHARGE
• Every change is marked. Hover to see the original, and undo it with a click.
• Undo the same change twice and it never happens again.
• Turn it off for any site.
• Right-click a comment to have it fixed in full, or left exactly as written.
• See your spelling: show US, UK, Canadian or Australian spellings in your own (optional).

PRIVATE BY DESIGN
Page text stays on your computer. There are no accounts, analytics or ads. The optional AI checker uses Chrome's built-in on-device model, or your own Ollama.

Only the text you see changes. Websites and the people who wrote the text aren't affected.

## Single purpose

Corrects spelling and word slips in the text of web pages the user reads, and marks each change.

## Permission justifications

- **Host permission (all sites):** the extension's purpose is correcting text on whichever pages the user reads, so its content script must run on any site. Users can turn it off per site.
- **storage:** settings, undo choices, never-change and learned lists, and fix history, on the user's computer.
- **activeTab:** the toolbar popup shows and acts on the fixes in the current tab.
- **scripting:** puts the updated script into open tabs after an update, and registers the optional corrected-copies script only if the user turns that setting on.
- **offscreen:** runs the optional on-device AI model in an offscreen document, because a service worker can't.
- **contextMenus:** the right-click items "Fix this comment" and "Leave this comment as written".
- **Remote code:** none. All code is in the package.

## Data disclosure

- Collected: **Website content** is processed locally only and never leaves the device, so per the form's definition nothing is collected or transmitted to the developer. If asked, tick "Website content" as handled locally, and certify: not sold, not used for unrelated purposes, not used for creditworthiness.
- Privacy policy URL: needs a public address for `PRIVACY.md`.

## Screenshots

`store/screenshots/` at 1280×800.
