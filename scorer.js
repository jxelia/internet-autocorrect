/*
 * Internet Autocorrect — built-in checker. Runs in the offscreen document, on one CPU thread: a small masked-word model
 * (quantised DistilBERT, 65 MB, in the package) that scores how well a word fits its sentence. It answers one narrow
 * question, "does this word or that one fit here?", in about a tenth of a second, the same way every time.
 * Loaded on first use and let go when idle. Thresholds and what may be asked: policy.js (POLICY.md §0).
 */
'use strict';

const IAC_Scorer = (() => {
  const CLS = 101, SEP = 102, MASK = 103, UNK = 100;
  const CONTEXT = 40; // tokens kept either side
  const UNLOAD_MS = 5 * 60000;
  let vocab = null, session = null, loading = null, unloadTimer = null;

  // ---------------------------------------------------------------- tokeniser (BERT uncased: lower case, no accents,
  // punctuation split off, then longest known pieces)
  const PUNCT = /[\p{P}\p{S}]/u;
  function tokens(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[\u0000-\u001f\u007f]/g, ' ');
    const out = [];
    for (const word of clean.split(/\s+/)) {
      let run = '';
      for (const ch of word) {
        if (PUNCT.test(ch)) { if (run) out.push(run); out.push(ch); run = ''; } else run += ch;
      }
      if (run) out.push(run);
    }
    return out;
  }
  function encode(text, vocabulary = vocab) {
    const ids = [];
    for (const t of tokens(text)) {
      if (t.length > 100) { ids.push(UNK); continue; }
      const pieces = [];
      let start = 0, bad = false;
      while (start < t.length) {
        let end = t.length, id;
        for (; end > start; end--) {
          id = vocabulary.get((start ? '##' : '') + t.slice(start, end));
          if (id !== undefined) break;
        }
        if (end === start) { bad = true; break; }
        pieces.push(id);
        start = end;
      }
      if (bad) ids.push(UNK); else ids.push(...pieces);
    }
    return ids;
  }

  // ---------------------------------------------------------------- model
  async function load(base) {
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(unload, UNLOAD_MS);
    if (session) return;
    loading ??= (async () => {
      ort.env.wasm.numThreads = 1; // no worker threads: the extension's security policy doesn't allow them
      ort.env.wasm.wasmPaths = base + 'vendor/ort/';
      if (!vocab) {
        const words = (await (await fetch(base + 'model/vocab.txt')).text()).split('\n');
        vocab = new Map(words.map((w, i) => [w, i]));
      }
      session = await ort.InferenceSession.create(base + 'model/distilbert-int8.onnx', { executionProviders: ['wasm'] });
    })().finally(() => { loading = null; });
    await loading;
  }
  function unload() {
    session?.release?.();
    session = null;
  }

  // Log-probabilities at each row's position, for looking up token ids.
  async function logprobs(seqs, positions) {
    const len = Math.max(...seqs.map((s) => s.length));
    const a = new BigInt64Array(seqs.length * len), m = new BigInt64Array(seqs.length * len);
    seqs.forEach((s, r) => s.forEach((v, c) => { a[r * len + c] = BigInt(v); m[r * len + c] = 1n; }));
    const dims = [seqs.length, len];
    const out = await session.run({ input_ids: new ort.Tensor('int64', a, dims), attention_mask: new ort.Tensor('int64', m, dims) });
    const l = out.logits.data, V = out.logits.dims[2];
    return positions.map((p, r) => {
      const row = l.subarray((r * len + p) * V, (r * len + p + 1) * V);
      let mx = -Infinity;
      for (const x of row) if (x > mx) mx = x;
      let sum = 0;
      for (const x of row) sum += Math.exp(x - mx);
      const norm = mx + Math.log(sum);
      return (id) => row[id] - norm;
    });
  }

  // How well the word and the two tokens either side fit, each masked in turn. Same neighbours for both versions, so
  // the totals compare even when one version is more tokens (their / they're).
  async function fit(pre, word, suf) {
    const seq = [CLS, ...pre, ...word, ...suf, SEP];
    const a = 1 + pre.length, b = a + word.length, pos = [];
    for (let p = Math.max(1, a - 2); p < Math.min(seq.length - 1, b + 2); p++) pos.push(p);
    const rows = await logprobs(pos.map((p) => { const s = [...seq]; s[p] = MASK; return s; }), pos);
    return pos.reduce((sum, p, i) => sum + rows[i](seq[p]), 0);
  }

  // item: { pre, a, b, suf, gate? } -> how much better a fits than b (log odds), or null if a quick look (the masked
  // word alone) already shows a isn't ahead by gate and only a clear win is wanted.
  async function score(item) {
    const pre = encode(item.pre).slice(-CONTEXT), suf = encode(item.suf).slice(0, CONTEXT);
    const A = encode(item.a), B = encode(item.b);
    if (item.gate !== undefined && A.length === 1 && B.length === 1) {
      const [f] = await logprobs([[CLS, ...pre, MASK, ...suf, SEP]], [1 + pre.length]);
      if (f(A[0]) - f(B[0]) < item.gate) return null;
    }
    return (await fit(pre, A, suf)) - (await fit(pre, B, suf));
  }

  async function scoreAll(items, base) {
    await load(base);
    const out = [];
    for (const item of items) out.push(await score(item));
    return out;
  }

  return { scoreAll, encode, tokens };
})();

if (typeof module !== 'undefined') module.exports = IAC_Scorer;
