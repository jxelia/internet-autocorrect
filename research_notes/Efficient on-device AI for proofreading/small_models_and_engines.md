# Small on-device models and non-LLM engines for high-precision English proofreading in a browser

Research date: 2026-11-03. "Measured" means a number from a named test (paper table, project's own eval, or a size I read directly from npm or Hugging Face on this date). "Claim" means a project or vendor statement without a reproducible method. Older sources are flagged with their year.

## Ranked shortlist per job

This section answers the stated objective. Every number is sourced in the question sections below. **The ranking is my judgement, not a published result:** no source tests these engines against each other on the project's kind of text.

### choose (which of two sentences is right, for a confusable word)

| Rank | Engine | Size | Speed | Measured accuracy | Licence |
|---|---|---|---|---|---|
| 1 | Pruned 3-gram tables for the project's pairs, using LanguageTool's method and per-pair factors | Unknown; must be built. The full data is 8 GB or more | Likely a table lookup; not measured | LanguageTool: p about 0.99 to 1.00, r 0.22 to 0.81 on the pairs read, full data, synthetic errors | LanguageTool's confusion list is LGPL-2.1; n-gram data licence not stated in its docs |
| 2 | Quantised DistilBERT as a masked scorer (test under way separately) | 67.7 MB | About 90 ms per short inference, one M3 thread (user's figure) | None found for confusion sets; the separate test decides | Not confirmed here; the Hugging Face card lists none |
| 3 | Small neural confusion classifier, LanguageTool-style | About 83 MiB + 12 KB per pair (2017, German) | Not reported | Precision kept above 99%, but recall worse than 3-grams at the same precision | Not checked |
| 4 | Gemini Nano, two-order (current) | Model size not found; Chrome needs 22 GB free | Project logs show many timeouts on Nano | No published precision | Chrome built-in; terms not checked |
| 5 | gemma3:4b via Ollama, power users (current) | Not a browser model | About 8 s per paragraph (M3) | Project eval: 16/19 right, 0 wrong fixes, all jobs together | Gemma terms |

### find (slips the rules missed)

| Rank | Engine | Size | Speed | Measured accuracy | Licence |
|---|---|---|---|---|---|
| 1 | Harper as a candidate source, filtered by `judgeEdit` | 20.4 MB WASM (8.4 MB gzipped) | Claim: milliseconds per document | No precision measured anywhere; 401 issues mention "false positive" | Apache-2.0 |
| 2 | Gemini Nano find pass (current), or Proofreader API if it ships | As above | As above | No published precision | Chrome built-in |
| 3 | GECToR-style tagger, roberta-base int8, with a high KEEP threshold | About 123 MB | 101 ms per sentence (unspecified CPU, ONNX, quantisation not stated); the 6 ms claim is doubtful | P 0.607, R 0.334 on CoNLL-2014 noalt (kotoshu's own run) | **Blocked for now:** see licence notes below |
| 4 | T5-efficient-tiny ONNX | About 33 MB or more, int8 | Not reported | **None published** | MIT card; training data terms unchecked |
| 5 | Gemma 3 270M or SmolLM2-135M | 273 to 323 MB; 137 to 182 MB | 41.7 to 136.8 tok/s (M4 Pro, 270M, project claims) | **None found.** Not advised until tested | Gemma terms; Apache-2.0 |

### confirm (accept a proposed fix only if two orderings agree)

| Rank | Engine | Size | Speed | Measured accuracy | Licence |
|---|---|---|---|---|---|
| 1 | Masked or whole-sentence scorer plus a tuned ratio threshold, if the separate DistilBERT test passes | 67.7 MB | About 90 ms per short inference | Pending. Note a deterministic scorer gives the same answer in both orders, so two-order agreement adds nothing; the threshold does the work | As above |
| 2 | Gemini Nano, two-order (current) | As above | Project sets a 15 s limit | No published precision | Chrome built-in |
| 3 | Llama 3.2 1B or Gemma 3 1B on WebGPU, opt-in | 0.81 GB (q4_k_m) or about 1 GB | About 52 tok/s (Llama, M3, Chrome); 59.8 tok/s (Gemma, M4 Pro, claim) | **None found** for this job | Llama and Gemma custom terms |

**Licence notes.** Most GEC-trained weights rest on research-only corpora. Kotoshu is CC-BY-NC-SA, gotutiyan's checkpoint says non-commercial only, and letheviet's MIT label sits on top of that checkpoint. Rebuilding on clean data would be needed before any public release.

## Real-word error and confusion-set detection: masked language models vs n-grams vs tiny neural classifiers

### Takeaway
LanguageTool's n-gram rules are the only engine here with published per-pair precision (about 0.99 to 1.00), but they are measured on synthetic swaps and the full data is 8 GB or more. I found no published precision for masked language models on English confusion sets, so the DistilBERT test under way may be the first usable number. Per-pair ratio thresholds tuned on clean text are the best documented way to reach high precision.

### Cited Findings

**N-gram rules (LanguageTool): measured, but on synthetic errors**
- Method: compares n-gram probabilities (up to three words of context) for each word of a pair, and flags when the alternative is more probable — [LanguageTool docs](https://dev.languagetool.org/finding-errors-using-n-gram-data).
- Each pair has a factor: how much more probable the other word must be before flagging. Higher means better precision and lower recall — [confusion_sets.txt](https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en/confusion_sets.txt).
- Required bar: precision at least 0.995 for very common words and 0.99 for others. If no factor reaches that, or recall falls below 0.5, the pair may not suit the method. Factors of about 10 to 10,000,000 are typical — [LanguageTool, adding n-gram rules](https://dev.languagetool.org/adding-n-gram-data-rules).
- Per-pair results read from the file (evaluated on Wikipedia, Tatoeba and Enron sentences, usually about 1,000 per word, some 2,000) — [confusion_sets.txt](https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en/confusion_sets.txt):

| Pair | Factor | p | r | Evaluated |
|---|---|---|---|---|
| accept → except | 10^7 | 0.998 | 0.659 | 2022 |
| except → accept | 10^7 | 0.999 | 0.686 | 2022 |
| affect → effect | 10^7 | 0.994 | 0.470 | 2020 |
| effect → affect | 10^5 | 1.000 | 0.605 | 2020 |
| loose / lose | 10^5 | 0.996 | 0.796 | 2015 |
| where → were | 10^6 | 0.994 | 0.807 | 2020 |
| your → you | 10^7 | 0.993 | 0.717 | 2020 |
| of → if | 10^7 | 1.000 | 0.216 | 2022 |
| to → the | 7×10^11 | 0.998 | 0.300 | 2020 |

- The file has 871 lines, including comments and commented-out pairs. It derives from After the Deadline's homophone list under LGPL-2.1 — [confusion_sets.txt](https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en/confusion_sets.txt).
- Limits: both words must be single tokens, so *your/you're* cannot be handled, and it works only on pairs — [LanguageTool, adding n-gram rules](https://dev.languagetool.org/adding-n-gram-data-rules).
- Data size conflict: about 8 GB to download per the [docs](https://dev.languagetool.org/finding-errors-using-n-gram-data), roughly 16 GB per [Harper's README](https://github.com/Automattic/harper). An SSD is needed. The docs do not state a data licence, only that it comes from Google.
- A LanguageTool forum post also calls the 700-sentence Pedler real-error corpus too small — [LanguageTool forum](https://forum.languagetool.org/t/available-real-word-error-corpus/544).

**Tiny neural classifiers: old, sparse evidence**
- A 2017 LanguageTool experiment (word2vec plus a network on 5-grams, German): about 83 MiB plus 12 KB per pair, against 1.6 GB zipped of German n-grams. Rules kept above 99% precision. "Recall is worse for the same level of precision" than 3-gram rules. No numbers given — [LanguageTool forum, 2017](https://forum.languagetool.org/t/neural-network-rules/2225).
- Older supervised n-gram work reduced disambiguation error by 20-24% over the then state of the art on context-sensitive spelling and preposition selection — [Bergsma et al., IJCAI 2009](https://www.ijcai.org/Abstract/09/252). Old, and it reports error reduction, not precision.

**Masked language models: no direct evidence**
- I found no English paper reporting precision on confusion sets. Closest: BERT masked LM plus edit distance for misspellings, and a Persian paper that returns the original word when all candidates score below an adjustable threshold K — [arXiv 2101.03204](https://arxiv.org/abs/2101.03204); [arXiv 2407.17383](https://arxiv.org/pdf/2407.17383). The latter is deliberately lenient, preferring false alarms over misses: the opposite of this project's goal.
- NeuSpell (ten neural models) treats spelling as sequence labelling; BERT "performs consistently well", with 79.1% correction on BEA-60K per a secondary summary. That concerns general misspellings, not real-word errors — [NeuSpell, 2020](https://arxiv.org/pdf/2010.11085).

**Thresholds that raise precision, with measured effects**
- GECToR-style KEEP weight, on CoNLL-2014 noalt: 0.6 gives P 0.554, R 0.362; 0.9 gives P 0.607, R 0.334 — [kotoshu card](https://huggingface.co/kotoshu/grammar-en) (author's own run). The card says this axis saturates.
- Edit-level majority voting (8 samples, keep edits seen at least τ times, τ tuned on dev) raised precision on BEA-2019 by 6.6 points (Gemma 2 9B), 14.6 (Llama 3.1 8B) and 19.0 (Qwen3 8B). Recall fell — [Goto et al., 2026](https://arxiv.org/html/2605.13624).
- Ensemble majority vote of 7 models: P 83.7 on CoNLL-2014 and 87.3 on BEA-test, against 75.0 and 77.7 for GECToR-2024 alone — [Pillars of GEC, 2024](https://arxiv.org/html/2404.14914v1).

### Inferences
- LanguageTool's precision is not expected precision on real pages. The numbers come from clean text with synthetic swaps, not casual comments, so slang, dialect and deliberate usage are untested.
- Pruning is the most promising untested idea: keep only the 3-grams containing a word from the project's own pairs, and reuse LanguageTool's factors. Size is unknown until built. Most pairs involve rare words, but *to*, *of* and *your* will dominate.
- The LanguageTool file is useful even without its n-grams: its per-pair p and r show which pairs separate cleanly, and a low recall at high factor (*of → if* 0.216, *to → the* 0.300) warns which are hard.
- A masked scorer shares the *your/you're* limit if it masks one token. Scoring the whole sentence both ways avoids it, at two or more inferences a pair.
- Calibrate per pair and per direction, as LanguageTool does (*affect → effect* and *effect → affect* use different factors). Set the threshold on clean real text from the project's traces, not on swaps alone.

### Gaps
- No head-to-head of masked LM, n-gram and tiny classifier on the same English test set.
- No published size for a pruned English n-gram table.
- No study of any of these on dialect, slang or deliberate language.
- Salazar et al.'s masked language model scoring appeared only as a citation in search results; I did not read it.
- The licence of LanguageTool's n-gram data needs checking before redistribution.

## Grammatical error correction models under about 100 to 300 MB

### Takeaway
ONNX and browser builds exist, but almost none of the small ones publish English scores, and the ones that do are tied to research-only training data. The one small model with a card score is kotoshu's: P 0.607, R 0.334 at about 123 MB, under a non-commercial share-alike licence. All benchmark precision falls sharply on native web text, which is the project's domain.

### Cited Findings

**Published scores (single models; P / R / F0.5)**

| System | Params | CoNLL-2014 test | BEA test | Source |
|---|---|---|---|---|
| GECToR-2024 (RoBERTa-large) | about 300M | 75.0 / 44.7 / 66.0 | 77.7 / 59.0 / 73.1 | [Pillars, 2024](https://arxiv.org/html/2404.14914v1) |
| EditScorer | not stated | 78.5 / 39.4 / 65.5 | 81.0 / 56.1 / 74.4 | [Pillars, 2024](https://arxiv.org/html/2404.14914v1) |
| T5-11B | 11B | 70.9 / 56.5 / 67.5 | 73.2 / 71.2 / 72.8 | [Pillars, 2024](https://arxiv.org/html/2404.14914v1) |
| Gemma 2 9B, fine-tuned | 9B | 75.74 / 51.47 / 69.24 | 79.87 / 68.90 / 77.41 | [Staruch et al., 2025](https://arxiv.org/html/2506.13148) |
| Gemma 2 27B, fine-tuned | 27B | 77.38 / 47.88 / 68.89 | 82.28 / 67.03 / 78.70 | [Staruch et al., 2025](https://arxiv.org/html/2506.13148) |
| kotoshu v0.3.0 (roberta-base, int8), noalt | about 123 MB | 60.7 / 33.4 / 52.2 | not reported | [kotoshu card](https://huggingface.co/kotoshu/grammar-en) |
| LanguageTool 6.6 free, same run | n/a | 30.5 / 6.0 / 16.8 | not reported | [kotoshu card](https://huggingface.co/kotoshu/grammar-en) |
| T5-small (Unbabel) | 242 MB fp32 | F0.5 60.70 only, card's citation of the paper | not reported | [Unbabel card](https://huggingface.co/Unbabel/gec-t5_small) |

- Original GECToR (2020): F0.5 72.4 single and 73.6 ensemble on BEA-2019 test — [GECToR paper](https://arxiv.org/pdf/2005.12592).
- The kotoshu card lists published GECToR at about 0.61 / 0.51 / 0.56 under its noalt scoring, which differs from Pillars' 75.0 / 44.7 / 66.0. The scoring setups differ, so **do not compare noalt numbers with the table's other rows** — [kotoshu card](https://huggingface.co/kotoshu/grammar-en).

**Web text is far harder**
- CWEB, website text by English speakers of mixed skill, has far fewer errors than learner essays and challenges state-of-the-art systems — [Flachs et al., 2020](https://aclanthology.org/2020.emnlp-main.680/).
- On CWEB-G test with greedy decoding: Gemma 2 9B P 29.4, Llama 3.1 8B P 19.8, Qwen3 8B P 36.0. With voting: 40.8, 37.9 and 42.0. The same models score P 52 to 58 greedy on BEA-2019 — [Goto et al., 2026](https://arxiv.org/html/2605.13624).

**Browser-ready builds and their sizes (read from Hugging Face on 2026-11-03)**

| Model | Files | Licence | English score |
|---|---|---|---|
| [kotoshu/grammar-en](https://huggingface.co/kotoshu/grammar-en) | 128.8 MB int8 file (card says 122.8 MB), plus labels and vocab | **CC-BY-NC-SA-4.0**; training data listed as largely research-only | see above |
| [letheviet/gector-roberta-base-5k-onnx](https://huggingface.co/letheviet/gector-roberta-base-5k-onnx) | model size not stated; runtime footprint 80 to 150 MB | MIT on the export, but the source checkpoint says "[Only non-commercial purposes](https://huggingface.co/gotutiyan/gector-roberta-base-5k)" | none |
| [visheratin/t5-efficient-tiny-grammar-correction](https://huggingface.co/visheratin/t5-efficient-tiny-grammar-correction) | encoder int8 11.5 MB + init decoder int8 21.0 MB (a further decoder file may be needed) | MIT; trained on C4_200M with random typos; browser demo exists | **none published** |
| [onnx-community/grammar-synthesis-small-ONNX](https://huggingface.co/onnx-community/grammar-synthesis-small-ONNX) | [source model](https://huggingface.co/pszemraj/grammar-synthesis-small) 308 MB | dual-listed CC-BY-NC-SA and Apache-2.0; card says beta | none |
| [Unbabel/gec-t5_small](https://huggingface.co/Unbabel/gec-t5_small) | 242 MB fp32, no ONNX in the top files | Apache-2.0; tagged clang-8 data | F0.5 60.70 (card) |
| [grammarly/coedit-large](https://huggingface.co/grammarly/coedit-large) | 3.1 GB, 770M params | CC-BY-NC-4.0 | too large and non-commercial |
| [itzune/gector-eus-onnx](https://huggingface.co/itzune/gector-eus-onnx) | 83 MB int4 | Basque, not English | proves in-browser int4 GECToR works; F0.5 77.6 on its own Basque set for [v2](https://huggingface.co/itzune/gector-eus-v2-onnx) |

**Speed**
- letheviet ONNX: about 101 ms per sentence vs about 282 ms PyTorch on one thread; CPU not named — [card](https://huggingface.co/letheviet/gector-roberta-base-5k-onnx).
- kotoshu: about 6 ms per sentence on a "laptop CPU" through onnxruntime, no hardware given — [card](https://huggingface.co/kotoshu/grammar-en).
- GECToR decoding is iterative: kotoshu uses 4 rounds, and gotutiyan's example `n_iteration=5` with `keep_confidence` and `min_error_prob` knobs — [gotutiyan card](https://huggingface.co/gotutiyan/gector-roberta-base-5k).

**Licence chain**
- Kotoshu's card lists cLang-8, W&I+LOCNESS, NUCLE, FCE as research-only, and c4_200m as "research use", with only CoEdIT as Apache-2.0 — [kotoshu card](https://huggingface.co/kotoshu/grammar-en).

### Inferences
- Treat kotoshu's 6 ms as doubtful. The same architecture takes 101 ms elsewhere, and a smaller DistilBERT takes about 90 ms on one M3 thread (user's figure). Possibly native multithreaded, possibly very short sentences. Unverified.
- A rule-free tagger is unlikely to clear the project's bar on its own: P about 0.6 to 0.78 on learner benchmarks, and likely lower on web text. Use it only as a candidate source behind `judgeEdit`.
- Learner-trained models fix what the project must leave alone (agreement, tense, articles). A filtered tagger could keep only `$REPLACE` spelling and confusable labels; no one has published that.
- Precision gains from thresholding look bounded (0.554 to 0.607 across a wide range), but only in one card.
- A permissive-data retrain (C4_200M, CoEdIT or synthetic errors) is the only clean route to redistribution. The C4_200M terms need checking; kotoshu's card calls it research use.
- Distribution can be separated from the extension: an optional download at first use. Licence still applies.

### Gaps
- No published BEA or CoNLL precision for any under-100 MB model with permissive licence.
- No evaluation of int8 vs fp32 GECToR precision.
- No small model evaluated on CWEB.
- I could not read the small-model sizes for the `TonyRaju/*-onnx-int8` builds; they are low-download community exports with unknown testing.
- Mobile-focused systems (95 MB) surfaced in a search summary, but I could not trace the primary source, so I am not relying on them.

## Harper (Automattic)

### Takeaway
Harper is small (20 MB WASM, about 8.4 MB gzipped), Apache-2.0 and actively released (v3.0.0, 27 October 2026), and its API returns spans and suggestions per rule, so it fits as a candidate source. It has no published precision, 401 issues mention false positives, and its prescriptive rules would need the project's guards.

### Cited Findings
- Licence and activity: Apache-2.0; 17.4k stars, 843 open issues; English only — [GitHub](https://github.com/Automattic/harper).
- npm `harper.js` v3.0.0, published 2026-10-27 — [npm registry](https://registry.npmjs.org/harper.js/latest).
- Sizes I measured from the v3.0.0 tarball on 2026-11-03: tarball 37.4 MB, unpacked 94.8 MB; `harper_wasm_bg.wasm` 20.40 MB (8.40 MB gzip -9); `harper_wasm_slim_bg.wasm` 20.10 MB (8.29 MB gzip -9). The inlined JS builds are about 27 MB, so ship one WASM only — [npm package](https://www.npmjs.com/package/harper.js).
- Claims from its README: under 1/50th of LanguageTool's memory; lints in milliseconds; long lint times are treated as bugs — [GitHub](https://github.com/Automattic/harper). Not independently measured.
- Design: `harper-core` tokenises, parses and lints; `Linter`s query the document or use a `PatternLinter`; `harper.js` wraps the WASM — [architecture docs](https://writewithharper.com/docs/contributors/architecture).
- Repo contents via the GitHub API: `harper-core/src/linting` has 375 entries; `dictionary.dict` reports 792,634 bytes; `harper-brill` holds `trained_tagger_model.json` and `trained_chunker_model.json`; `harper-pos-utils` holds tagger and chunker code. So rules sit on a curated dictionary plus trained Brill-style tagging and chunking — [repo](https://github.com/Automattic/harper/tree/master/harper-core).
- API: `lint(text, options)` gives `Lint[]`; `organizedLints` groups them by source rule; `applySuggestion`; `setLintConfig` per rule; `setDialect` (default American); `ignoreLint` with context hashes; `isLikelyEnglish` is called proof of concept. `WorkerLinter` runs in a web worker; `LocalLinter` can block the event loop — [linting docs](https://writewithharper.com/docs/harperjs/linting).
- Exports: `Lint`, `Suggestion`, `SuggestionKind`, `Span` (start and end character indices), `Dialect`, `LintKind`, and Weirpack helpers — [API reference](https://writewithharper.com/docs/harperjs/ref/harper.js.html). The page mentions no confidence or severity field.
- Suggestions come from `lint.suggestions()` and `get_replacement_text()` — [Node docs](https://writewithharper.com/docs/harperjs/node).
- False positives: GitHub search on 2026-11-03 gives 401 issues containing "false positive", 172 open. Recent titles: "Grammar they/them false positive" (#4521), "False positive: en masse" (#4434), "Themself false positive" (#4269), "Determiner before noun false positive" (#4244) — [issues](https://github.com/Automattic/harper/issues?q=%22false+positive%22).
- Reviews are anecdotal: two false positives in one sentence on brand names — [It's FOSS](https://itsfoss.com/harper-grammar-checker/); fewer rules than LanguageTool, in a commenter's opinion — [Lemmy](https://lemmy.imagisphe.re/post/1581549/4338010).

### Inferences
- Pipeline fit: run `organizedLints`, then pass each suggestion through `splitEdit` → `classify` → `locate` → `judgeEdit`, like any spellchecker suggestion. Rule names enable an allowlist, so grammar and style rules stay off by default. Per-rule trace data would show which earn their place.
- Precision is unmeasured for the project's domain. The issue titles (*they/them*, *themself*) touch exactly what POLICY.md protects. Start with an allowlist of mechanical rules and test on the project's clean real text.
- No confidence field is exposed, so any threshold must come from per-rule precision the project measures itself.
- Bundling adds about 20 MB unpacked and needs `'wasm-unsafe-eval'` in the MV3 CSP for WASM. That CSP detail is from my own knowledge and needs checking. A worker in the offscreen document is the natural place.
- Slim and full WASM barely differ in size, so slim saves little.
- Issue counts include old and fixed items and reflect wide use. They are a warning, not a rate.

### Gaps
- No precision or false-alarm rate published; I found no independent test against LanguageTool.
- Per-rule breakdown of false positive issues not computed.
- Slim build's feature differences not checked.

## Small browser LLMs: quality vs Gemini Nano, size, speed

### Takeaway
No source tests sub-2B browser LLMs on proofreading, and all published GEC numbers for open LLMs start at 7B or 8B. Zero-shot precision is weak (42.9 for Llama-2 7B) and fine-tuning helps a lot (75.5), so an untuned 270M to 1B model should be assumed unsafe until tested. On M-series GPUs, 1B models reach about 50 to 60 tok/s.

### Cited Findings

**Quality (none below 7B)**
- Llama-2-7B: zero-shot P 42.9, fine-tuned P 75.5 on CoNLL-2014; GPT-4 zero-shot P 59.0 — [Pillars, 2024](https://arxiv.org/html/2404.14914v1).
- Qwen3-8B with optimised prompts, BEA-2019 test: P 72.14, R 58.21, F0.5 68.84; Gemini 3.1-Pro: P 82.29, R 65.66, F0.5 78.32 — [arXiv 2609.10810](https://arxiv.org/html/2609.10810).
- Larger batches reduce overcorrection: unedited sentences for Qwen3-8B rise from 43.8% at batch 1 to 80.7% at batch 120, with precision generally up and recall down. Authors call the mechanism an unconfirmed conjecture — [same paper](https://arxiv.org/html/2609.10810).
- A minimal-edit instruction typically boosts precision; Claude Sonnet 4.5 had F0.5 67.05 on CoNLL-2014 in a 7-LLM zero-shot test. Search summary only; the PDF text could not be read — [BEA 2026](https://aclanthology.org/2026.bea-1.17.pdf).
- Project's own eval, gemma3:4b via Ollama, v1.8.1: 16/19 exactly right, 0 wrong fixes, 4 missed slips, 237 s — `CLAUDE.md`. A small test, with the deterministic guards included, so not comparable with the table above.

**Size (read from Hugging Face on 2026-11-03)**

| Model | Build | Size | Licence |
|---|---|---|---|
| [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) | int8 / q4 | 137 MB / 182 MB | Apache-2.0 |
| [Gemma 3 270M](https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX) | q4f16 / q4 / int8 | 273 MB / 323 MB / 545 MB (+20 MB tokenizer) | Gemma terms |
| Gemma 3 1B | [Q8](https://github.com/svenflow/webgpu-gemma) | about 1 GB download, about 1.5 GB GPU memory | Gemma terms |
| [Llama 3.2 1B](https://arxiv.org/html/2605.20706) | q2_k / q4_k_m / q8_0 / f16 | 0.58 / 0.81 / 1.32 / 2.48 GB | Llama terms |
| [Phi-4-mini](https://huggingface.co/onnx-community/Phi-4-mini-instruct-ONNX) | most builds | about 2 GB or more | not listed on the ONNX card |

**Speed**
- Llama 3.2 1B q4_k_m, M3: about 52 tok/s Chrome vs about 1 tok/s Firefox — [LlamaWeb, arXiv 2605.20706](https://arxiv.org/html/2605.20706).
- Gemma 3 270M, M4 Pro, Chrome 134: gemma-webgpu Q8 136.8 tok/s, 0.11 s to first token; Transformers.js q4 41.7 tok/s, 0.51 s. Gemma 3 1B: 59.8 tok/s, and Transformers.js q4 crashes. These are the project's own claims — [webgpu-gemma](https://github.com/svenflow/webgpu-gemma).
- MediaPipe in-browser with Gemma 3 1B took "several minutes" even for short text in one write-up, on an unnamed machine — [Zenn](https://zenn.dev/shiba_hiro/articles/gemma-3-browser-react). Anecdotal.
- LlamaWeb reports higher average decode than WebLLM and Transformers.js across four GPUs, with lower prefill. Peak memory is 49% below WebLLM and 41% below Transformers.js by geometric mean; Transformers.js grew to about 10 GB in Safari before the tab was killed — [same paper](https://arxiv.org/html/2605.20706).

**Gemini Nano**
- I found no published precision for Nano or the Prompt API on any GEC benchmark.
- Project trace (v1.9.6): 15 timeouts to 2 answers on the reading pass before the warm-loading fix — `CLAUDE.md`. That mainly reflects model reloading, not Nano's raw speed.

### Inferences
- The project's two-sentence job needs only about 1 output token per order, so prefill speed and time to first token matter more than generation speed. LlamaWeb's weaker prefill matters here, and published tok/s overstates the benefit.
- Gemma 3 270M is the only browser LLM near the size budget that is fast, but it has no GEC evidence. SmolLM2-135M is smaller and Apache-2.0, and also untested. Both should enter only through the existing eval.
- A 270M model at 300 MB is over four times the size of DistilBERT and gives no calibrated score unless logprobs are exposed. Whether a scorer beats it on choose is the question for the test.
- Sampling and voting (k=8) would cost 8 calls a sentence, likely too hot for the project's constraints, though the pair-level two-order check is similar in spirit.

### Gaps
- No evaluation of any sub-2B model on CoNLL, BEA, JFLEG or CWEB.
- No WebLLM or MediaPipe tok/s on a named M-series chip for these small models.
- No Gemma 3 Nano-class (E2B) browser number; the ONNX repo shows multi-GB files.
- Gemini Nano's download size and current model version not confirmed.
- Gemma terms should be read before bundling.

## Chrome's Proofreader API

### Takeaway
I found no evidence that it has shipped as of 3 November 2026. Chrome's docs list it as a developer trial, the origin trial window was Chrome 141 to 145 or 146, and no quality or speed data exists from Google. It returns corrected text plus spans with no labels, so it could supply candidates but would not replace `judgeEdit`.

### Cited Findings
- Status table: Proofreader "Developer trial" for Web and Extensions, while the same page's body says origin trial; Prompt API stable in Chrome 138 for extensions and 148 for web — [built-in APIs](https://developer.chrome.com/docs/ai/built-in-apis). The page's "last updated" is September 2025 despite naming Chrome 148, so its date is not reliable.
- Origin trial: Chrome 141 to 145 in [docs](https://developer.chrome.com/docs/ai/proofreader-api) and the [September 2025 blog](https://developer.chrome.com/blog/proofreader-api-ot); 141 to 146 in the [Intent to Experiment](https://groups.google.com/a/chromium.org/g/blink-dev/c/Gboyyec4qmg/m/_l6n39OKBAAJ?hl=tr).
- Chrome Status API on 2026-11-03: status "Proposed", DevTrial 139, OT 141 to 146, no shipping milestone, last edit 2025-09-11 — [chromestatus API](https://chromestatus.com/api/v0/features/5164677291835392). No Intent to Ship found. The entry may simply be stale.
- API: `Proofreader.create({expectedInputLanguages, monitor})`; `proofread(text)` returns corrected text and a `corrections` array with start and end indices. `includeCorrectionTypes` and `includeCorrectionExplanation` are not supported — [docs](https://developer.chrome.com/docs/ai/proofreader-api).
- Requirements: desktop only; 22 GB free; GPU with over 4 GB VRAM, or 16 GB RAM with 4+ cores; not available in Web Workers — [docs](https://developer.chrome.com/docs/ai/proofreader-api). Flag name is `proofreader-api-for-gemini-nano` — [docs](https://developer.chrome.com/docs/ai/proofreader-api).
- Quality and speed: the docs provide none. The Intent asked origin-trial testers for feedback on quality and latency, and warned of non-determinism and different models and tuning across implementations — [Intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/Gboyyec4qmg/m/_l6n39OKBAAJ?hl=es-419).

### Inferences
- The project's existing "try when it ships" note stands. Keep `policy.js` as the gate.
- It runs on Nano, so heat is likely to be similar per paragraph, unless Google's tuning is much cheaper; unmeasured.
- It could serve find only. It does not answer choose or confirm, because it takes no pair of options.
- A dedicated model tuned for proofreading might over-correct dialect like other GEC systems do. Test on the project's dialect cases first.

### Gaps
- Live chromestatus page did not render; the API may lag. **The user could check `chrome://flags` on their current Chrome to settle availability.**
- No third-party measurement of quality or latency vs the Prompt API.
- The origin trial's fate after 145 or 146 is unknown.

## WASM vs WebGPU energy and speed; quantisation effects

### Takeaway
I found no measurement of joules for browser model inference on either backend, so "per joule" cannot be ranked from published data and has to be measured with `powermetrics`. WebGPU is much faster for LLMs and larger batches, but the gap is less certain for short single inferences. Int8 cost BERT about 1.3 points of accuracy with dynamic quantisation and about 0.1 with quantisation-aware training; nothing measures the effect on precision tails or q4.

### Cited Findings

**Energy**
- No study of LLM energy in the browser turned up. Nearest: Android non-ML benchmarks where WebAssembly used less energy than JavaScript (mean 31.91 J WASM on Chrome) — [ACM, 2022](https://dl.acm.org/doi/fullHtml/10.1145/3530019.3530034); and a paper reporting the JS vs WASM gap to be negligible once WebGPU is used, methodology unconfirmed — [ASRJETS](https://asrjetsjournal.org/American_Scientific_Journal/article/download/11676/2837/27853).
- Apple Silicon: only a qualitative note of lower power and heat on GPU (MPS) than CPU at similar speed for 13B fp16, from an old third-party project — [LLaMA_MPS summary](https://www.sourcepulse.org/projects/1667298). Weak and not small-model.
- Server GPU energy work exists, but it is not applicable to browsers — [arXiv 2601.22076](https://arxiv.org/html/2601.22076v1).

**Speed**
- all-MiniLM-L6-v2 embeddings, Chrome on a Mac, batch 1: WASM 355 ms, WebGPU 49.6 ms; another (Intel Mac) run: 386 ms vs 23.8 ms. Community benchmark, not Apple Silicon — [Xenova discussions](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/7).
- Native Metal beats WebGPU by over 2× on prefill and about 50% on decode on Apple GPUs; WebGPU beats Vulkan via MoltenVK — [LlamaWeb](https://arxiv.org/html/2605.20706).
- WebGPU's bottleneck at batch 1 is per-dispatch overhead: 32 to 71 μs per dispatch on Metal, 24 to 36 μs on Vulkan. Reducing dispatches from 876 to 564 raised throughput 53% (RTX 5090, native Dawn) — [arXiv 2608.08730](https://arxiv.org/html/2608.08730).
- SitePoint claims 25 to 40 tok/s vs 2 to 5 for TinyLlama and says WebGPU loses on small fast passes. No source given, so treat as unverified — [SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/).
- Reference: DistilBERT on WASM about 90 ms on one M3 thread (user's figure).

**Quantisation**
- BERT on SST-2: baseline 92.36, QAT int8 92.24, dynamic int8 91.04 — [Q8BERT, 2019](https://arxiv.org/pdf/1910.06188). Classification accuracy, not masked ranking or precision. Older source.
- Dynamic int8 loss on BERT-like models can be reduced with tuned clipping — [IBM, EMNLP 2022](https://research.ibm.com/publications/zero-shot-dynamic-quantization-for-transformer-inference).
- Size facts for [Xenova/distilbert-base-uncased](https://huggingface.co/Xenova/distilbert-base-uncased): fp32 268 MB, fp16 134 MB, q4 123 MB, bnb4 120 MB, q4f16 72 MB, int8 68 MB. So "q4" is **not always smaller than int8**: it quantises only some ops. Same pattern for SmolLM2 (int8 137 MB, q4 182 MB). Gemma 270M reverses it (int8 545 MB, q4 323 MB).
- A correctness warning: a harness tests each dtype for Gemma 270M because of an "fp16/q4f16 WebGPU overflow bug" — [Gemma Advisor harness](https://khan-noman-gemma-advisor-spike.static.hf.space/index.html). Single source, not confirmed upstream.
- I found no published study of q4 or q4f16 effect on Gemma or SmolLM accuracy.

### Inferences
- Energy rule of thumb to test, not a finding: joules = average extra power × time. The GPU may draw more power but finish far sooner. For short DistilBERT calls, dispatch overhead and GPU wake-up could erase the gain.
- For a 90 ms WASM scorer called only on confusion candidates, per-sentence work is small and rare, so backend choice probably matters less than call count. The project's existing triage and caching are the larger levers.
- Measuring is simple: `sudo powermetrics --samplers cpu_power,gpu_power` during a fixed batch, idle subtracted, for WASM with 1 thread, WASM with 4 threads and WebGPU. Compare with a Nano batch through the Prompt API. The user runs the sudo step.
- Because q4 and q4f16 change behaviour unevenly, evaluate the exact file you ship, including the backend. Compare outputs with fp32 and look at changes in rank-order decisions, especially near the threshold.
- Precision near a high threshold may be more sensitive to quantisation than average accuracy suggests. This is unmeasured, and calibration should be done on the quantised model.

### Gaps
- No joules-per-inference data for WASM or WebGPU on Apple Silicon, for any model in this report.
- No Apple Silicon short-inference WASM vs WebGPU comparison for DistilBERT-size models.
- No quantisation effect on GEC precision, masked ranking or confusion-set accuracy.
- No energy data for Gemini Nano.
