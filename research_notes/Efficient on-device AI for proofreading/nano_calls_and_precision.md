# Getting the most accurate proofreading from the fewest calls on Gemini Nano and small local models

Evidence labels used on every recommendation: **Measured** = a published or project number for this kind of change, usually on other models. **Inferred** = reasoning from docs or code, with no measurement found. No source published a measurement on Gemini Nano itself, so every effect size for Nano is inferred. Figures marked "computed" were worked out for these notes from the repository or by formula.

Source dates: Chrome Prompt API doc updated 21 Oct 2026 (current). The explainer README was read Nov 2026. **Older sources:** Chrome session management (Jan 2025), Proofreader API (Sep 2025), CPU blog (Oct 2025), Davis et al. (2024).

## Prompt API mechanics that affect cost

### Takeaway
The code already follows the main session advice (one base session, one clone per call). The largest unused levers are streaming with early abort, dropping the schema from the input, setting sampling explicitly on Nano, and keeping partial answers when a timeout hits. No source publishes latency, throughput or a context-window figure for Nano, so these must be measured on the user's machine.

### Cited Findings
**Availability and limits**
- The Prompt API is in Chrome 148 for the web and for extensions. Requirements are 22 GB free storage and either more than 4 GB VRAM or 16 GB RAM with 4+ cores. The model is removed if free space falls below 10 GB — [Chrome Prompt API docs, updated 21 Oct 2026](https://developer.chrome.com/docs/ai/prompt-api)
- The API is not available in Web Workers. The docs do not mention offscreen documents — [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api)
- CPU inference rolled out in Chrome 140. The only speed statement is that inference is "typically faster on devices with capable GPUs", with no figures — [Chrome blog, Oct 2025](https://developer.chrome.com/blog/gemini-nano-cpu-support)

**Sessions, clone and warm-up**
- Chrome advises a base session holding only system instructions, cloned for each task so the instructions are not re-processed. It also says not to call `create()` repeatedly with the same instructions, and to set system instructions at creation because sending them in the first prompt adds latency — [Chrome language model guide](https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model)
- "Latency grows significantly with input size, which can make the AI feature seem broken on many devices." The same guide says to pass only what the task needs — [Chrome language model guide](https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model)
- The model unloads after a period with no living sessions. Keeping one empty session alive keeps it ready — [Chrome session management, Jan 2025](https://developer.chrome.com/docs/ai/session-management)
- `ai.js` already does this: `nanoSession` caches base sessions, `nanoAsk` clones per call and destroys the clone, and `warm` loads the model outside the time limit — `ai.js` lines 119-143 in the repository.

**Structured output**
- `responseConstraint` accepts a JSON schema or a RegExp. The schema may be included in the model's input and so uses context. `measureContextUsage()` with the `responseConstraint` option measures this cost, and `omitResponseConstraintInput: true` removes it, in which case format guidance should go in the prompt — [Prompt API explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md); [Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)
- Chrome warns against strict length limits such as `maxLength` in a schema, because constrained output "can degrade into nonsensical text", and recommends truncating on the client instead — [Chrome language model guide](https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model)
- A trailing assistant message with `prefix: true` makes the model continue partial text — [Prompt API explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md)

**Sampling**
- `LanguageModel.params()` returns `defaultTopK`, `maxTopK`, `defaultTemperature` and `maxTemperature`. The docs' example values are 3, 128, 1 and 2. `topK` and `temperature` must be set together — [Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)
- Sources differ on status. Chrome's docs list `topK`/`temperature` under extensions and `samplingMode` under web. The explainer calls the raw parameters deprecated but still working in extensions, and describes `samplingMode` presets from `"most-predictable"` to `"most-creative"` — [Chrome docs](https://developer.chrome.com/docs/ai/prompt-api); [explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md)
- `NANO_OPTS` in `ai.js` sets no sampling, so Nano runs at its defaults, while Ollama runs at `temperature: 0` — `ai.js` lines 87-90 and 179.

**Context, abort, streaming**
- `inputUsage`/`inputQuota` are renamed `contextUsage`/`contextWindow`. The old names are deprecated in extensions and removed on the web — [explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md)
- If input cannot fit, the call fails with `QuotaExceededError`, and initial prompts are never evicted — [explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md)
- `create()`, `clone()`, `prompt()` and `promptStreaming()` accept an `AbortSignal`. `destroy()` also aborts running work — [Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)

**Project code and project numbers**
- `timedAI` applies one 15 s limit (`AI_LIMIT_MS`) to a whole message. A `confirm` message holds every item in a paragraph (up to 2 calls each, and a repair group has up to 3 alternatives). A `proofread` message holds all choose calls plus the find call. On timeout the reply is lost, so `votes` becomes `[]` and answers already computed are discarded — `background.js` `timedAI`, `review`; `ai.js` `confirm`, `proofread`.
- Prompt sizes (computed at about 4 characters per token, an approximation): find system prompt 2,426 characters (about 600 tokens), find schema about 417 characters compact (about 100 tokens), choose system prompt 548 characters (about 140 tokens).

### Inferences
1. **Stream the find pass and abort on a watchdog.** Use `promptStreaming`, parse complete edit objects as they arrive, abort after 3 edits or a character cap, and keep what has arrived when the limit hits. Nano has no documented max-output option, so this is the only output cap available. *Expected: most timed-out find calls yield something instead of nothing, and runaway answers end early. Inferred.* It also splits time-to-first-chunk (input processing) from generation time, which shows why Nano times out.
2. **Return partial votes and apply the limit per model call.** Move the deadline into `ai.js`, or have `confirm` reply with the votes finished so far. *Expected: no finished call is thrown away; the share of calls rescued equals the current timed-out share of multi-item messages. Inferred.* This is the cheapest fix here because those calls are already paid for.
3. **Set `omitResponseConstraintInput: true`** and state the shape in the prompt. *Expected: about 100 fewer input tokens on each find call and a smaller saving on choose, which is about 12% of find input for a 200-token paragraph (computed). Only applies if Chrome does inject the schema, which the explainer says "may" happen. Inferred; confirm with one `measureContextUsage` call with and without it.*
4. **Use a RegExp constraint for choose** (`/^[12]$/`) instead of `{"answer":1}`. *Expected: output falls from about 6 tokens to 1 per call. Input dominates here, so the time saving is small. Inferred.*
5. **Set sampling explicitly on Nano.** Try `samplingMode: 'most-predictable'` if accepted, otherwise `topK: 1, temperature: 0` or the lowest allowed. At the example defaults (topK 3, temperature 1), the two-order check mixes sampling noise with order sensitivity, and eval results cannot be repeated. *Expected: repeatable evals, and two-order then tests order alone. Whether precision rises is unknown (see voting evidence below); run both. Inferred.*
6. **Drop `maxItems: 8` if the stream watchdog ships.** Chrome's warning names `maxLength`, not `maxItems`, so applying it here is an extension of the advice. The code already slices to 8. *Expected: lower risk of degraded output. Inferred, low confidence.*
7. **Log cost at startup, once:** `contextWindow`, `contextUsage` of each base session, and `measureContextUsage` for a typical prompt. *Expected: replaces the unknowns below with real numbers. Costs no model call to generate text, as far as the docs indicate.*

### Gaps
- No reliable numeric context window, tokens per second, clone cost or `responseConstraint` overhead for Nano. A search for the often-repeated figures found only anecdotes, such as sub-second answers for simple queries from [Android Authority](https://www.androidauthority.com/gemini-nano-chrome-offline-3454833), which is not usable for sizing.
- I could not find a prompt-api GitHub issue reporting clone or constraint slowness. The search did not surface the repository's issue list, so absence here is weak evidence.
- Whether aborting or destroying a clone actually stops GPU or CPU work right away, and whether a clone fully avoids re-evaluating the system prompt, is undocumented. Time both. This matters because 1.9.6 relies on cancel leaving the model usable.
- Whether offscreen documents are a supported home for sessions is not documented. The project's own traces show it works.
- Proofreader API: the docs still describe a trial in Chrome 141-145, with correction types and explanations not supported — [Chrome docs, Sep 2025](https://developer.chrome.com/docs/ai/proofreader-api). Its status as of Nov 2026 could not be confirmed.

## Prompting small models for proofreading

### Takeaway
Declarative minimal-edit prompts that list what to fix and what to leave are the best-supported approach, and the current prompt already has that shape. Better evidence-backed gains come from sending several sentences per call (measured to reduce editing) and a far shorter answer format. Few-shot results are mixed, but examples are cheap if the clone reuses them.

### Cited Findings
**Prompt wording and few-shot**
- In some settings zero-shot is about as competitive as few-shot, and several open models beat commercial ones on minimal-edit benchmarks (7 open and 3 commercial LLMs, 4 English benchmarks) — [Davis et al., ACL Findings 2024](https://arxiv.org/abs/2401.07702v2)
- Minimal-edit prompts gave the best overall results for all models tested. Detailed minimal-edit instructions gave the largest gains on punctuation and case errors, but the model stopped correcting several low-frequency categories — [Karpo & Chernodub, UNLP 2026](https://aclanthology.org/2026.unlp-1.13/) (Ukrainian, 11 commercial and 1 open model)
- The best prompt in the batching study replaces a formal error taxonomy with a plain-language list of what to correct and what to leave, limits punctuation edits to a short list, and has five rule-scoped examples, one of which requires no edit — [Karpo & Chernodub, EMNLP 2026 Findings](https://arxiv.org/html/2609.10810v1)
- Google's on-device guide says examples lengthen the prompt and raise inference time, recommends prefix caching, and advises splitting multi-step reasoning into separate chained calls when results are poor — [ML Kit prompt design guide](https://developers.google.com/ml-kit/genai/prompt/android/prompt-design?hl=ko) (Android; applied to Chrome by analogy)

**Batching**
- Sending several sentences in one input lowers the edit rate across model families. Batch sizes tested were 1, 2, 5, 15, 30, 60 and 120. Share of sentences left unedited for Qwen3-8B rose from 43.8% at B=1 to 80.7% at B=120, and for Gemini 3.1-Pro from 33.8% to 50.5% — [Karpo & Chernodub](https://arxiv.org/html/2609.10810v1)
- The only small open model tested was best at B=5, with the larger models at B=15 to 60. Qwen3-8B, BEA-2019 dev, same prompt: B=1 P 57.84, R 29.66, F0.5 48.61; B=5 P 61.15, R 30.18, F0.5 50.74. Recall did not fall — [Karpo & Chernodub](https://arxiv.org/html/2609.10810v1)
- On BEA-2019 test, Qwen3-8B went from F0.5 56.11 (vanilla zero-shot, B=1) to 68.84 (optimised prompt, B=5) — [Karpo & Chernodub](https://arxiv.org/html/2609.10810v1). This combines prompt and batching, so it is not the effect of either alone.
- Stated limits: the attention-dilution explanation "is an empirical conjecture"; large batches leave more disfluencies uncorrected; and "real-world deployment involves topical streams rather than the shuffled independent sentences used in our analysis" — [Karpo & Chernodub](https://arxiv.org/html/2609.10810v1)

**Project evidence**
- Removing the `reason` field, shortening `context` to 3-5 words and adding `maxItems` gave the same 16/19 with 0 wrong fixes and about 7% less time on gemma3:4b (237 s vs 255 s) — `CLAUDE.md`, 1.8.1 entry and eval table.
- `classify` overwrites `type` from the dictionary, so the model's `type` field is never used for the decision. `deliberate` and `confidence` are used only as blocks: `deliberate: true` and any confidence other than high both reject the edit — `policy.js` lines 479-480 and 578-586.
- `locate` needs `context` only when `original` appears more than once in the paragraph — `policy.js` lines 453-465.

### Inferences
1. **Remove `type` from `FIND_SCHEMA` and from the prompt.** *Expected: about 5 fewer tokens per edit, and no accuracy change because the value is discarded. Inferred, safe.*
2. **Change the find answer to one line per slip, `wrong -> right`, under a RegExp constraint.** One edit now costs about 105 characters (about 26-30 tokens); a line costs about 5 (computed). Ask the model to list only slips it is sure of, replacing `deliberate` and `confidence`. Keep context as an optional third column only when the word repeats, or block the edit when `locate` finds it ambiguous. *Expected: find output falls about 80% on paragraphs with edits. The 1.8.1 cut suggests little accuracy risk from dropping fields, but those self-report fields are active filters here, so eval before and after: if the fields do block bad edits, confirm calls rise. Time saving depends on how often edits are returned, so it is partly measured (project, 7% for a smaller cut) and partly inferred.*
3. **Send 3-5 short paragraphs or sentences per find call on the same page.** *Expected: on a small 8B model, precision about +3 points and recall unchanged at B=5, with up to 5 times fewer calls. Measured on Qwen3-8B on shuffled learner sentences; inferred for Nano, which is likely smaller.* Total input tokens stay nearly the same, so **this improves precision and calls more than heat**. Latency per call grows, so the time limit must grow with it, and the per-paragraph AI cache key needs splitting. Run it first on short paragraphs, where a lone sentence gives the model the least context.
4. **Add 2-3 examples to the find base session, at least one a paragraph with an apparent oddity and an empty answer.** That one is modelled on the best prompt above. *Expected: small precision gain; mixed published evidence. Cost is a longer warm-up, with no per-call cost if clones reuse the state as Chrome describes. Inferred.*
5. **Keep the leave-alone list, but expect recall loss on rare classes.** Karpo's finding that detailed instructions make models abandon low-frequency categories fits precision-over-recall, and the eval should report recall per slip class so this is visible. *Inferred.*

### Gaps
- No published study of Gemini Nano or gemma3:4b on proofreading. The smallest model with detailed results above is 8B.
- No published comparison of JSON against tagged text for GEC accuracy on small models that I could find. The token saving above is computed, the accuracy effect is unknown.
- Karpo's per-batch appendix table was not read (the fetched text ended before it), so the full P/R curve by batch size for Qwen3-8B is missing. Available at the HTML URL with an offset.

## Precision methods: two-order checks, logprobs, voting and verify-only

### Takeaway
Strict agreement is the method with published evidence: edit-level voting raised precision by 6.6 to 19 points on BEA-2019, but at 4-8 calls per paragraph. Two-order confirm is a cheap per-edit relative with no published evaluation. Ollama exposes logprobs and could score a fix in one call; the Prompt API does not expose them, so Nano stays on agreement methods.

### Cited Findings
**Voting**
- Edit-level majority voting over several samples from one model, with no training. It "outperforms both greedy and MBR decoding in most cases" and gives stable quality regardless of the instruction prompt, across nine benchmarks in seven languages — [Goto, Sakai & Watanabe, BEA 2026](https://arxiv.org/abs/2605.13624)
- Setup: k=8 candidates at temperature 1.0, 4-shot, with the threshold tuned on a dev set (most English values 6-8 of 8 on CWEB-G and BEA-2019, 1-3 on the fluency set JFLEG). Scores plateau at k≥4 on BEA-2019 and k≥8 on CWEB-G — [Goto et al.](https://arxiv.org/html/2605.13624v1)

| Model | Benchmark | Greedy P / R / F0.5 | Voting P / R / F0.5 |
|---|---|---|---|
| gemma-2-9b-it | BEA-2019 | 58.4 / 64.4 / 59.5 | 65.0 / 60.3 / 64.0 |
| Llama-3.1-8B | BEA-2019 | 52.3 / 61.6 / 54.0 | 66.9 / 51.5 / 63.1 |
| Qwen3-8B | BEA-2019 | 54.8 / 62.9 / 56.3 | 73.8 / 53.7 / 68.7 |
| gemma-2-9b-it | CWEB-G | 29.4 / 63.9 / 33.0 | 40.8 / 52.1 / 42.7 |
| Llama-3.1-8B | CWEB-G | 19.8 / 61.5 / 22.9 | 37.9 / 33.1 / 36.9 |
| Qwen3-8B | CWEB-G | 36.0 / 53.5 / 38.5 | 42.0 / 46.8 / 42.9 |

Table source: [Goto et al.](https://arxiv.org/html/2605.13624v1). JFLEG was mixed: F0.5 fell for two of three models.

**Logprobs**
- Ollama `/api/chat` accepts `logprobs` (boolean) and `top_logprobs` (integer) and returns per-token `logprob` with alternatives. The streaming event schema documents no logprobs field. `options.num_predict` caps output, and the response reports `prompt_eval_count`, `eval_count` and `prompt_eval_cached_count` — [Ollama API docs](https://docs.ollama.com/api/chat)
- The version that added logprobs is unclear: a third party says Ollama ≥0.12 — [ollama-classifier source](https://ollama-classifier.readthedocs.io/en/latest/_modules/ollama_classifier/backends/ollama.html), while another project's notes mention 0.20 — [bankml release notes](https://github.com/cryptoAGI/bankml/releases/tag/v0.4.2). Both are unofficial.
- The Prompt API explainer does not mention logprobs or token probabilities — [explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md)

**The current two-order check, from the code**
- It already exits early, so the cost per fix is 1 + P(first order passes), not always 2. A rejected fix costs 1 call. Each repair alternative costs the same, so a repair costs up to 6 — `ai.js` `confirm`; `policy.js` `alternatives`.
- The version order is fixed, with the sentence as written always shown first in the opening question — `ai.js` line 230.
- The prompt sends both full sentences, each up to about 400 characters plus the fix — `policy.js` `sentenceAround`.
- `judgeEdit` lets confirm apply only to explainable mechanisms; grammar and rewrites are blocked outright and unexplained swaps go to repair — `policy.js` lines 887-899.

### Inferences
1. **Precision per call, best guess ranking for this pipeline** (inferred, only voting has published numbers):
   (a) deterministic candidate plus model verify; (b) one-call scored choice, Ollama only; (c) two-order confirm with early exit, about 1-2 calls; (d) find twice and keep the intersection, 1 extra find call per paragraph; (e) 4-8 sample voting, too costly for heat.
2. **Do not adopt full voting on Nano.** A precision gain of about 7-19 points on BEA-2019 costs 4-8 times the generation, against a project whose reason for rest periods is heat. *Measured on 8-9B models, inferred for cost on Nano.* The useful lesson is that high thresholds did the work, near-unanimity at 6-8 of 8, which supports keeping the strict 2-of-2 rule.
3. **Reserve the second order for real-word swaps.** For a non-word with one dictionary neighbour, ask once. Decide from data: with the debug log on, trace `confirm` entries record `first` and `second`; calculate how often a first-order pass is overturned, per mechanism. If under about 5% for non-words, drop the second call for that class. *Expected: up to 50% fewer calls on accepted non-word fixes. Inferred until counted.*
4. **Ask the more rejection-prone order first.** If the model favours one position, showing the fix in the disfavoured slot first makes early exit more common, and 2-of-2 stays symmetric, so the result does not change, only the cost. *Expected: fewer second calls, sized by position bias in the same `first`/`second` data. Inferred.*
5. **Try a compact minimal-pair question.** Show the sentence once with a slot, for example `...[their|there] office...`, in place of two whole sentences. *Expected: confirm input falls by nearly half. Accuracy unknown, so it must be evaluated; a slot may lose the sentence-reading effect. Inferred.*
6. **On Ollama, try one-call scoring.** Ask for `1` or `2` with `num_predict: 1`, `logprobs: true`, `top_logprobs: 5`, and accept only above a threshold tuned on the eval set. Leave `format` off for this call, since how grammar constraints alter reported probabilities is undocumented. *Expected: 1 call replaces up to 2, and a threshold gives a tunable precision control. Inferred; needs calibration data, and raw probabilities from small models should not be trusted untuned.* Lower priority, since Nano is the release default and would not benefit.
7. **Test "find twice and intersect" only if eval shows many unstable edits.** It is the cheap analogue of voting and needs non-zero temperature. Worth it only when a paragraph averages more than about one confirm call that the intersection would remove. *Inferred.*

### Gaps
- I found no published evaluation of swapped-order pairwise checks for GEC, or of position bias in choice questions for proofreading. The search did not target order bias specifically, so literature may exist.
- No published measure of logprob calibration for edit verification; the targeted search returned nothing relevant.
- Goto's paper uses whole-sentence candidates and tuned thresholds on learner and web text, not a verify question. Transfer to a per-edit check is reasoning.
- gemma3:4b and Nano were not in that study. Whether they are as unstable as the 8-9B models is unknown.

## Reducing wasted find-pass output

### Takeaway
Discards are expected on web text: published precision for 8-9B models on the web benchmark CWEB-G is only 20-36% before voting. The project's placement rate of about 6.6% is lower still, though it also reflects the deliberate strictness of the policy gate. The best next step is to tally why edits are discarded, then stop generating output the gate will always reject.

### Cited Findings
- Project trace: about 900 find-pass edits discarded for 64 placed, 84 runs to the 45 s timeout — `CLAUDE.md`, 1.8.0 entry. This predates 1.8.1 and later prompt changes. Placed share is about 6.6% (Wilson 95% interval 5.2-8.4%, computed on 64 of 964).
- Precision on CWEB-G with greedy decoding: 19.8-36.0%; on BEA-2019 learner text: 52.3-58.4% — [Goto et al.](https://arxiv.org/html/2605.13624v1)
- `worthChecking` passes a paragraph if it has any confusable word or non-word. The confusable set excludes only a few very common words (`to, of, a, an, by, one, right, off, two`) — `policy.js` lines 607-620. The 1.4 eval saw 3 of 15 paragraphs skipped — `CLAUDE.md`.
- Chrome recommends sending only what the task needs, as latency grows with input — [Chrome language model guide](https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model)
- More input per call reduced over-editing in the batching study, which is evidence against shrinking find input to single sentences — [Karpo & Chernodub](https://arxiv.org/html/2609.10810v1)
- The user set the reading pass back on by default in 1.8.1 because the AI is there for what the rules do not know; GOALS.md §6 says the rules must not decide what the AI reads — `CLAUDE.md`, 1.8.0 and 1.8.1 entries.
- No reports exist in `~/Downloads/internet-autocorrect-reports/` at present (0 files, counted for these notes), and the debug log is off by default since 1.8.2 — `CLAUDE.md`. So the 900 cannot be broken down by reason from current data.

### Inferences
1. **First, tally the discards.** Turn on Keep a debug log for a few days of normal reading, then count `kind: 'ai'` entries by `verdict`, `why` and `mechanism`. Every option below depends on the split. *Costs no model calls beyond normal use.*
2. **Feed the top discard reasons back into the prompt as short leave-alone rules, or into output limits.** If most are "grammar or dialect", add examples of that class to the prompt, since the model cannot win those. Any edit `judgeEdit` will always block is wasted tokens. *Expected: proportional to that reason's share. Inferred until tallied.*
3. **Add a cheap detection question on the same session before listing.** Clone, `append()` the paragraph or prompt it with "any clear slip? yes/no" under `/^(yes|no)$/`, and on "yes" ask for the list in the same session so the paragraph is not processed again. *Expected: paragraphs that answer "no" cost one token of output rather than a list. Most paragraphs should have no slips, so this may cut find generation substantially. If the model says "yes" too often, gain vanishes, and recall may drop on "no". Inferred; no published detect-then-correct measurement found for small LLMs.*
4. **Tell the model which words the dictionary and confusion sets flagged.** Example: "Look hardest at: teh, there, were". The paragraph stays complete, so the AI still reads everything, and it respects the intent of GOALS.md §6 better than filtering paragraphs out. *Expected: fewer stray edits. Risks anchoring the model. Inferred.*
5. **A sharper option for the user to decide: verify-only for spans the gate can explain.** `judgeEdit` places real-word swaps essentially only when they have a mechanism (confusion set, keyboard neighbour, spacing, doubled word, apostrophe, form), and non-words are already known from the dictionary, so a local generator could enumerate most of what can pass. **Test:** of the placed edits in a trace (64 in the 1.8.0 one), how many would the generator have flagged? If nearly all, open find adds little beyond confirm calls, and the AI's reading could be limited to rarer cases. This pushes against GOALS.md §6 and the user's 1.8.1 decision, so it is their call. *Expected: find output could fall by most of its volume. Inferred; the coverage count settles it.*
6. **Keep paragraph-level input for find and sentence-level for confirm.** Do not reduce find to sentences. *Support: batching evidence, measured on other models, on sentence groups rather than paragraphs. Inferred for this use.*

### Gaps
- No published data on context length against accuracy for single-word verify questions on small models.
- CWEB-G being website text is from my own background knowledge of its origin (Flachs et al. 2020), not from a source read for these notes.
- The 900/64 figure mixes causes, and the trace predates the 1.8.1 prompt, the 15 s limit and 1.9.6's `timedAI`, so the current rate may differ.

## Evaluating with little data

### Takeaway
The 25-case eval cannot detect the error rates that matter: 0 wrong fixes on 25 still allows up to 13%. A cheap large clean set solves this, because only the edits that fire need checking by hand. The eval should report useful fixes per call and per token, and Nano needs its own harness, since gemma3:4b at temperature 0 does not stand in for it.

### Cited Findings
- Wald and CLT-based intervals behave poorly on LLM evals below a few hundred points, and Wilson intervals have better coverage at small samples — [position paper, 2025](https://arxiv.org/pdf/2503.01747); [Estimating Uncertainty in Classifier Performance](https://arxiv.org/pdf/2606.26422)
- Report false alarms and detection of injected errors together, since a judge can look conservative just by missing errors; the source tests with one error injected into provably correct text — [Reducto engineering blog](https://reducto.ai/engineering/posts/llm-judges-table-ocr-false-positives/) (vendor blog, method only)
- F0.5 weights precision more heavily and is standard for GEC — [Tomassen thesis](https://theses.liacs.nl/pdf/2023-2024-TomassenFloris.pdf); used in [Goto et al.](https://arxiv.org/html/2605.13624v1)
- LLM-generated errors resemble human errors more closely than rule-based or probabilistic ones — [To Err Is Human, but Llamas Can Learn It Too](https://arxiv.org/pdf/2403.05493). Training on synthetic-only data has its own risks, depending on noise strength — [Synthetic Alone](https://arxiv.org/html/2306.14377v1)
- `test/ai-eval.cjs` has 25 cases, runs Ollama only, and reports paragraphs right, wrong fixes, missed slips, time and skips, but not calls or tokens. Its wrong/missed count compares words by position, so an edit that changes word count (*could of* style or spacing) shifts every later word — `test/ai-eval.cjs`.
- Project eval: 237 s for 19 cases on gemma3:4b, about 12.5 s a paragraph (computed) — `CLAUDE.md` eval table.

**Wilson 95% intervals (computed):**

| Observed | Interval | Meaning |
|---|---|---|
| 0 wrong in 19 | 0-16.8% | Current table row |
| 0 wrong in 25 | 0-13.3% | Current case count |
| 0 wrong in 100 | 0-3.7% | |
| 0 wrong in 300 | 0-1.3% | A usable gate |
| 1 wrong in 100 | 0.2-5.4% | |
| 16 right in 19 | 62.4-94.5% | The 1.8.1 result |
| 45 right in 50 | 78.6-95.7% | |

### Inferences
1. **Three sets, kept separate.** *Effect on decisions: can detect a wrong-fix rate near 1%, which the current set cannot. Computed bound; set design inferred.*
   - **Clean set, 300+ paragraphs.** Taken from the saved Reddit dumps and other real threads. Do not label them all: run the pipeline and hand-check only edits that fire. This also estimates true precision from real text, at very low labelling cost.
   - **Injected recall set, 100-200 slips.** Inject into clean text using the project's own confusion sets, keyboard map, dropped apostrophes and dropped -ed. Report recall per class. Synthetic recall is optimistic or skewed compared to human slips, so use it for comparing versions, not as a real-world claim.
   - **Protected set, about 50 hand-picked.** Dialect, eye dialect, mentions, names, regional spellings, and the casebook in GOALS.md. Any wrong fix here is a failure. Add every real report here.
2. **Add per-run cost metrics.** Calls, input tokens, output tokens (Ollama reports `prompt_eval_count`, `eval_count`), timeouts, **useful fixes per 100 calls**, **wrong fixes per 1,000 paragraphs**, and F0.5. On Nano, use `contextUsage` before and after a call and elapsed time. *Effect: makes the objective of this research measurable; every recommendation above is scored by it.*
3. **Regression gate.** Protected set: no wrong fixes. Clean set: wrong fixes must not rise, compared paired by paragraph using discordant cases (exact sign test, for example). Recall set: no drop beyond a set margin per class. Report Wilson intervals, and do not call a change better on 19-25 cases unless it wins by a wide margin.
4. **Fix the eval's word-position counter.** Align with the `restoredEdits` alignment in `policy.js`, or compare edit spans, so counts are not distorted. *Inferred from reading the script.*
5. **Build a Nano harness.** `CLAUDE.md` lists scripting a Nano eval as future work. A page inside the unpacked extension can run real `ai.js` with `LanguageModel`, load the three sets, and save JSON for the user to hand back. Repeat each run about 3 times unless sampling is set to most predictable, because Nano's default sampling varies between runs. Time and heat are fair to measure there too. *A 300-paragraph gemma3:4b run takes about 1 hour at the current rate (computed), so run overnight or sample per change, and stop Ollama afterwards as the project guide requires.*
6. **Tune any threshold on a separate dev split.** Voting thresholds in Goto et al. were tuned on dev sets; the same applies to logprob thresholds here. With small data, tuning and reporting on the same cases overstates precision.

### Ranked changes to try, in order
| # | Change | Expected effect | Basis |
|---|---|---|---|
| 1 | Keep partial votes and per-call deadlines | Finished calls stop being discarded | Inferred, from the code |
| 2 | Eval cost metrics, 300-paragraph clean set, Nano harness | Can detect about 1% wrong-fix rate and score all changes | Computed bound |
| 3 | Tally discard reasons with the log on | Directs 6-9 below | Project data, to be collected |
| 4 | Stream find, abort early, keep partial edits | Fewer empty timeouts, diagnoses Nano's slowness | Inferred |
| 5 | Remove `type`, then test the short line format | Up to about 80% less find output per edit | Computed; project saw 7% time from a smaller cut |
| 6 | Set Nano sampling and omit schema from input | Repeatable runs, about 100 fewer input tokens per find | Docs; effect inferred |
| 7 | Second-order call only where data shows it matters | Up to 50% fewer calls on those fixes | Inferred until counted |
| 8 | Batch 3-5 short paragraphs per find call | About +3 precision points on an 8B model, recall flat, up to 5x fewer calls, little heat saving | Measured on Qwen3-8B, inferred for Nano |
| 9 | Yes/no detection before listing, same session | Large saving if most paragraphs answer no | Inferred |
| 10 | Verify-only for spans the gate can explain | Most find output gone | Inferred; user decision against GOALS.md §6 |
| Not advised | 4-8 sample voting | About 7-19 precision points at 4-8x cost | Measured on 8-9B models; cost rules it out for heat |

### Gaps
- I found no published guidance on minimum sample sizes for on-device proofreading evals. The sizes above follow from the interval maths alone.
- One search result said probabilistic context-free synthetic errors cover fewer error types and lower GEC recall, but it could not be tied to a specific paper, so that claim is left out of the findings.
- The exact sign test, positional-count bug effect and the injection design are my own reasoning, not taken from a source.
