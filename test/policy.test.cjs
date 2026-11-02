// Final safety check on AI edits (policy.checkAiEdit with the real dictionary).
const fs = require('fs');
const P = require('./policy.cjs');
const words = new Set(fs.readFileSync(__dirname + '/../data/words.txt', 'utf8').split('\n'));
const isWord = (w) => words.has(w);
const H = { deliberate: false, confidence: 'high', reason: '' };

const RITH = "I can assure you that even in the old readin', writin', and 'rithmatic days, people still chronically confused the spelling of these words.";
const cases = [
  // [paragraph, edit, should be allowed?]
  [RITH, { original: "readin'", replacement: 'reading', context: "the old readin', writin'", type: 'spelling' }, false],
  [RITH, { original: "'rithmatic", replacement: 'arithmatic', context: "and 'rithmatic days", type: 'spelling' }, false],
  [RITH, { original: 'rithmatic', replacement: 'arithmetic', context: "and 'rithmatic days", type: 'spelling' }, false],
  ['The colour was off.', { original: 'colour', replacement: 'color', context: 'The colour was off', type: 'spelling' }, false],
  ['The colour was off.', { original: 'colour', replacement: 'color', context: 'The colour was off', type: 'wrongword' }, false],
  ['They was going home.', { original: 'was', replacement: 'were', context: 'They was going home', type: 'wrongword' }, false],
  ['He don’t care.', { original: 'don’t', replacement: 'doesn’t', context: 'He don’t care', type: 'wrongword' }, false],
  ['I asked Jon about it.', { original: 'Jon', replacement: 'John', context: 'asked Jon about it', type: 'spelling' }, false],
  ['lol that is sooo good', { original: 'sooo', replacement: 'so', context: 'that is sooo good', type: 'typo' }, false],
  ['Gonna be late tbh.', { original: 'Gonna', replacement: 'Going to', context: 'Gonna be late', type: 'spelling' }, false],
  ['I would say it is fine.', { original: 'say', replacement: 'state', context: 'would say it is', type: 'wrongword' }, false],
  ['It was a definately good day.', { original: 'definately', replacement: 'definitely', context: 'a definately good', type: 'spelling', deliberate: true }, false],
  ['It was a definately good day.', { original: 'definately', replacement: 'definitely', context: 'a definately good', type: 'spelling', confidence: 'medium' }, false],
  // allowed
  ['It was a definately good day.', { original: 'definately', replacement: 'definitely', context: 'a definately good', type: 'spelling' }, true],
  ['For issues were Claude says no.', { original: 'were', replacement: 'where', context: 'For issues were Claude says', type: 'wrongword' }, true],
  ['I recieved the parcle today.', { original: 'parcle', replacement: 'parcel', context: 'the parcle today', type: 'spelling' }, true],
  ['He dosnt know.', { original: 'dosnt', replacement: "doesn't", context: 'He dosnt know', type: 'typo' }, true],
  // casual spellings: left alone without evidence of careful writing (POLICY.md §4), fixed with it
  ['I could of gone.', { original: 'could of', replacement: 'could have', context: 'I could of gone', type: 'wrongword' }, false],
  ["I could of gone, but I didn't; it rained.", { original: 'could of', replacement: 'could have', context: 'I could of gone', type: 'wrongword' }, true],
];
let pass = 0, fail = 0;
for (const [text, e, want] of cases) {
  const edit = { ...H, ...e };
  const at = P.locate(text, edit);
  const why = at ? P.checkAiEdit(edit, { text, at, isWord }) : 'not found';
  const got = why === null;
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${e.original} -> ${e.replacement}: ${why || 'allowed'} (wanted ${want ? 'allowed' : 'blocked'})`); }
}

// Offline spellchecker: which non-words get a suggestion for the AI to confirm
const E = require('./engine.cjs');
const SPELL = [
  // [paragraph, expected "original>replacement" list]
  ['I seen the new peple at work.', ['peple>people']],
  ['I saw them yesterdya at work.', ['yesterdya>yesterday']],
  ['Peple were nice.', ['Peple>People']], // sentence start keeps its capital
  ['My freind said it was fine.', []], // the word lists already fix it, so the AI isn't asked
  ['That is realy good.', []], // really, rely, relay, ready…: ambiguous
  ['I posted it on flickr and tumblr.', []], // several neighbours each
  ['I posted it on Flickr yesterday.', []], // capitalised mid-sentence: a name
  ['Dat boi finna go tho.', []], // deliberate forms
  ['I will definately go.', []], // the word lists already fix it
  ['People write "peple" all the time.', []], // mentioned, not used
  ['peple here, peple there.', []], // used consistently
  ['Visit www.exmaple.com or #peple today.', []], // URL and hashtag
  ['The colour of the theatre.', []], // real words
];
const isW = (w) => words.has(w);
for (const [text, want] of SPELL) {
  const got = P.spellSuggestions(text, isW, { known: E.isKnownMisspelling, mentioned: (w) => E.isMentioned(text, w) })
    .map((s) => s.original + '>' + s.replacement);
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL spell "${text}": got [${got}] wanted [${want}]`); }
}

