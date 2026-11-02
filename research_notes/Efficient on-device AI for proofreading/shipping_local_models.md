# Shipping a local model in a Chrome extension

Research date: 2026-11-03.

| Question | Finding | Source | Decision |
|---|---|---|---|
| May a store extension hold a model? | External data is allowed if it holds no logic; the policy is silent on model weights | https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements | Bundle it, so nothing is fetched at run time and "no page text leaves your device" stays simple |
| Does the offscreen document get closed? | Only the AUDIO_PLAYBACK reason has a lifetime limit | https://developer.chrome.com/docs/extensions/reference/api/offscreen | Run the model there, unload after 5 min idle |
| WASM under MV3 CSP | Needs `'wasm-unsafe-eval'` in `extension_pages` | Tested in `test/scorer-check.html` | Added |
| ONNX Runtime threads | Worker threads hit the CSP in the offscreen document | Tested here | Single thread: slower, and cooler |
| Back off when the machine is under load | Compute Pressure launched in Chrome 125; availability in offscreen documents not established | https://developer.chrome.com/docs/web-platform/compute-pressure | Not used; rests and input pauses instead |
| Chrome's Proofreader API | Docs still describe a trial, Chrome 141 to 145; no evidence it has shipped | https://developer.chrome.com/docs/ai/proofreader-api | Not used; `policy.js` would gate it if it ships |
| Harper | Apache-2.0, WASM 20.4 MB (8.4 MB gzipped); precision unmeasured, many false-positive issues | https://writewithharper.com | Not adopted; would need the same test as the scorer |

Cost of bundling: model 65 MB (about 48 MB compressed) and runtime 11 MB, so the store zip grows by roughly 55 MB. Memory
while loaded is about 164 MB of heap, for at most 5 minutes after the last question.
