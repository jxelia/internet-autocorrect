// Internet Autocorrect — service worker.
importScripts('policy.js', 'engine.js');
// Owns the correction log, the toolbar badge, the AI queue, and the learned word list.
const MAX_LOG = 1000;
const AI_DEFAULTS = { engine: 'off', verify: true, read: true, url: 'http://localhost:11434', model: '' };
const PROMOTE_AFTER = 3; // AI confirmations before a learned spelling fix applies instantly
const WIKIPEDIA_RAW =
  'https://en.wikipedia.org/w/index.php?title=Wikipedia:Lists_of_common_misspellings/For_machines&action=raw';

let chain = Promise.resolve(); // serialise storage writes so tabs don't clobber each other
const serial = (fn) => (chain = chain.then(fn).catch(() => {}));

// ---------------------------------------------------------------- log

function appendLog(entries) {
  serial(async () => {
    const { log = [] } = await chrome.storage.local.get('log');
    const seen = new Set(log.map((e) => e.key));
    const fresh = entries.filter((e) => !seen.has(e.key));
    if (!fresh.length) return;
    await chrome.storage.local.set({ log: [...fresh.reverse(), ...log].slice(0, MAX_LOG) });
  });
}

function markReverted(key, reverted) {
  serial(async () => {
    const { log = [] } = await chrome.storage.local.get('log');
    const entry = log.find((e) => e.key === key);
    if (!entry) return;
    entry.reverted = reverted;
    await chrome.storage.local.set({ log });
  });
}

// ---------------------------------------------------------------- learned words

const pairKey = (o, r) => (o + '→' + r).toLowerCase();

// events: [{ original, replacement, category, kind: 'hit' | 'reject' }]
function learn(events) {
  serial(async () => {
    const { learned = {} } = await chrome.storage.local.get('learned');
    let dictChanged = false;
    for (const ev of events) {
      if (!ev.original || !ev.replacement) continue;
      const key = pairKey(ev.original, ev.replacement);
      const item = learned[key] || {
        original: ev.original.toLowerCase(), replacement: ev.replacement, category: ev.category,
        hits: 0, rejects: 0, source: 'ai', auto: false, time: Date.now(),
      };
      if (ev.kind === 'hit') item.hits++;
      else if (ev.kind === 'reject') item.rejects++;
      item.time = Date.now();
      const singleWord = /^[a-z']+$/i.test(item.original);
      const wasAuto = item.auto;
      if (item.source === 'ai') {
        item.auto = singleWord && item.category !== 'wrongword' && item.hits >= PROMOTE_AFTER && item.rejects === 0;
      } else if (ev.kind === 'reject') {
        item.auto = false;
      }
      if (item.auto !== wasAuto) dictChanged = true;
      // Only keep AI items that were found by the AI at least once (rejects of rule fixes are noise otherwise)
      if (item.source === 'ai' && item.hits === 0) continue;
      learned[key] = item;
    }
    await chrome.storage.local.set({ learned, ...(dictChanged ? { dictVersion: Date.now() } : {}) });
  });
}

let dictCache = null;
async function getDict() {
  if (dictCache) return dictCache;
  const { learned = {}, wl_wikipedia = null } = await chrome.storage.local.get(['learned', 'wl_wikipedia']);
  const dict = { ...(wl_wikipedia ? wl_wikipedia.map : {}) };
  for (const item of Object.values(learned)) {
    if (item.auto && /^[a-z']+$/i.test(item.original)) dict[item.original.toLowerCase()] = item.replacement;
  }
  dictCache = dict;
  return dict;
}

// The reader's region spelling table (POLICY.md §7), built once per region from data/regional.txt.
const regionalCache = {};
function getRegional(region) {
  regionalCache[region] ??= fetch(chrome.runtime.getURL('data/regional.txt')).then((r) => r.text())
    .then((txt) => IAC_Policy.regionalTable(txt, region));
  return regionalCache[region];
}

async function getHints() {
  const { learned = {} } = await chrome.storage.local.get('learned');
  return Object.values(learned)
    .filter((i) => i.rejects === 0 && (i.source === 'you' || i.hits >= 2))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 25)
    .map((i) => `"${i.original}" -> "${i.replacement}"`);
}

async function importWikipedia() {
  const res = await fetch(WIKIPEDIA_RAW);
  if (!res.ok) throw new Error('Wikipedia returned ' + res.status);
  const raw = await res.text();
  const map = {};
  for (const line of raw.split('\n')) {
    const m = /^([a-z][a-z']+)->([^,]+)$/.exec(line.trim());
    if (m) map[m[1]] = m[2].trim();
  }
  const count = Object.keys(map).length;
  if (count < 100) throw new Error('The list looked wrong (' + count + ' entries)');
  await chrome.storage.local.set({ wl_wikipedia: { map, count, time: Date.now() }, dictVersion: Date.now() });
  return count;
}

// Both are off by default: anything saved while they were on (or before they were settings) goes.
chrome.storage.sync.get(['rememberAI', 'keepLog']).then((s) => {
  if (s.rememberAI !== true) chrome.storage.local.remove('aiCache');
  if (s.keepLog !== true) serial(() => chrome.storage.local.remove('trace'));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.learned || changes.wl_wikipedia)) dictCache = null;
  if (area === 'sync' && changes.rememberAI && changes.rememberAI.newValue !== true) forgetAnswers();
  if (area === 'sync' && changes.keepLog && changes.keepLog.newValue !== true) serial(() => chrome.storage.local.remove('trace'));
});

// ---------------------------------------------------------------- final check on AI edits (POLICY.md §5.7)

let words = null;
async function dictionary() {
  if (!words) {
    const text = await (await fetch(chrome.runtime.getURL('data/words.txt'))).text();
    words = new Set(text.split('\n'));
  }
  return words;
}

const matchCase = (orig, repl) => (/^[A-Z]/.test(orig) ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl);
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ ok: false, error: 'timeout' }), ms))]);

