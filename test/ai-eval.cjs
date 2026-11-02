// Run the real ai.js prompts against a local Ollama model and score them.
// Usage: deno run -A test/ai-eval.cjs [model]      (copy ai.js, engine.js, policy.js to test/*.cjs first)
const fs = require('fs');
const { proofread, confirm } = require('./ai.cjs');
const P = require('./policy.cjs');
const E = require('./engine.cjs');
const words = new Set(fs.readFileSync(__dirname + '/../data/words.txt', 'utf8').split('\n'));
const model = process.argv[2] || 'gemma3:4b';
const ai = { engine: 'ollama', url: 'http://localhost:11434', model };

// [paragraph, expected final text]
const CASES = [
  // r/ENGLISH thread
  ["I'm well over 50. I can assure you that even in the old readin', writin', and 'rithmatic days, people still chronically confused the spelling of these words.", null],
  ["For issues were Claude says no, I have another model start off the work, then I have Claude continue it to completion once the \"damage\" has been done.", "For issues where Claude says no, I have another model start off the work, then I have Claude continue it to completion once the \"damage\" has been done."],
  ["As a Scot, only their/there are homophones. They’re is not pronounced the same in my accent.", null],
  ["there could be a complex sentence like this where it's correct to use \"their\": Their going to work is important for there to be food on the table.", null],
  ["Similar teeth-grinders are yore, your and you're. Also could of, would of, and should of instead of would've (would have) etc.", null],
  ["auto correct....it doesn't always chose the right one, and yes...if youre not paying attention before sending or posting, it happens.", "auto correct....it doesn't always choose the right one, and yes...if you're not paying attention before sending or posting, it happens."],
  ["The fact that it's your second language makes the distinction easier, because you learned the spelling at the same time as your were learning the words.", "The fact that it's your second language makes the distinction easier, because you learned the spelling at the same time as you were learning the words."],
  ["I have even seen the pretend word \"saling\" I use. They are saling their toys.", null],
  // real slips the rules don't know
  ["I seen the new peple at work and they was nice, but there office is a mess.", "I seen the new people at work and they was nice, but their office is a mess."],
  ["My freind recomended this place and the food was realy good, we will definitly come back.", "My friend recommended this place and the food was really good, we will definitely come back."],
  ["He past the exam last week and now he's moving to the city.", "He passed the exam last week and now he's moving to the city."],
  // deliberate language
  ["The colour of the centre was grey, and I realised the programme had been cancelled.", null],
  ["Dat boi finna go to the store, he don't care tho lol", null],
  ["Ye olde shoppe was sooo smol, I couldn't even. Heckin cute doggo tho.", null],
  ["Irregardless of what you think, I could care less, anyways.", null],
  // from a screenshot of X replies (Oct 27 2026): correct words the model "fixed"
  ["Congrats guys but just give is fable 5.5", "Congrats guys but just give us fable 5.5"],
  ["It's crazy they chose Frankfurt Stock Exchange huge win for the EU", null],
  ["So the ai hype cycle is coming to an end.", null],
  ["ive been there, that's what happened lol", null],
  // a dropped -ed vs a noun or bare verb that belongs there
  ["I have finish the report and sent it to him yesterday.", "I have finished the report and sent it to him yesterday."],
  ["The man was kill by a car on that road last year.", "The man was killed by a car on that road last year."],
  ["I have work to do tomorrow, so I can't come out with you.", null],
  ["All I did was walk by the river and think about it for a while.", null],
  ["The only constant in this job is change, and you learn to live with it.", null],
  ["She walk the dog every morning before she go to work.", null],
];

const apply = (t, fixes) => {
  let out = '', last = 0;
  for (const f of [...fixes].sort((a, b) => a.start - b.start)) { out += t.slice(last, f.start) + f.replacement; last = f.end; }
  return out + t.slice(last);
};

