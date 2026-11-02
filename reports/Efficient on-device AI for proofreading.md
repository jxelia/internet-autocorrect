# Efficient on-device AI for proofreading

*Internet Autocorrect, version 1.11.0, 3 November 2026. Numbers come from tests run on this project's own code and data
unless a source is named. Working notes: `research_notes/Efficient on-device AI for proofreading/`.*

## The short answer

- **Use the smallest engine that can answer each question.** "Which of these two words fits here?" doesn't need a language model that writes. A 65 MB masked-word scorer answered it better than gemma3:4b, about 30 times faster per question.
- **Keep the larger models for what only they can do:** spelling the rules don't know, dropped letters, and restoring a broken comment.
- **Page lag is a main-thread problem, not a model problem.** All model work was already off the page. The lag came from walking the page in long tasks, and from a few expensive DOM calls.

## Which engine for which job

Same text, same policy gate. Wrong fixes are what the project cares about most.

| Job | Built-in scorer | gemma3:4b |
|---|---|---|
| Confirm a proposed fix (120 items) | **0 wrong**, 100 to 117 good kept | 5 wrong, 36 good kept |
| Veto a rule's fix: good test fixes wrongly vetoed | 2 of 80 | 3 of 80 |
| Veto a rule's fix: real fires wrongly vetoed | 0 of 112 | 0 of 112 |
| Veto a rule's fix: false fires caught | 6 of 10 | 3 of 10 |
| Time per question | about 90 ms | about 3 s |

These samples are small: 10 false fires can't separate 6 from 3 with any confidence. The firm result is the confirm job.

**Finding slips nobody proposed.** On 1,500 unseen Hacker News paragraphs (2,072 word pairs), a threshold of 10 flagged 3, all real. A threshold of 6 flagged 10, of which 2 were wrong, so the threshold stays at 10. On planted slips it finds about 64%. Of 29 sentences written to trap it, it placed 3 fixes: 2 real slips and 1 wrong (*Better late then never… misquotes it*).

**What it can't do.** It only knows confusion pairs. It doesn't replace the larger models for spelling or dropped letters, and it refuses comment restoring.

gemma3:4b with the full 1.11.0 pipeline: 21 of 25 paragraphs exactly right, 0 wrong fixes, 5 missed slips, 213 s.

## Zero lag

| 5000 paragraphs | Before | After |
|---|---|---|
| Longest timer gap at load (no extension: 214 ms) | 951 ms | 354 ms |
| Longest extension slice | not sliced to a budget | 9 ms |
| Slices over 16 ms | | 0 of 2,094 |
| Median slice | | 2.9 ms |

The gaps are the whole page including the browser's own parsing, measured on an earlier build, before the last fix below; the slices are the extension's own work on the final build.

What changed:

- **Fixes in place at load.** The script runs from `document_start` and fixes text in the same task the parser delivers it, before it paints, up to 4 ms a slice. The rest runs in 5 ms slices at background priority.
- **Nothing forces layout.** `isContentEditable` went, since it forced a style recalculation. Hover waits for the pointer to rest for 40 ms.
- **Input comes first.** Scrolling, clicks and keys pause the AI queue for 1.5 s, and late fixes wait until input is quiet.
- **The big single cost.** Stray text directly in `<body>` made one "paragraph" out of the whole page, a 72 ms task at 3,000 paragraphs. Other paragraphs' subtrees are now skipped whole.

**What can't reach literal zero.** The extension shares a thread with the page, so the honest measure is slices too short to see, under one 16 ms frame. And a fix from a model can't be there on first paint on a first visit, because no model answers that fast. Rule fixes are there at load. AI fixes on a page seen before can be, if Remember the AI's answers is on.

## Very many words

From Firefox's page translator ([source](https://searchfox.org/mozilla-central/source/toolkit/components/translations/content/translations-document.sys.mjs)), all adopted:

- Work is ranked by zone: on screen, then the direction of scroll.
- Requests are cancelled when text leaves the zone, the tab hides, or the text changes, and go back in the queue.
- Far paragraphs still get a turn every fourth job, so they can't starve.
- On demand by default, with a **Check the whole page** button for the rest.

## Looked at and not adopted

| Option | Why not |
|---|---|
| Harper (Apache-2.0, 20.4 MB WASM) | No measured precision anywhere, many false-positive reports. Worth the same test as the scorer before use. |
| Chrome's Proofreader API | No evidence it has shipped; [docs](https://developer.chrome.com/docs/ai/proofreader-api) still describe a trial. |
| Batching paragraphs into one Nano call | Saves calls, not heat. |
| Voting across several runs | Too hot for what it adds. |
| Streaming abort and explicit sampling for Nano | Can't be evaluated on Nano from a script yet. |
| Compute Pressure to back off under load | Availability in offscreen documents not established; rests and input pauses do the job for now. |

## Costs

- The store zip grows by roughly 55 MB (65 MB model, 11 MB runtime).
- About 164 MB of memory while loaded, dropped after 5 idle minutes.
- First use loads in about 0.5 s.
- The new engine is a choice in Settings; the default is unchanged.

## Decision left open

Remember the AI's answers is off by default for privacy. With it off, AI fixes can't be in place at load on a return visit either.