// Judge everything the AI and the spellchecker proposed (policy.judgeEdit), ask the AI to confirm the
// ones that need it, and keep a trace of every decision. Returns { edits, trace }.
async function review(text, rawEdits, suggestions, ai, casualMode, registerText) {
  const dict = await dictionary();
  const isWord = (w) => dict.has(w);
  const P = IAC_Policy;
  const base = {
    text, isWord, casualMode, registerText,
    known: (w) => self.IAC_Engine.isKnownMisspelling(w),
    mentioned: (w) => self.IAC_Engine.isMentioned(text, w),
  };
  const apply = [], ask = [], trace = [];
  const note = (e, d, more = {}) => trace.push({
    kind: e.source || 'ai', original: e.original, replacement: e.replacement, verdict: d.verdict, why: d.why || '',
    mechanism: d.mechanism, gravity: d.gravity, register: d.register,
    ai: e.source === 'spell' ? undefined : { reason: e.reason, confidence: e.confidence, deliberate: e.deliberate },
    ...more,
  });
  const queueConfirm = (group, e, at) => ask.push({ group, edit: e, ...P.sentenceAround(text, at.start, at.end, e.replacement) });

  for (const e of (rawEdits || []).flatMap(P.splitEdit).map((x) => P.classify(x, isWord))) {
    const at = P.locate(text, e);
    if (!at) { note(e, { verdict: 'block', why: 'could not find it in the paragraph' }); continue; }
    const d = P.judgeEdit(e, { ...base, at });
    note(e, d);
    if (d.verdict === 'apply') apply.push(e);
    else if (d.verdict === 'confirm') queueConfirm('e' + ask.length, e, at);
    else if (d.verdict === 'repair') {
      const group = 'r' + ask.length;
      for (const alt of P.alternatives(e.original, isWord)) {
        const fix = { ...e, replacement: matchCase(e.original, alt), type: 'wrongword', source: 'repair',
          reason: `Looks like a slip for "${matchCase(e.original, alt)}"` };
        if (P.checkAiEdit(fix, { ...base, at }) === null) queueConfirm(group, fix, at);
      }
    }
  }
  for (const s of suggestions || []) {
    if (ask.some((a) => a.edit.original === s.original) || apply.some((a) => a.original === s.original)) continue;
    const at = P.locate(text, s);
    if (!at) continue;
    queueConfirm('s' + ask.length, {
      original: s.original, replacement: s.replacement, context: s.context, type: 'spelling', source: 'spell',
      reason: `Not a word; "${s.replacement}" is the only word one letter away`, deliberate: false, confidence: 'high',
    }, at);
  }

  if (ask.length) {
    const res = await withTimeout(toAI({ type: 'confirm', ai, items: ask.map((a) => ({
      original: a.edit.original, replacement: a.edit.replacement, sentence: a.sentence, fixedSentence: a.fixedSentence,
    })) }), AI_LIMIT_MS);
    const votes = res && res.ok ? res.votes : [];
    const groups = new Map();
    ask.forEach((a, i) => {
      a.votes = votes[i] || null;
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(a);
    });
    for (const list of groups.values()) {
      const won = list.filter((a) => a.votes && a.votes.ok);
      for (const a of list) {
        const ok = won.length === 1 && won[0] === a;
        trace.push({
          kind: 'confirm', original: a.edit.original, replacement: a.edit.replacement, source: a.edit.source || 'ai',
          verdict: ok ? 'apply' : 'block', votes: a.votes, sentence: a.sentence,
          why: ok ? '' : !a.votes ? 'the AI gave no answer' : won.length > 1 ? 'the AI preferred more than one option'
            : 'the AI did not prefer the fix in both orders',
        });
      }
      if (won.length === 1) apply.push(won[0].edit);
    }
  }
  return { edits: apply.slice(0, 10), trace };
}

