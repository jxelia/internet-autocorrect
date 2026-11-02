// What would the rules change? Runs them over text files (one paragraph per line) and lists every fix, so a person can
// read them. Usage, from test/ after copying engine.cjs and policy.cjs: deno run -A precision.cjs <folder> [--list]
// Non-English files show how often the language check lets a paragraph through; there, every fix is a wrong one.
const fs = require('fs');
const path = require('path');
const { findCorrections } = require('./engine.cjs');
const [dir, flag] = process.argv.slice(2);
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  const paras = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);
  const fixes = [];
  let touched = 0;
  for (const p of paras) {
    const found = findCorrections(p, { blockText: p });
    if (found.length) touched++;
    for (const f of found) fixes.push(`${f.original} → ${f.replacement} [${f.rule}]  …${p.slice(Math.max(0, f.start - 35), f.end + 25)}…`);
  }
  console.log(`${file}: ${paras.length} paragraphs, ${touched} changed, ${fixes.length} fixes`);
  if (flag === '--list') for (const f of fixes) console.log('   ' + f);
}
