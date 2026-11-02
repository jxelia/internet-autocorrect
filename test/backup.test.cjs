// Restore merges a backup into the current install: nothing current is lost, nothing backed up is lost.
const { mergeBackup } = require('./backup.cjs');
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name); } };

const backup = {
  sync: { ignored: ['teh→the', 'yall'], disabledSites: ['a.com'], marks: 'squiggle', casualMode: 'never', ai: { engine: 'ollama' } },
  local: {
    learned: { 'wierd→weird': { original: 'wierd', replacement: 'weird', hits: 4, rejects: 0, auto: true } },
    log: [{ key: 'k1', time: 1 }, { key: 'k2', time: 2 }],
    reports: [{ id: 'r1' }], undone: [{ page: 'p', key: 'u1' }], undoCounts: { 'x→y': ['p#1'] },
    wl_wikipedia: { count: 4000 }, trace: [{ big: true }],
  },
};
// a fresh install: empty, defaults
const fresh = mergeBackup({ sync: {}, local: {} }, backup);
check('fresh: never-change list restored', JSON.stringify(fresh.sync.ignored) === JSON.stringify(['teh→the', 'yall']));
check('fresh: settings restored', fresh.sync.marks === 'squiggle' && fresh.sync.casualMode === 'never' && fresh.sync.ai.engine === 'ollama');
check('fresh: learned restored', fresh.local.learned['wierd→weird'].hits === 4);
check('fresh: history restored', fresh.local.log.length === 2 && fresh.local.log[0].key === 'k2');
check('fresh: wikipedia list restored', fresh.local.wl_wikipedia.count === 4000);
check('fresh: debug trace not restored', !('trace' in fresh.local));

// an install that already has its own lists
const used = mergeBackup({
  sync: { ignored: ['yall', 'gonna'], marks: 'underline' },
  local: {
    learned: { 'wierd→weird': { original: 'wierd', replacement: 'weird', hits: 1, rejects: 1, auto: false },
      'thier→their': { original: 'thier', replacement: 'their', hits: 2, rejects: 0 } },
    log: [{ key: 'k2', time: 2 }, { key: 'k3', time: 3 }], undone: [{ page: 'p', key: 'u2' }],
    undoCounts: { 'x→y': ['q#1'] }, wl_wikipedia: { count: 4100 },
  },
}, backup);
check('used: lists are unions', used.sync.ignored.length === 3 && used.local.log.length === 3 && used.local.undone.length === 2);
check('used: current learned kept', used.local.learned['thier→their'].hits === 2);
check('used: learned counts combine, a reject stops auto', used.local.learned['wierd→weird'].hits === 4 && used.local.learned['wierd→weird'].auto === false);
check('used: undo counts combine', used.local.undoCounts['x→y'].length === 2);
check('used: current wikipedia download kept', !('wl_wikipedia' in used.local));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