(async () => {
  let right = 0, wrongFix = 0, missed = 0, ms = 0, skipped = 0;
  for (const [text, expected] of CASES) {
    const want = expected === null ? text : expected;
    const rules = E.findCorrections(text, { blockText: text });
    const cands = rules.filter((f) => f.needsCheck);
    const t0 = Date.now();
    const worth = P.worthChecking(text, (w) => words.has(w));
    if (!worth) skipped++;
    const suggestions = worth ? P.spellSuggestions(text, (w) => words.has(w), { known: E.isKnownMisspelling, mentioned: (w) => E.isMentioned(text, w) }) : [];
    const res = await proofread({ text, find: worth, suggestions, candidates: cands.map((f) => ({ original: f.original, replacement: f.replacement, ...P.sentenceAround(text, f.start, f.end, f.replacement) })) }, ai);
    ms += Date.now() - t0;
    const kept = rules.filter((f) => !f.needsCheck || res.checks[cands.indexOf(f)].ok);
    const notes = [];
    for (const f of rules) if (!kept.includes(f)) notes.push(`  veto  ${f.original} -> ${f.replacement}`);
    // same pipeline as background.js review(): judge, then confirm in both orders
    const isWord = (w) => words.has(w);
    const base = { text, isWord, known: E.isKnownMisspelling, mentioned: (w) => E.isMentioned(text, w) };
    const aiFixes = [], ask = [];
    const take = (e, at) => {
      if (kept.concat(aiFixes).some((f) => at.start < f.end && at.end > f.start)) return false;
      aiFixes.push({ start: at.start, end: at.end, replacement: e.replacement.trim() });
      return true;
    };
    for (const e of res.edits.flatMap(P.splitEdit).map((x) => P.classify(x, isWord))) {
      const at = P.locate(text, e);
      const d = at ? P.judgeEdit(e, { ...base, at }) : { verdict: 'block', why: 'could not locate' };
      notes.push(`  ${d.verdict.padEnd(7)} ${e.original} -> ${e.replacement} ${d.why ? ': ' + d.why : ''} [${d.mechanism || ''}]`);
      if (d.verdict === 'apply') take(e, at);
      else if (d.verdict === 'confirm') ask.push({ group: 'e' + ask.length, e, at });
      else if (d.verdict === 'repair') {
        for (const alt of P.alternatives(e.original, isWord)) ask.push({ group: 'r' + e.original, e: { ...e, replacement: alt }, at });
      }
    }
    for (const s of suggestions) {
      const at = P.locate(text, s);
      if (at && !ask.some((a) => a.e.original === s.original)) ask.push({ group: 's' + s.original, e: s, at });
    }
    const t1 = Date.now();
    const votes = await confirm(ask.map((a) => ({ original: a.e.original, replacement: a.e.replacement,
      ...P.sentenceAround(text, a.at.start, a.at.end, a.e.replacement) })), ai);
    ms += Date.now() - t1;
    const groups = new Map();
    ask.forEach((a, i) => { a.v = votes[i]; groups.set(a.group, [...(groups.get(a.group) || []), a]); });
    for (const list of groups.values()) {
      const won = list.filter((a) => a.v.ok);
      for (const a of list) notes.push(`  vote    ${a.e.original} -> ${a.e.replacement}: ${a.v.first}/${a.v.second}${won.length === 1 && won[0] === a ? ' (applied)' : ''}`);
      if (won.length === 1) take(won[0].e, won[0].at);
    }
    const got = apply(text, [...kept, ...aiFixes]);
    const ok = got === want;
    if (ok) right++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${text.slice(0, 70)}…`);
    if (!ok) {
      console.log(`  got:  ${got}\n  want: ${want}`);
      // count wrong fixes vs misses word by word
      const g = got.split(/\s+/), w = want.split(/\s+/), t = text.split(/\s+/);
      g.forEach((x, i) => { if (x !== w[i]) { if (x !== t[i]) wrongFix++; else missed++; } });
    }
    notes.forEach((n) => console.log(n));
  }
  console.log(`\n${model}: ${right}/${CASES.length} paragraphs exactly right · wrong fixes: ${wrongFix} · missed slips: ${missed} · ${(ms / 1000).toFixed(1)}s total · ${skipped} paragraphs skipped by triage`);
})();