// Decision model: the verdict for each proposed edit (from the screenshot and reports of Oct 27 2026)
const JUDGE = [
  // [paragraph, original, replacement, verdict, alternatives for a repair]
  ['Congrats guys but just give is fable 5.5', 'is', 'its', 'repair', ['us']],
  ['So the ai hype cycle is coming to an end.', 'is', 'its', 'repair', ['us']],
  ["It's crazy they chose Frankfurt Stock Exchange huge win for the EU", 'they', 'them', 'block'],
  ['It was me who did it.', 'me', 'I', 'block'],
  ['He walk to work every day.', 'walk', 'walks', 'block'],
  ['honestly it s huge for them', 'it s', "it's", 'apply'],
  ["ive been there, that's what happened lol", 'ive', "I've", 'block'],
  ['I seen the new peple at work.', 'peple', 'people', 'confirm'],
  ['I think their going to win.', 'their', "they're", 'confirm'],
  ['I got it form the shop.', 'form', 'from', 'confirm'],
  ['I went to the the shop.', 'the the', 'the', 'apply'],
  ['I ate an apple today.', 'an', 'a', 'block'],
  ['I ate a apple today.', 'a', 'an', 'confirm'],
  ['The rain started falling down fastly.', 'fastly', 'fast', 'confirm'],
];
for (const [o, r, want] of [['fastly', 'fast', 'wordform'], ['goed', 'went', 'wordform'], ['quickly', 'quick', 'grammar'], ['bases', 'basis', 'grammar'], ['peple', 'people', 'misspelling']]) {
  const m = P.mechanism(o, r, isWord);
  if (m === want) pass++; else { fail++; console.log(`FAIL mechanism ${o} -> ${r}: ${m}, wanted ${want}`); }
}
if (P.classify({ original: 'fastly', replacement: 'fast' }, isWord).type === 'wordform') pass++;
else { fail++; console.log('FAIL classify fastly -> fast'); }
for (const [text, original, replacement, want, alts] of JUDGE) {
  const edit = P.classify({ ...H, original, replacement, context: text }, isWord);
  const at = P.locate(text, edit);
  const d = P.judgeEdit(edit, { text, at, isWord, known: E.isKnownMisspelling, mentioned: (w) => E.isMentioned(text, w) });
  let ok = d.verdict === want;
  if (ok && alts) ok = JSON.stringify(P.alternatives(original, isWord)) === JSON.stringify(alts);
  if (ok) pass++;
  else { fail++; console.log(`FAIL judge ${original} -> ${replacement}: ${d.verdict} (${d.mechanism}; ${d.why})${alts ? ' alts ' + P.alternatives(original, isWord) : ''}, wanted ${want}`); }
}
// "Fix this comment": what the model's version may change (POLICY.md §5)
const JOKE1 = 'I think we need to take at brake at this point. Let’s apply the breaks and sloe down a little.';
const JOKE2 = 'I m at a loss to u derst a d why auto orre t has been updated to orre t for spelling aused y people hitti g the spa e at I stead of the key oard.';
for (const [text, corrected, want] of [
  [JOKE1, 'I think we need to take a break at this point. Let’s apply the brakes and slow down a little.', ['at brake>a break', 'breaks>brakes', 'sloe>slow']],
  [JOKE2, 'I’m at a loss to understand why autocorrect has been updated to correct for spelling caused by people hitting the space at instead of the keyboard.',
    ['I m>I’m', 'u derst a d>understand', 'auto orre t>autocorrect', 'orre t>correct', 'aused y>caused by', 'hitti g>hitting', 'spa e>space', 'I stead>instead', 'key oard.>keyboard.']],
  ['My freind said it was good.', 'My friend said it was good.', ['freind>friend']],
  ['That car was good.', 'That automobile was great.', []], // synonyms: too far apart
  ['My freind said it was good.', 'My frrend said it was good.', []], // not a word
  ['My freind said it was good.', 'Sounds like a nice restaurant, glad you liked it.', []], // an answer, not the text
  ['My freind said so', 'my friend said so.', ['My freind>my friend']], // capital and full stop alone aren't edits
]) {
  const got = P.restoredEdits(text, corrected, isWord);
  const placed = got.every((e) => text.slice(e.start, e.end) === e.original);
  const list = got.map((e) => e.original + '>' + e.replacement);
  if (placed && JSON.stringify(list) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL restoredEdits ${text.slice(0, 30)}: ${JSON.stringify(list)}, wanted ${JSON.stringify(want)}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
