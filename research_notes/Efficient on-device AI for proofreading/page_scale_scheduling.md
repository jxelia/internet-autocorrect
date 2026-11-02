# Handling very many words without lag: how Firefox's page translator schedules work

Research date: 2026-11-03. Read directly from Firefox's source:
https://searchfox.org/mozilla-central/source/toolkit/components/translations/content/translations-document.sys.mjs

## What it does

| Firefox | What it means | In the project (1.11.0) |
|---|---|---|
| In-viewport and beyond-viewport zones, watched by IntersectionObserver | Work is ranked by where the text is, not by when it was found | `screenIo`, `onScreen`, `priorityOf` |
| Requests cancelled when text scrolls far away, the tab hides, or the text mutates | No answer is computed for text nobody will read as it was | `iac:cancel`, `takeBack`, cancelled jobs requeue |
| Scroll direction decides what comes next | Text the reader is moving towards first | `scrollDir`, `belowView` |
| Anti-starvation stack | Far items still run now and then under constant scrolling | `pickScanJob`, `STARVE_EVERY` 4 |
| Lazy mode and "content-eager" mode | On-demand by default, whole page when asked | Popup: Check the whole page, `checkWholePage` |

## What it doesn't solve

It schedules a slow model. It says nothing about main-thread cost: that had to be measured on this project's own code.

## Measured here

5000 paragraphs, `test/lag.html`, quiet machine: 2094 slices, median 2.9 ms, longest 9 ms, none over 16 ms. The largest
cost found was unrelated to scheduling: stray text directly in `<body>` made one "paragraph" of the whole page (72 ms at
3000 paragraphs, growing with page size).