// ---------------------------------------------------------------- decision trace (the debug log)
// Every decision, applied or not and why, kept on this computer so a wrong fix can be diagnosed from the
// log instead of a description. Popup → Settings → Diagnostics copies it.

// Off unless the reader turns it on (Settings → Diagnostics → Keep a debug log): it quotes page text and addresses.
// Turning it off deletes it.
const MAX_TRACE = 1500;
const keepLog = async () => (await chrome.storage.sync.get('keepLog')).keepLog === true;
function appendTrace(entries) {
  if (!entries || !entries.length) return;
  serial(async () => {
    if (!(await keepLog())) return;
    const { trace = [] } = await chrome.storage.local.get('trace');
    await chrome.storage.local.set({ trace: [...trace, ...entries].slice(-MAX_TRACE) });
  });
}

// ---------------------------------------------------------------- reports (Send report to Claude)
// A report is this page's decision trace plus settings. "Send" saves it to a fixed folder in Downloads that
// Claude reads when told "check the latest report" (see CLAUDE.md); nothing leaves the computer.

const REPORT_DIR = 'internet-autocorrect-reports';

async function buildReport({ url, all, flagged }) {
  await chain; // let pending trace writes land first
  const [{ trace = [] }, sync] = await Promise.all([chrome.storage.local.get('trace'), chrome.storage.sync.get(null)]);
  const { ai = {}, ...settings } = sync;
  return {
    extension: chrome.runtime.getManifest().version, exported: new Date().toISOString(),
    page: all ? undefined : url, flagged: flagged || undefined, logOff: sync.keepLog !== true || undefined,
    settings: { ...settings, ai: { engine: ai.engine, model: ai.model, verify: ai.verify, read: !!ai.read } },
    entries: all ? trace : trace.filter((t) => t.url === url),
  };
}

