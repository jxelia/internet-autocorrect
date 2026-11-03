// The background AI queue, on a fake chrome and a stand-in model, with the clock running 50 times too fast.
// Usage, from test/: deno run -A queue.test.cjs
const fs = require('fs');
const t0 = Date.now(), realDate = Date.now.bind(Date), realTimeout = setTimeout;
const SPEED = 50;
Date.now = () => t0 + (realDate() - t0) * SPEED;
globalThis.setTimeout = (fn, ms = 0, ...a) => realTimeout(fn, ms / SPEED, ...a);
const stores = { sync: { ai: { engine: 'ollama', read: true, model: 'x' }, keepLog: false }, local: {}, session: {} };
const area = (name) => ({
  get: async (k) => (k == null ? { ...stores[name] } : Object.fromEntries([k].flat().filter((x) => x in stores[name]).map((x) => [x, stores[name][x]]))),
  set: async (o) => { Object.assign(stores[name], o); },
  remove: async () => {},
});
const calls = [];
let model = async () => ({ ok: true, result: { checks: [], edits: [] } });
let onMessage;
const quiet = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : quiet()), apply: () => Promise.resolve([]) });
globalThis.self = globalThis;
globalThis.chrome = new Proxy({}, { get: (_, k) => ({
  storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: { addListener() {} } },
  runtime: {
    getURL: (p) => p, getManifest: () => ({ version: 'test' }), getContexts: async () => [{}],
    onMessage: { addListener: (fn) => { onMessage = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    sendMessage: async (m) => {
      if (m.type === 'warm' || m.type === 'cancel') return { ok: true };
      calls.push(m);
      return model(m);
    },
  },
  offscreen: { hasDocument: async () => true, createDocument: async () => {}, closeDocument: async () => {} },
}[k] ?? quiet()) });
globalThis.fetch = async (p) => ({ ok: true, text: async () => (String(p).endsWith('words.txt') ? fs.readFileSync(__dirname + '/../data/words.txt', 'utf8') : ''), json: async () => ({}) });
globalThis.importScripts = () => {};
for (const f of ['policy.js', 'engine.js']) (0, eval)(fs.readFileSync(__dirname + '/../' + f, 'utf8'));
(0, eval)(fs.readFileSync(__dirname + '/../background.js', 'utf8'));

const send = (msg) => new Promise((resolve) => { if (onMessage(msg, { tab: { id: 1 } }, resolve) !== true) resolve(); });
const para = (n) => `The paragraph number ${n} has a slipp in it and we want to read it now.`;
const ask = (id, n, prio = 1, candidates = []) => send({ type: 'iac:proofread', id, prio, req: { text: para(n), url: 'u', candidates, asked: true } });
const sleep = (ms) => new Promise((r) => realTimeout(r, ms));
let failed = 0, passed = 0;
const check = (name, ok, more = '') => { if (ok) passed++; else { failed++; console.log('FAIL', name, more); } };
const reads = () => calls.filter((c) => c.type === 'proofread' && c.req.find).map((c) => c.req.text.match(/number (\d+)/)[1]);
const cand = { original: 'their', replacement: 'there', sentence: 's', fixedSentence: 'f' };

(async () => {
  // Held at the start so the queue fills before anything is picked.
  await send({ type: 'iac:input' });
  const a = [ask('a', 1, 1), ask('b', 2, 2), ask('c', 3, 3), ask('d', 4, 1), ask('e', 5, 1), ask('w', 6, 1, [cand])];
  await sleep(10);
  check('no call starts while the reader is scrolling', calls.length === 0, JSON.stringify(calls.length));
  send({ type: 'iac:cancel', id: 'd' });
  check('a cancelled job says so', (await a[3]).cancelled === true);
  await Promise.all(a.filter((_, i) => i !== 3));
  const order = calls.filter((c) => c.type === 'proofread').map((c) => (c.req.find ? 'read' : 'rule') + c.req.text.match(/number (\d+)/)[1]);
  check('a fix waiting goes first', order[0] === 'rule6', order.join(' '));
  check('then what is showing', reads()[1] === '3', reads().join(' '));
  check('then the way the reader scrolls', reads()[2] === '2', reads().join(' '));
  check('a cancelled paragraph is never read', !reads().includes('4'), reads().join(' '));

  // A job two pages wait on survives one of them leaving.
  calls.length = 0;
  await send({ type: 'iac:input' });
  const p = ask('p1', 7), q = ask('p2', 7);
  await sleep(1);
  send({ type: 'iac:cancel', id: 'p1' });
  check('one leaving gets cancelled', (await p).cancelled === true);
  check('the other still gets its answer', (await q).ok === true);
  check('and only one call was made', reads().length === 1);

  // Every fourth reading job is the oldest.
  calls.length = 0;
  await send({ type: 'iac:input' });
  const many = [20, 21, 22, 23, 24, 25, 26, 27].map((n) => ask('s' + n, n));
  await Promise.all(many);
  check('the oldest still gets a turn', reads().indexOf('20') < 7 && reads().indexOf('20') >= 0, reads().join(' '));

  // A slow reading pass doesn't lose the rule answers, and they're not lost on the page.
  calls.length = 0;
  model = async (m) => {
    if (m.type === 'proofread' && m.req.find) return new Promise(() => {}); // never answers
    return { ok: true, result: { checks: [{ n: 1, ok: false }], edits: [] } };
  };
  const r = await ask('r', 30, 1, [cand]);
  check('rule answers kept when the read times out', r.ok && r.result.checks[0]?.ok === false, JSON.stringify(r).slice(0, 200));
  check('marked as not fully answered', r.noAnswer === true);

  // Confirm votes already in are kept when a later one times out.
  calls.length = 0;
  let confirms = 0;
  model = async (m) => {
    if (m.type === 'confirm') return ++confirms === 1 ? { ok: true, votes: [{ first: 1, second: 2, ok: true }] } : new Promise(() => {});
    return { ok: true, result: { checks: [], edits: [] } };
  };
  const out = await review('I went to teh shop and saw teh dog there today.', [
    { original: 'teh', replacement: 'the', context: 'to teh shop', type: 'spelling', deliberate: false, confidence: 'high' },
    { original: 'there', replacement: 'their', context: 'dog there today', type: 'wrongword', deliberate: false, confidence: 'high' },
  ], [], { engine: 'ollama' }, 'auto', '', true);
  check('confirm is asked one at a time', calls.filter((c) => c.type === 'confirm').every((c) => c.items.length === 1));
  check('a slow confirm stops the rest', confirms <= 2, String(confirms));
  check('review still finishes', Array.isArray(out.edits));

  // The built-in checker answers rule questions and swaps, with no language model at all.
  calls.length = 0;
  stores.sync.ai = { engine: 'small', read: true };
  const scored = [];
  model = async (m) => {
    if (m.type === 'score') { scored.push(...m.items); return { ok: true, margins: m.items.map((i) => (i.a === 'there' ? -5 : i.a === 'lose' ? 14 : -20)) }; }
    return { ok: false, error: 'a language model was asked' };
  };
  const vetoed = await send({ type: 'iac:proofread', id: 'k1', prio: 1, req: { text: 'They will go over their by the lake on the weekend.', url: 'u',
    candidates: [{ original: 'their', replacement: 'there', pre: 'They will go over ', suf: ' by the lake on the weekend.', sentence: 's', fixedSentence: 'f' }] } });
  check('a rule fix far behind is turned down', vetoed.result.checks[0].ok === false, JSON.stringify(vetoed.result.checks));
  check('no language model asked', calls.every((c) => c.type === 'score'), calls.map((c) => c.type).join());
  const found = await send({ type: 'iac:proofread', id: 'k2', prio: 1, req: { text: 'He said the plasma would rapidly loose heat and then stop working.', url: 'u', candidates: [] } });
  check('a clear swap is suggested', found.result.edits.some((e) => e.original === 'loose' && e.replacement === 'lose'), JSON.stringify(found.result.edits).slice(0, 200));
  check('asked with the gate', scored.some((i) => i.a === 'lose' && i.gate !== undefined));
  stores.sync.ai = { engine: 'ollama', read: true, model: 'x' };
  model = async (m) => (m.type === 'score' ? { ok: false } : { ok: true, result: { checks: [{ n: 1, ok: true }], edits: [] } });
  calls.length = 0;
  const fell = await send({ type: 'iac:proofread', id: 'k3', prio: 1, req: { text: 'They will go over their by the big lake on the weekend.', url: 'u', asked: true,
    candidates: [{ original: 'their', replacement: 'there', pre: 'They will go over ', suf: ' by the big lake on the weekend.', sentence: 's', fixedSentence: 'f' }] } });
  check('falls back to the language model if the checker fails', fell.ok && calls.some((c) => c.type === 'proofread'), JSON.stringify(fell).slice(0, 160));

  // Browsing never runs a language model, whichever engine is set, and doesn't wait for a still page.
  calls.length = 0;
  model = async (m) => (m.type === 'score' ? { ok: true, margins: m.items.map(() => -20) } : { ok: true, result: { checks: [], edits: [{ original: 'slipp', replacement: 'slip', context: 'a slipp in', type: 'spelling', deliberate: false, confidence: 'high' }] } });
  await send({ type: 'iac:input' });
  const browsed = send({ type: 'iac:proofread', id: 'b1', prio: 1, req: { text: para(40), url: 'u',
    candidates: [{ original: 'their', replacement: 'there', pre: 'x ', suf: ' y', sentence: 's', fixedSentence: 'f' }] } });
  await sleep(10);
  check('browsing does not wait for scrolling to stop', calls.length > 0);
  const browsing = await browsed;
  check('browsing gets the checker\'s answer', browsing.ok && browsing.result.checks.length === 1, JSON.stringify(browsing).slice(0, 160));
  check('browsing asks no language model', calls.every((c) => c.type === 'score'), calls.map((c) => c.type).join());
  model = async () => ({ ok: false, error: 'checker down' });
  calls.length = 0;
  const down = await send({ type: 'iac:proofread', id: 'b2', prio: 1, req: { text: para(41), url: 'u',
    candidates: [{ original: 'their', replacement: 'there', pre: 'x ', suf: ' y', sentence: 's', fixedSentence: 'f' }] } });
  check('with the checker down, still no language model', !calls.some((c) => c.type !== 'score'), calls.map((c) => c.type).join());
  check('and that is not saved as an answer', down.noAnswer === true, JSON.stringify(down).slice(0, 160));

  console.log(`${passed} passed, ${failed} failed`);
  Deno.exit(failed ? 1 : 0);
})();
