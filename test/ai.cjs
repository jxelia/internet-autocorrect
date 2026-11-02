/*
 * Internet Autocorrect — AI proofreader. Runs in the offscreen document (so Chrome's on-device
 * model is reachable) and talks to either:
 *   - Chrome's built-in Gemini Nano (Prompt API, LanguageModel) — runs on this computer
 *   - Ollama on localhost — runs on this computer
 * Nothing here contacts a cloud service.
 *
 * Small jobs per paragraph, because small models do far better at narrow questions:
 *   1. choose  — for each rule fix that depends on context: "which of these two sentences is right?",
 *               asked twice with the order swapped. The rule fix is vetoed only if both answers agree.
 *   2. find    — look for clear mistakes the rules missed.
 *   3. confirm — the same two-sentence question for every proposed fix that isn't mechanical (the AI's own
 *               finds, spellchecker suggestions, repairs; see policy.judgeEdit). Kept only if both orders prefer
 *               the fix: the AI has to agree with itself.
 */
'use strict';

const Policy = typeof IAC_Policy !== 'undefined' ? IAC_Policy : require('./policy.cjs');
const POLICY = Policy.PROMPT_POLICY;

const FIND_PROMPT = `You proofread one paragraph that someone is READING on a website.
${POLICY}

For each slip you list, also answer honestly:
- "deliberate": could the writer have written it this way on purpose (any of the deliberate cases above)? If there is
  any real chance, say true.
- "confidence": "high" only if any careful reader would agree it is a slip; otherwise "medium" or "low".
An empty list is the most common correct answer.

"context" must be copied EXACTLY from the paragraph, character for character: the slip and the word before and
after it (3 to 5 words).
"original" is the exact text as written and as SHORT as possible (usually ONE word, never a whole sentence);
"replacement" is only the corrected text. List each slip separately. Never rewrite a sentence. Keep the answer short:
no explanations.`;

const CHOOSE_PROMPT = `You are a careful English editor. You will see two versions of one sentence that differ only
in one word or short phrase. Decide which version is correctly written English.
If that word is being talked about as a word (quoted, listed, compared, or given as an example of a mistake),
the version that leaves it exactly as the writer typed it is the correct one.
If the version as written uses a deliberate dialect, regional spelling, slang or eye-dialect form, it is correct.
Judge only the differing word. Ignore any other mistakes in the sentence.`;

// Only when the reader asks for it ("Fix this comment"), never on its own. policy.js checks the answer (restoredEdits).
const RESTORE_PROMPT = `A reader asked you to correct one paragraph from a website. The writer's typing went wrong,
perhaps on purpose: letters may be missing, a space may stand where a letter belongs ("orre t" for "correct",
"spa e" for "space"), words may be split, and sound-alike or nearby words may be swapped ("brake" for "break",
"sloe" for "slow").
Write the paragraph out as it would read with those slips put right. Use the context of the whole paragraph to work
out what each broken word was. Keep the writer's own words, order, tone and punctuation: fix, never rephrase.
Reply with JSON only: {"text": "the corrected paragraph"}.`;

const RESTORE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
};

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
          context: { type: 'string' },
          deliberate: { type: 'boolean' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['original', 'replacement', 'context', 'deliberate', 'confidence'],
      },
      maxItems: 8,
    },
  },
  required: ['edits'],
};

const CHOOSE_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'integer', enum: [1, 2] } },
  required: ['answer'],
};

const NANO_OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

function findPrompt(text, hints) {
  let p = `Paragraph:\n<<<\n${text}\n>>>\n`;
  if (hints && hints.length) {
    p += `\nMistakes this reader has seen before (only list them if they really are wrong here): ${hints.join('; ')}\n`;
  }
  return p + '\nReply with JSON only.';
}

function choosePrompt(v1, v2, a, b) {
  return `Version 1: ${v1}\nVersion 2: ${v2}\n\nThe versions differ in "${a}" vs "${b}". ` +
    'Which version is correct? Reply with JSON: {"answer": 1} or {"answer": 2}.';
}

// ---------------------------------------------------------------- engines

const nanoBase = {};

async function nanoStatus() {
  if (typeof LanguageModel === 'undefined') return { state: 'unsupported' };
  try {
    return { state: await LanguageModel.availability(NANO_OPTS) }; // unavailable | downloadable | downloading | available
  } catch (e) {
    return { state: 'unsupported', error: String(e.message || e) };
  }
}

// The base sessions stay loaded: creating one is the slow part, so giving up on a call must not throw them away.
function nanoSession(system) {
  nanoBase[system] ??= LanguageModel.create({ ...NANO_OPTS, initialPrompts: [{ role: 'system', content: system }] })
    .catch((e) => { delete nanoBase[system]; throw e; });
  return nanoBase[system];
}

async function nanoAsk(system, user, schema, _ai, req) {
  if (req?.cancelled) throw new Error('cancelled');
  const session = await (await nanoSession(system)).clone();
  const stop = () => session.destroy();
  req?.stops.add(stop);
  try {
    if (req?.cancelled) throw new Error('cancelled');
    return JSON.parse(await session.prompt(user, { responseConstraint: schema }));
  } finally {
    req?.stops.delete(stop);
    session.destroy();
  }
}

// Load the model before the clock starts on a call (background.js timedAI).
async function warm(ai) {
  if (ai.engine === 'ollama') return;
  await Promise.all([FIND_PROMPT, CHOOSE_PROMPT].map(nanoSession));
}

// Calls in progress by request id, so background.js can give up on one and leave the model and other calls alone.
const requests = new Map();
function cancel(rid) {
  const req = requests.get(rid);
  if (!req) return;
  req.cancelled = true;
  for (const stop of req.stops) stop();
}

