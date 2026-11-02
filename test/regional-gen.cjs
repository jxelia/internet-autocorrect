// Builds data/regional.txt: groups of spellings that differ only by region (color/colour, analyze/analyse),
// each form tagged with the regions whose dictionary has it. Source: the per-region word lists of the MIT
// `wordlist-english` package (SCOWL), the same source as data/words.txt. Run from the project root:
//   curl -sL https://registry.npmjs.org/wordlist-english/-/wordlist-english-1.2.1.tgz | tar xz -C <dir>
//   deno run -A test/regional-gen.cjs <dir>/package
// Line format: `color:u colour:bca` (u US, b UK, c Canada, a Australia, * every region). Used by the Your-region
// spelling setting (POLICY.md §7): a word is changed only if the reader's region lacks it and exactly one form in
// its group is the reader's.
const fs = require('fs');
const dir = process.argv[2] || Deno.args[0];
const LEVELS = [10, 20, 35, 40, 50, 55, 60];
const load = (name) => new Set(LEVELS.flatMap((l) => JSON.parse(fs.readFileSync(`${dir}/${name}-words-${l}.json`, 'utf8'))));
const REGIONS = { u: load('american'), b: load('british'), c: load('canadian'), a: load('australian') };
const common = load('english');

// Collapse the systematic differences to one key. ae/oe only inside a word (anaemia, oestrogen, manoeuvre), never
// in a Latin plural ending (patinae, mantoes), which would pair unrelated words.
const key = (w) => w
  .replace(/our/g, 'or')
  .replace(/is(e|es|ed|ing|er|ers|ation|ations|able|m|ms)$/, 'iz$1')
  .replace(/ys(e|es|ed|ing|er|ers)$/, 'yz$1')
  .replace(/([^aeiou])re(s|d)?$/, '$1er$2')
  .replace(/ogue(s)?$/, 'og$1')
  .replace(/ence(s)?$/, 'ense$1')
  .replace(/(ae|oe)(?=[a-z]{2})/g, 'e')
  .replace(/ll/g, 'l');

// Variants the key can't see (spelling only: word choices like mum/mom or whilst/while are not conversions).
const PAIRS = [
  ['grey', 'gray'], ['tyre', 'tire'], ['kerb', 'curb'], ['programme', 'program'], ['cheque', 'check'],
  ['plough', 'plow'], ['aluminium', 'aluminum'], ['mould', 'mold'], ['sceptic', 'skeptic'], ['sceptical', 'skeptical'],
  ['scepticism', 'skepticism'], ['pyjama', 'pajama'], ['ageing', 'aging'], ['judgement', 'judgment'],
  ['acknowledgement', 'acknowledgment'], ['jewellery', 'jewelry'], ['moustache', 'mustache'],
  ['sulphur', 'sulfur'], ['cosy', 'cozy'], ['artefact', 'artifact'], ['enrol', 'enroll'], ['fulfil', 'fulfill'],
  ['skilful', 'skillful'], ['wilful', 'willful'], ['instalment', 'installment'], ['enrolment', 'enrollment'],
  ['fulfilment', 'fulfillment'], ['axe', 'ax'], ['smoulder', 'smolder'], ['moult', 'molt'], ['storey', 'story'],
  ['draught', 'draft'], ['woollen', 'woolen'], ['gauge', 'gage'], ['yoghurt', 'yogurt'], ['cheque', 'check'],
];
const ENDINGS = ['', 's', 'es', 'ed', 'ing', 'er', 'ers', 'ly', 'ily', 'ies', 'ier', 'iest'];
// SCOWL quirks where the "other region's" form is also a different word: US "prize" is listed as the spelling of
// "prise" (lever open), but "a prized possession" must never become "prised".
// Same for "reprize" (US writers reprise a role too). "lilly" (Australian list) is a name, not a spelling of "lily".
const EXCLUDE = new Set(['prize', 'prise', 'reprise', 'reprize'].flatMap((w) => [w, w + 's', w + 'd', w.slice(0, -1) + 'ing'])
  .concat('lilly'));

const tagsOf = (w) => (common.has(w) ? '*' : Object.keys(REGIONS).filter((r) => REGIONS[r].has(w)).join(''));
const groups = new Map(); // key -> Set of forms
const add = (k, w) => { if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(w); };
const regionOnly = new Set(Object.values(REGIONS).flatMap((s) => [...s]));
const byKey = new Map();
for (const w of common) { const k = key(w); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w); }
for (const w of regionOnly) {
  if (EXCLUDE.has(w) || !/^[a-z]+$/.test(w)) continue;
  const k = key(w);
  add(k, w);
  for (const c of byKey.get(k) || []) add(k, c); // programme ~ program (every region has "program")
}
for (const [a, b] of PAIRS) {
  for (const end of ENDINGS) {
    const x = a + end, y = b + end;
    if (tagsOf(x) && tagsOf(y) && (regionOnly.has(x) || regionOnly.has(y))) { add('=' + x, x); add('=' + x, y); }
  }
}
const lines = new Set();
for (const forms of groups.values()) {
  if (forms.size < 2) continue;
  const tagged = [...forms].sort().map((w) => ({ w, t: tagsOf(w) }));
  if (tagged.every((f) => f.t === '*')) continue;
  lines.add(tagged.map((f) => f.w + ':' + f.t).join(' '));
}
const out = [...lines].sort();
fs.writeFileSync('data/regional.txt', out.join('\n') + '\n');
console.log(out.length, 'groups written to data/regional.txt');
