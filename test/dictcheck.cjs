const fs = require('fs');
const words = new Set(fs.readFileSync('data/words.txt', 'utf8').split('\n'));
const src = fs.readFileSync('engine.js', 'utf8');
const block = src.slice(src.indexOf('`accomodate:'), src.indexOf('`\n    .split'));
const real = [], badRepl = [];
for (const pair of block.slice(1).split(/\s+/).filter(Boolean)) {
  const [bad, good] = pair.split(':');
  if (words.has(bad)) real.push(bad);
  for (const g of good.replace(/_/g, ' ').toLowerCase().split(' ')) if (!words.has(g) && !g.includes("'")) badRepl.push(pair);
}
const contractions = /CONTRACTIONS = \{([\s\S]*?)\};/.exec(src)[1].match(/(\w+):/g).map((x) => x.slice(0, -1));
console.log('misspellings that are real words:', real.join(' '));
console.log('corrections not in dictionary:', badRepl.join(' '));
console.log('apostrophe-less forms that are real words:', contractions.filter((c) => words.has(c)).join(' '));
// Word forms (policy.js): every listed over-regularised form must be a non-word, and its targets real words.
const P = require('./policy.cjs');
const formReal = [...P.REGULARISED.keys(), ...[...P.FLAT_ADVERBS].map((a) => a + 'ly')].filter((f) => words.has(f));
const formBad = [...P.REGULARISED.values()].flat().filter((f) => !words.has(f));
console.log('word forms that are real words:', formReal.join(' '));
console.log('word-form targets not in dictionary:', formBad.join(' '));
// Your spelling (data/regional.txt): every form must be a dictionary word, so a conversion never makes a non-word.
const regional = fs.readFileSync('data/regional.txt', 'utf8').split('\n').flatMap((l) => l.split(' ')).filter(Boolean)
  .map((f) => f.split(':')[0]).filter((w) => !words.has(w));
console.log('regional spellings not in dictionary:', regional.length, regional.slice(0, 20).join(' '));