async function ollamaStatus({ url }) {
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/api/tags');
    if (res.status === 403) return { state: 'forbidden' };
    if (!res.ok) return { state: 'error', error: 'HTTP ' + res.status };
    const data = await res.json();
    return { state: 'available', models: (data.models || []).map((m) => m.name) };
  } catch (e) {
    return { state: 'offline' };
  }
}

async function ollamaAsk(system, user, schema, { url, model }, req) {
  if (req?.cancelled) throw new Error('cancelled');
  const abort = new AbortController();
  const stop = () => abort.abort();
  req?.stops.add(stop);
  const res = await fetch(url.replace(/\/$/, '') + '/api/chat', {
    method: 'POST',
    signal: abort.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema,
      options: { temperature: 0 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
  const data = await res.json().finally(() => req?.stops.delete(stop));
  return JSON.parse(data.message.content);
}

// ---------------------------------------------------------------- the two jobs

async function proofread(req, ai, call) {
  const ask = (system, user, schema) => (ai.engine === 'ollama' ? ollamaAsk : nanoAsk)(system, user, schema, ai, call);

  // 1. rule fixes: original vs fixed sentence, both orders; veto only on a consistent "keep it"
  const checks = [];
  for (let i = 0; i < (req.candidates || []).length; i++) {
    const c = req.candidates[i];
    let keepVotes = 0;
    try {
      const r1 = await ask(CHOOSE_PROMPT, choosePrompt(c.sentence, c.fixedSentence, c.original, c.replacement), CHOOSE_SCHEMA);
      if (r1.answer === 1) {
        keepVotes++;
        const r2 = await ask(CHOOSE_PROMPT, choosePrompt(c.fixedSentence, c.sentence, c.replacement, c.original), CHOOSE_SCHEMA);
        if (r2.answer === 2) keepVotes++;
      }
    } catch (_) { /* no answer: keep the rule fix */ }
    checks.push({ n: i + 1, ok: keepVotes < 2 });
  }

  // 2. what the rules missed
  let edits = [], error = '';
  if (req.find !== false) {
    try {
      const r = await ask(FIND_PROMPT, findPrompt(req.text, req.hints), FIND_SCHEMA);
      edits = Array.isArray(r.edits) ? r.edits.slice(0, 8) : [];
    } catch (e) {
      error = String(e.message || e); // no answer isn't "nothing found": background.js logs it and doesn't save it
    }
  }

  return { checks, edits, error };
}

// items: [{ original, replacement, sentence, fixedSentence }] -> [{ first, second, ok }]
async function confirm(items, ai, call) {
  const ask = (system, user, schema) => (ai.engine === 'ollama' ? ollamaAsk : nanoAsk)(system, user, schema, ai, call);
  const votes = [];
  for (const s of items || []) {
    const v = { first: null, second: null, ok: false };
    try {
      v.first = (await ask(CHOOSE_PROMPT, choosePrompt(s.sentence, s.fixedSentence, s.original, s.replacement), CHOOSE_SCHEMA)).answer;
      if (v.first === 2) {
        v.second = (await ask(CHOOSE_PROMPT, choosePrompt(s.fixedSentence, s.sentence, s.replacement, s.original), CHOOSE_SCHEMA)).answer;
        v.ok = v.second === 1;
      }
    } catch (_) { /* no answer: leave it */ }
    votes.push(v);
  }
  return votes;
}

async function restore(text, ai, call) {
  const ask = ai.engine === 'ollama' ? ollamaAsk : nanoAsk;
  const lost = Policy.missingLetters(text);
  const hint = lost.length ? `The letters ${lost.join(', ')} almost never appear in this paragraph, so they are probably what went missing. ` +
    'Put them back wherever a word is broken or looks wrong, also at the start or end of a word.\n\n' : '';
  const r = await ask(RESTORE_PROMPT, `Paragraph:\n<<<\n${text}\n>>>\n\n${hint}Reply with JSON only.`, RESTORE_SCHEMA, ai, call);
  return typeof r.text === 'string' ? r.text : '';
}

// ---------------------------------------------------------------- messaging

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.target !== 'iac-ai') return false;
  if (msg.type === 'cancel') { cancel(msg.rid); reply({ ok: true }); return false; }
  const call = { cancelled: false, stops: new Set() };
  if (msg.rid) requests.set(msg.rid, call);
  (async () => {
    try {
      if (msg.type === 'warm') {
        await warm(msg.ai);
        reply({ ok: true });
      } else if (msg.type === 'status') {
        reply(msg.engine === 'ollama' ? await ollamaStatus(msg.ai) : await nanoStatus());
      } else if (msg.type === 'proofread') {
        reply({ ok: true, result: await proofread(msg.req, msg.ai, call) });
      } else if (msg.type === 'restore') {
        reply({ ok: true, text: await restore(msg.text, msg.ai, call) });
      } else if (msg.type === 'confirm') {
        reply({ ok: true, votes: await confirm(msg.items, msg.ai, call) });
      } else if (msg.type === 'score') {
        reply({ ok: true, margins: await IAC_Scorer.scoreAll(msg.items, chrome.runtime.getURL('')) });
      } else {
        reply({ ok: false, error: 'unknown' });
      }
    } catch (e) {
      if (!call.cancelled) for (const k of Object.keys(nanoBase)) delete nanoBase[k];
      reply({ ok: false, error: String(e.message || e) });
    } finally {
      requests.delete(msg.rid);
    }
  })();
  return true;
});

// Exposed for the test harness (test/ai-eval.cjs runs these prompts against Ollama).
if (typeof module !== 'undefined') module.exports = { proofread, confirm, restore, warm, cancel, requests, RESTORE_PROMPT, FIND_PROMPT, CHOOSE_PROMPT };