async function saveReport(opts) {
  const report = await buildReport(opts);
  let host = 'all';
  try { if (!opts.all) host = new URL(opts.url).hostname.replace(/[^a-z0-9.-]/gi, ''); } catch (_) { /* keep 'all' */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${REPORT_DIR}/report-${stamp}-${host}.json`;
  await chrome.downloads.download({
    url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 1)),
    filename, saveAs: false, conflictAction: 'uniquify',
  });
  return { ok: true, file: filename, entries: report.entries.length, logOff: report.logOff };
}

// ---------------------------------------------------------------- undone fixes (remembered across reloads)

const MAX_UNDONE = 1000;
function setUndone(entry, undone) {
  serial(async () => {
    const { undone: list = [], undoCounts = {}, autoIgnored = [] } =
      await chrome.storage.local.get(['undone', 'undoCounts', 'autoIgnored']);
    const same = (u) => u.page === entry.page && u.key === entry.key;
    const next = list.filter((u) => !same(u));
    if (undone) next.push({ ...entry, time: Date.now() });
    const patch = { undone: next.slice(-MAX_UNDONE) };
    const pair = pairKey(entry.original, entry.replacement);
    // Counted by the words around the fix, not the page: the same comment in a feed and on its own page is one place.
    const place = entry.key;
    if (undone) {
      // Undoing the same change in two different places means "never make this change".
      const seen = new Set((undoCounts[pair] || []).map((p) => p.replace(/^[^#]*#/, '')));
      seen.add(place);
      undoCounts[pair] = [...seen].slice(-5);
      patch.undoCounts = undoCounts;
      if (seen.size >= 2) {
        const { ignored = [] } = await chrome.storage.sync.get('ignored');
        if (!ignored.includes(pair)) {
          await chrome.storage.sync.set({ ignored: [...ignored, pair] });
          patch.autoIgnored = [...new Set([...autoIgnored, pair])];
        }
      }
    } else if (undoCounts[pair]) {
      // Redo: this place no longer counts against the change, and a never-change that the undos added
      // automatically (not one the user chose) is lifted.
      undoCounts[pair] = undoCounts[pair].filter((p) => p.replace(/^[^#]*#/, '') !== place);
      patch.undoCounts = undoCounts;
      if (autoIgnored.includes(pair)) {
        const { ignored = [] } = await chrome.storage.sync.get('ignored');
        await chrome.storage.sync.set({ ignored: ignored.filter((k) => k !== pair) });
        patch.autoIgnored = autoIgnored.filter((k) => k !== pair);
      }
    }
    await chrome.storage.local.set(patch);
  });
}

// Fixes the user chose to make (Redo, Apply): kept so an AI veto on a later visit can't take them back.
function setApplied(entry, on) {
  serial(async () => {
    const { applied: list = [] } = await chrome.storage.local.get('applied');
    const next = list.filter((u) => !(u.page === entry.page && u.key === entry.key));
    if (on) next.push({ ...entry, time: Date.now() });
    await chrome.storage.local.set({ applied: next.slice(-MAX_UNDONE) });
  });
}

// ---------------------------------------------------------------- AI (runs in the offscreen document)

async function aiSettings() {
  const { ai = {} } = await chrome.storage.sync.get('ai');
  return { ...AI_DEFAULTS, ...ai };
}

let offscreenReady = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Run the on-device proofreading model',
    }).catch((e) => { if (!/single offscreen/i.test(String(e))) throw e; })
      .finally(() => { offscreenReady = null; });
  }
  await offscreenReady;
}

// Close the offscreen document; the next call opens a new one with fresh model sessions.
async function resetAI() {
  await chrome.offscreen.closeDocument?.().catch(() => {});
}

async function toAI(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'iac-ai', ...msg });
}

// AI answers per paragraph, kept in storage.local so a later visit doesn't ask again. A request keeps running here
// after its page is closed or left, and its answer is still saved. The key covers everything the answer depends
// on: the text, the rule fixes asked about, the engine and model, the casual-writing setting, and the files that
// judge the answer (so a popup-only update keeps the cache, a policy change starts it afresh).
// Off unless the reader turns it on (Settings → Remember the AI's answers; turning it off deletes them) and bounded: at most CACHE_MAX paragraphs,
// none older than CACHE_MAX_AGE_MS. Each entry is a hash of the paragraph (not its text), the AI's verdicts, and the
// changed words with the few words around them that placing a fix needs; the review trace is not kept.
const CACHE_MAX = 1000;
const CACHE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const NO_ANSWER_RETRY_MS = 3 * 24 * 3600 * 1000;
const keepAnswers = async () => (await chrome.storage.sync.get('rememberAI')).rememberAI === true;
const LOGIC_FILES = ['policy.js', 'engine.js', 'ai.js', 'background.js'];
let logicStamp = null;
function logicVersion() {
  logicStamp ??= Promise.all(LOGIC_FILES.map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.text())))
    .then((texts) => hashKey(texts.join('\n')))
    .catch(() => chrome.runtime.getManifest().version);
  return logicStamp;
}
let cache = null; // key -> { res, t }
let cacheSave = null;

async function loadCache() {
  if (!cache) {
    const { aiCache = {} } = await chrome.storage.local.get('aiCache');
    const fresh = Date.now() - CACHE_MAX_AGE_MS;
    if (!cache) cache = new Map(Object.entries(aiCache).filter(([, v]) => v.t > fresh).sort((a, b) => a[1].t - b[1].t));
  }
  return cache;
}

async function remember(key, res) {
  if (!(await keepAnswers())) return;
  await loadCache();
  const { trace, ...result } = res.result || {}; // the trace quotes whole sentences; it isn't needed to replay
  cache.delete(key);
  cache.set(key, { res: { ...res, result }, t: Date.now() });
  const fresh = Date.now() - CACHE_MAX_AGE_MS;
  for (const [k, v] of cache) { if (cache.size > CACHE_MAX || v.t <= fresh) cache.delete(k); else break; }
  clearTimeout(cacheSave);
  cacheSave = setTimeout(() => chrome.storage.local.set({ aiCache: Object.fromEntries(cache) }), 1000);
}

function forgetAnswers() {
  clearTimeout(cacheSave);
  cache = new Map();
  chrome.storage.local.remove('aiCache');
}

function hashKey(str) {
  let a = 0x811c9dc5, b = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (b * 31 + c) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + str.length.toString(36);
}

const queue = [];
let running = false;

async function proofread(req, cacheOnly = false) {
  const ai = await aiSettings();
  const { casualMode = 'auto' } = await chrome.storage.sync.get('casualMode');
  const key = hashKey(JSON.stringify([req.text, req.candidates.map((c) => c.original + '→' + c.replacement),
    ai.engine, ai.model || '', !!ai.read, casualMode, req.registerText || '', await logicVersion()]));
  const hit = (await keepAnswers()) ? (await loadCache()).get(key) : null;
  // A paragraph the model couldn't answer is remembered too, so a revisit doesn't wait again; retried after a while.
  if (hit && !(hit.res.noAnswer && Date.now() - hit.t > NO_ANSWER_RETRY_MS)) return { ...hit.res, cached: true };
  if (cacheOnly) return { ok: false, error: 'not cached' };
  return new Promise((resolve) => {
    // Already asked (a refresh, another tab): wait for that answer instead of asking twice. A queued one moves to
    // the front, since someone is reading it now.
    const job = inflight.get(key);
    if (job) {
      job.waiters.push(resolve);
      const i = queue.indexOf(job);
      if (i >= 0) { queue.splice(i, 1); queue.push(job); }
      return;
    }
    const fresh = { req, key, waiters: [resolve] };
    inflight.set(key, fresh);
    queue.push(fresh);
    if (queue.length > 300) {
      // Full: drop the oldest scan-only paragraph first; one with a fix waiting goes last.
      const i = queue.findIndex((j) => !j.req.candidates.length);
      finish(queue.splice(i >= 0 ? i : 0, 1)[0], { ok: false, error: 'busy' });
    }
    pump();
  });
}

const inflight = new Map(); // key -> job, from queued until its answer is in
// The model gave no answer (too slow even with the extra wait, or an error): log why. A timeout is remembered as an
// empty answer, which the page treats as "no answer from the AI, rule kept" at once on later visits.
function noAnswer(job, error) {
  appendTrace([{ t: Date.now(), url: job.req.url, kind: 'ai', verdict: 'no answer', why: error, text: job.req.text.slice(0, 300) }]);
  // Only a timeout is about this paragraph; other errors (model not ready, offscreen gone) would hit every one.
  if (error === 'timeout') remember(job.key, { ok: true, result: { checks: [], edits: [] }, noAnswer: true, error });
}
function answer(job, res) { for (const r of job.waiters.splice(0)) r(res); } // the pages asking get this
function finish(job, res) { answer(job, res); inflight.delete(job.key); }

// HEAT CAP (1.8.1): after each model call, reading paragraphs (scan-only jobs) waits REST_FACTOR times as long as
// the call took (at most REST_MAX_MS), so the chip is busy about 1/7 of the time (~14%) instead of flat out.
// Paragraphs with a rule fix waiting skip the wait: they're few and short, and the reader sees "Checking".
// Answers come later, not different. A call gets AI_LIMIT_MS before it's given up (and the model reset).
// GOALS.md §6; lower REST_FACTOR if heat matters less (1.7.26 had 1, at most 10 s).
const REST_FACTOR = 6;
const REST_MAX_MS = 90000;
const AI_LIMIT_MS = 15000;
let restUntil = 0;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    // Newest first (what the reader is looking at now), and paragraphs with a rule fix waiting for the AI before
    // scan-only ones: only the waiting fixes show as "Checking with the AI".
    let i = queue.length - 1, waiting = false;
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k].req.candidates.length) { i = k; waiting = true; break; }
    // Resting: look again shortly, so a fix that starts waiting meanwhile goes first.
    if (!waiting && Date.now() < restUntil) {
      await new Promise((r) => setTimeout(r, Math.min(restUntil - Date.now(), 1000)));
      continue;
    }
    const job = queue.splice(i, 1)[0];
    try {
      const ai = await aiSettings();
      if (ai.engine === 'off') { finish(job, { ok: false, error: 'off' }); continue; }
      // Nothing in the paragraph could be a slip: skip the "find" pass (rule checks still run).
      const dict = await dictionary();
      const isWord = (w) => dict.has(w);
      // The read-everything pass only when the reader turned it on (it's what keeps the model busy and the computer
      // warm); otherwise the AI only answers the rules' own questions.
      const find = !!ai.read && IAC_Policy.worthChecking(job.req.text, isWord);
      if (!find && !job.req.candidates.length) { finish(job, { ok: true, result: { checks: [], edits: [] }, skipped: true }); continue; }
      job.req.find = find;
      const suggestions = find ? IAC_Policy.spellSuggestions(job.req.text, isWord, {
        known: (w) => self.IAC_Engine.isKnownMisspelling(w),
        mentioned: (w) => self.IAC_Engine.isMentioned(job.req.text, w),
      }) : [];
      const hints = await getHints();
      const t0 = Date.now();
      const call = toAI({ type: 'proofread', ai, req: { ...job.req, hints } });
      const res = await withTimeout(call, AI_LIMIT_MS);
      // Too slow: the model may be stuck (a stuck on-device session slows every later call), so start it afresh.
      if (res && res.error === 'timeout') await resetAI();
      if (res && res.ok && res.result) {
        const { casualMode = 'auto' } = await chrome.storage.sync.get('casualMode');
        const out = await review(job.req.text, res.result.edits, suggestions, ai, casualMode, job.req.registerText);
        res.result.edits = out.edits;
        res.result.trace = out.trace;
        remember(job.key, res);
      }
      if (!res || !res.ok || !res.result) noAnswer(job, res?.error || 'no reply');
      finish(job, res || { ok: false, error: 'no reply' });
      restUntil = Date.now() + Math.min((Date.now() - t0) * REST_FACTOR, REST_MAX_MS);
    } catch (e) {
      noAnswer(job, String(e.message || e));
      finish(job, { ok: false, error: String(e.message || e) });
    }
  }
  running = false;
}

// ---------------------------------------------------------------- right-click: fix or leave one comment
// The reader decides per comment (POLICY.md §5). Their choice is kept by a hash of each paragraph, so it holds on
// every visit: { left: true } or { edits } (the changed words only).
const RESTORE_LIMIT_MS = 90000; // the reader asked and is waiting; a paragraph this broken takes a small model a while
const MAX_CHOICES = 1000;

async function restoreParagraph(req) {
  const ai = await aiSettings();
  if (ai.engine === 'off') return { ok: false, error: 'off' };
  const dict = await dictionary();
  const res = await withTimeout(toAI({ type: 'restore', ai, text: req.text }), RESTORE_LIMIT_MS);
  if (!res || !res.ok) return { ok: false, error: res?.error || 'no reply' };
  const edits = IAC_Policy.restoredEdits(req.text, res.text, (w) => dict.has(w));
  appendTrace([{ t: Date.now(), url: req.url, kind: 'ai', verdict: 'asked', text: req.text.slice(0, 300), corrected: String(res.text).slice(0, 300) }]);
  return { ok: true, edits };
}

function setCommentChoice(key, value) {
  serial(async () => {
    const { commentChoices = {} } = await chrome.storage.local.get('commentChoices');
    delete commentChoices[key];
    if (value) commentChoices[key] = { ...value, t: Date.now() };
    const kept = Object.entries(commentChoices).sort((a, b) => a[1].t - b[1].t).slice(-MAX_CHOICES);
    await chrome.storage.local.set({ commentChoices: Object.fromEntries(kept) });
  });
}

function makeMenus() {
  chrome.contextMenus.removeAll(() => {
    const contexts = ['page', 'selection', 'link'];
    chrome.contextMenus.create({ id: 'iac-fix', title: 'Fix this comment', contexts });
    chrome.contextMenus.create({ id: 'iac-leave', title: 'Leave this comment as written', contexts });
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'iac:comment', action: info.menuItemId === 'iac-fix' ? 'fix' : 'leave' }, { frameId: 0 })
    .catch(() => { /* no content script on this page */ });
});

// ---------------------------------------------------------------- History: Open

// Go to the page a logged fix came from (its own comment or post when known) and show the fix there.
// An open tab on that page is reused; a new tab picks the target up when its content script starts.
async function openEntry(e) {
  const url = e.link || e.url;
  const target = { original: e.original, replacement: e.replacement, before: e.before, after: e.after };
  const bare = (u) => String(u || '').split('#')[0];
  const [open] = (await chrome.tabs.query({})).filter((t) => bare(t.url) === bare(url));
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
    try {
      await chrome.tabs.sendMessage(open.id, { type: 'iac:find', target });
      return;
    } catch (_) {
      await chrome.tabs.reload(open.id); // no content script there (opened before the extension loaded)
      await chrome.storage.session.set({ ['find:' + open.id]: target });
      return;
    }
  }
  const tab = await chrome.tabs.create({ url });
  await chrome.storage.session.set({ ['find:' + tab.id]: target });
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target === 'iac-ai') return false;
  checkBuild();
  switch (msg.type) {
    case 'iac:trace':
      appendTrace(msg.entries);
      return false;
    case 'iac:report':
      (msg.save ? saveReport(msg) : buildReport(msg).then((r) => ({ ok: true, json: JSON.stringify(r, null, 1), entries: r.entries.length, logOff: r.logOff })))
        .then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
      return true;
    case 'iac:open':
      openEntry(msg.entry).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e.message || e) }));
      return true;
    case 'iac:pendingFind':
      if (!sender.tab) return false;
      (async () => {
        const k = 'find:' + sender.tab.id;
        const got = await chrome.storage.session.get(k);
        await chrome.storage.session.remove(k);
        reply({ target: got[k] || null });
      })();
      return true;
    case 'iac:undone':
      setUndone(msg.entry, msg.undone);
      return false;
    case 'iac:applied':
      setApplied(msg.entry, msg.applied);
      return false;
    case 'iac:log':
      appendLog(msg.entries);
      return false;
    case 'iac:reverted':
      markReverted(msg.key, msg.reverted);
      return false;
    case 'iac:learn':
      learn(msg.events);
      return false;
    case 'iac:count':
      if (sender.tab) {
        const tabId = sender.tab.id;
        chrome.action.setBadgeText({ tabId, text: msg.count ? (msg.count > 9 ? '9+' : String(msg.count)) : '' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#475569' });
        chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
      }
      return false;
    case 'iac:getDict':
      getDict().then((dict) => reply({ dict }));
      return true;
    case 'iac:getRegional':
      getRegional(msg.region).then((table) => reply({ table }), () => reply({ table: null }));
      return true;
    case 'iac:proofread':
      proofread(msg.req, !!msg.cacheOnly).then(reply);
      return true;
    case 'iac:restore':
      restoreParagraph(msg.req).then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
      return true;
    case 'iac:commentChoice':
      setCommentChoice(msg.key, msg.value);
      return false;
    case 'iac:aiStatus':
      (async () => {
        try {
          const ai = { ...(await aiSettings()), ...(msg.ai || {}) };
          reply(await toAI({ type: 'status', engine: ai.engine, ai }));
        } catch (e) {
          reply({ state: 'error', error: String(e.message || e) });
        }
      })();
      return true;
    case 'iac:importWikipedia':
      importWikipedia().then((count) => reply({ ok: true, count }), (e) => reply({ ok: false, error: String(e.message || e) }));
      return true;
    default:
      return false;
  }
});

// ---------------------------------------------------------------- updates reach open tabs
// Chrome doesn't put a new version's content scripts into tabs that are already open, and the old ones are cut
// off (content.js notices within a couple of seconds and undoes itself). Inject the new version so open tabs
// keep working without a refresh.
chrome.runtime.onInstalled.addListener(() => { makeMenus(); setTimeout(injectIntoOpenTabs, 3000); });
async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (tab.discarded) continue;
    for (const cs of scripts) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js, world: cs.world || 'ISOLATED' })
        .catch(() => {}); // pages Chrome won't let extensions touch
    }
  }
}

// ---------------------------------------------------------------- development: reload on change
// Loaded unpacked (no update_url), the extension reloads itself when build.txt changes, so edits made
// on disk take effect without a trip to chrome://extensions. Open tabs get the new version injected (above).
// The stamp seen at load lives in session storage: it outlives the worker going idle (a global would be reset
// on wake and miss edits made meanwhile) and is cleared by the reload.
let buildChecked = 0;
async function checkBuild() {
  if ('update_url' in chrome.runtime.getManifest() || Date.now() - buildChecked < 2000) return;
  buildChecked = Date.now();
  try {
    const stamp = (await (await fetch(chrome.runtime.getURL('build.txt'), { cache: 'no-store' })).text()).trim();
    const { build } = await chrome.storage.session.get('build');
    if (build === undefined) await chrome.storage.session.set({ build: stamp });
    else if (stamp !== build) chrome.runtime.reload();
  } catch (_) { /* no build.txt */ }
}
checkBuild();
