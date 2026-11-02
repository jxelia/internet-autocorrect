// Minimal chrome.* stand-in so content.js / popup.js run on a plain web page for testing.
window.__iacTest = true;
(() => {
  const store = { sync: JSON.parse(new URLSearchParams(location.search).get('sync') || '{}'), local: JSON.parse(localStorage.getItem('iac-shim-local') || '{}') };
  const listeners = [];
  const area = (name) => ({
    async get(keys) {
      const src = store[name];
      if (typeof keys === 'string') return { [keys]: src[keys] };
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in src ? src[k] : d]));
      return { ...src };
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[name][k], newValue: v }; store[name][k] = v; }
      if (name === 'local') localStorage.setItem('iac-shim-local', JSON.stringify(store.local));
      listeners.forEach((fn) => fn(changes, name));
    },
  });
  const msgListeners = [];
  window.__iacSent = [];
  window.chrome = {
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: {
      id: 'shim',
      sendMessage: async (msg) => {
        window.__iacSent.push(msg);
        if (msg.type === 'iac:log') { const { log = [] } = await chrome.storage.local.get('log'); await chrome.storage.local.set({ log: [...msg.entries.reverse(), ...log] }); }
        if (msg.type === 'iac:trace') {
          const { trace = [] } = await chrome.storage.local.get('trace');
          await chrome.storage.local.set({ trace: [...trace, ...msg.entries].slice(-1500) });
        }
        if (msg.type === 'iac:report') {
          // like background.js buildReport/saveReport; "saved" reports are kept on window.__reports
          const { trace = [] } = await chrome.storage.local.get('trace');
          const entries = msg.all ? trace : trace.filter((t) => t.url === msg.url);
          const report = { page: msg.url, flagged: msg.flagged, entries };
          if (msg.save) { (window.top.__reports = window.top.__reports || []).push(report); return { ok: true, file: 'shim', entries: entries.length }; }
          return { ok: true, json: JSON.stringify(report), entries: entries.length };
        }
        if (msg.type === 'iac:undone') {
          const { undone = [] } = await chrome.storage.local.get('undone');
          const next = undone.filter((u) => !(u.page === msg.entry.page && u.key === msg.entry.key));
          if (msg.undone) next.push(msg.entry);
          await chrome.storage.local.set({ undone: next });
        }
        if (msg.type === 'iac:applied') {
          const { applied = [] } = await chrome.storage.local.get('applied');
          const next = applied.filter((u) => !(u.page === msg.entry.page && u.key === msg.entry.key));
          if (msg.applied) next.push(msg.entry);
          await chrome.storage.local.set({ applied: next });
        }
        if (msg.type === 'iac:getDict') return { dict: { becuz: 'because' } };
        if (msg.type === 'iac:getRegional') {
          const txt = await (await fetch(new URL('../data/regional.txt', location.href))).text();
          return { table: window.IAC_Policy.regionalTable(txt, msg.region) };
        }
        if (msg.type === 'iac:aiStatus') return { state: 'available', models: ['gemma3:4b'] };
        if (msg.type === 'iac:restore') {
          // background.js restoreParagraph, with a stand-in AI (window.__mockRestore: text -> corrected text)
          window.__words = window.__words || new Set((await (await fetch('../data/words.txt')).text()).split('\n'));
          if (!window.__mockRestore) return { ok: false, error: 'off' };
          return { ok: true, edits: IAC_Policy.restoredEdits(msg.req.text, window.__mockRestore(msg.req.text), (w) => window.__words.has(w)) };
        }
        if (msg.type === 'iac:commentChoice') {
          const { commentChoices = {} } = await chrome.storage.local.get('commentChoices');
          delete commentChoices[msg.key];
          if (msg.value) commentChoices[msg.key] = msg.value;
          await chrome.storage.local.set({ commentChoices });
        }
        if (msg.type === 'iac:proofread') {
          // like background.js: answers are cached per paragraph; cacheOnly asks only the cache
          const key = JSON.stringify([msg.req.text, msg.req.candidates.map((c) => c.original + '→' + c.replacement)]);
          window.__aiCache = window.__aiCache || new Map();
          if (window.__aiCache.has(key)) return { ...window.__aiCache.get(key), cached: true };
          if (msg.cacheOnly) return { ok: false, error: 'not cached' };
          // run the AI, then screen its edits with the policy and the dictionary
          const res = window.__mockAI ? await window.__mockAI(msg.req) : { ok: false };
          if (res.ok) {
            window.__words = window.__words || new Set((await (await fetch('../data/words.txt')).text()).split('\n'));
            const text = msg.req.text;
            // background.js review(), with a stand-in AI that confirms everything it's asked to
            const isWord = (w) => window.__words.has(w);
            const base = { text, isWord, known: IAC_Engine.isKnownMisspelling, mentioned: (w) => IAC_Engine.isMentioned(text, w) };
            const kept = [];
            for (const e of res.result.edits.flatMap(IAC_Policy.splitEdit).map((x) => IAC_Policy.classify(x, isWord))) {
              const at = IAC_Policy.locate(text, e);
              const d = at ? IAC_Policy.judgeEdit(e, { ...base, at }) : { verdict: 'block', why: 'not found' };
              (window.__screened = window.__screened || []).push(`${e.original} -> ${e.replacement}: ${d.verdict} ${d.why || ''}`);
              if (d.verdict === 'apply' || d.verdict === 'confirm') kept.push(e);
              if (d.verdict === 'repair') {
                const alts = IAC_Policy.alternatives(e.original, isWord);
                const pick = window.__mockConfirm ? window.__mockConfirm(text, e.original, alts) : null;
                if (pick) kept.push({ ...e, replacement: pick, type: 'wrongword', reason: `Looks like a slip for "${pick}"` });
              }
            }
            res.result.edits = kept;
            window.__aiCache.set(key, res);
          }
          return res;
        }
      },
      onMessage: { addListener: (fn) => msgListeners.push(fn) },
      getManifest: () => ({ version: '1.0.0' }),
    },
    tabs: {
      query: async () => [{ id: 1, url: location.href }],
      sendMessage: (_id, msg) => new Promise((res) => { const fn = msgListeners[0]; fn ? fn(msg, {}, res) : res(null); }),
      create: ({ url }) => window.open(url),
    },
  };
})();

// Stand-in for the AI: agrees with every rule fix except ones inside a sentence that mentions "example",
// and finds "were" -> "where" the way a real model would.
window.__mockAI = async (req) => {
  await new Promise((r) => setTimeout(r, 300));
  const checks = req.candidates.map((c, i) => ({ n: i + 1, ok: !/example/i.test(req.text) }));
  const edits = [];
  const m = /issues were Claude/.exec(req.text);
  const H = { deliberate: false, confidence: 'high' };
  if (m) edits.push({ ...H, original: 'were', replacement: 'where', context: 'For issues were Claude says no', type: 'wrongword', reason: '"where" introduces the situation; "were" is a verb.' });
  // the two bad edits Gemini Nano really made on r/ENGLISH, plus regional and dialect bait
  if (/readin'/.test(req.text)) {
    edits.push({ ...H, original: "readin'", replacement: 'reading', context: "old readin', writin'", type: 'spelling', reason: 'misspelling' });
    edits.push({ ...H, original: "'rithmatic", replacement: 'arithmatic', context: "and 'rithmatic days", type: 'spelling', reason: 'misspelling' });
  }
  if (/colour/.test(req.text)) edits.push({ ...H, original: 'colour', replacement: 'color', context: 'The colour of', type: 'spelling', reason: 'spelling' });
  // from a screenshot of X replies: the model "fixed" correct words
  if (/give is fable/.test(req.text)) edits.push({ ...H, original: 'is', replacement: 'its', context: 'just give is fable', type: 'wrongword', reason: 'possessive' });
  if (/cycle is coming/.test(req.text)) edits.push({ ...H, original: 'is', replacement: 'its', context: 'hype cycle is coming', type: 'wrongword', reason: 'possessive' });
  if (/crazy they chose/.test(req.text)) edits.push({ ...H, original: 'they', replacement: 'them', context: 'crazy they chose', type: 'wrongword', reason: 'object' });
  if (/it s huge/.test(req.text)) edits.push({ ...H, original: 'it s huge', replacement: "it's huge", context: 'it s huge', type: 'typo', reason: 'contraction' });
  if (/They was/.test(req.text)) edits.push({ ...H, original: 'was', replacement: 'were', context: 'They was fixin', type: 'wrongword', reason: 'agreement' });
  return { ok: true, result: { checks, edits } };
};

// Stand-in for the AI's two-order confirm on repairs: picks "us" only where it fits.
window.__mockConfirm = (text, original, alts) => (/give is/.test(text) && alts.includes('us') ? 'us' : null);

// Hidden test panes report document.hidden, which stops AI reviews (heat fix); the demo pretends to be visible.
if (/[?&]io=(manual|stub)/.test(location.search) || parent !== window) Object.defineProperty(document, 'hidden', { get: () => false });
// Hidden test panes never fire IntersectionObserver; ?io=stub treats everything as visible, ?io=manual waits for
// window.__ioFire() (to test pages that rebuild a paragraph before it scrolls into view).
if (new URLSearchParams(location.search).get('io') === 'manual') {
  const observed = new Map();
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { observed.set(el, this); }
    unobserve(el) { observed.delete(el); }
    disconnect() {}
  };
  window.__ioFire = () => { for (const [el, io] of [...observed]) io.cb([{ target: el, isIntersecting: true }]); };
} else if (new URLSearchParams(location.search).get('io') === 'stub' || parent !== window) {
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { setTimeout(() => this.cb([{ target: el, isIntersecting: true }]), 0); }
    unobserve() {}
    disconnect() {}
  };
}
