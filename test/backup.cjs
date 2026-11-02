/*
 * Internet Autocorrect — backup and restore of everything the user has built up: never-change list, learned
 * fixes, history, reports, undone fixes, and settings. Runs in backup.html (a tab, because a popup closes
 * when a file picker opens). Restore MERGES into what's there, so restoring never loses anything.
 */
'use strict';

const APP = 'internet-autocorrect';
const SKIP_LOCAL = new Set(['trace', 'dictVersion', 'aiCache']); // debug log and caches aren't worth keeping

const union = (a = [], b = []) => [...new Set([...a, ...b])];
function unionBy(a = [], b = [], key) {
  const seen = new Map();
  for (const x of [...a, ...b]) if (!seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
}

// current + backup -> { sync, local } to write. Pure, so test/backup.test.cjs can check it.
function mergeBackup(current, backup) {
  const sync = { ...current.sync, ...backup.sync }; // settings: the backup's choices come back
  sync.ignored = union(current.sync.ignored, backup.sync.ignored);
  sync.disabledSites = union(current.sync.disabledSites, backup.sync.disabledSites);

  const cur = current.local, old = backup.local;
  const local = {};
  for (const [k, v] of Object.entries(old)) if (!SKIP_LOCAL.has(k) && !(k in cur)) local[k] = v;

  if (cur.learned || old.learned) {
    const learned = { ...(old.learned || {}) };
    for (const [k, item] of Object.entries(cur.learned || {})) {
      const o = learned[k];
      learned[k] = !o ? item : { ...o, ...item, hits: Math.max(o.hits || 0, item.hits || 0),
        rejects: Math.max(o.rejects || 0, item.rejects || 0), auto: !!(o.auto || item.auto) && !((o.rejects || 0) || (item.rejects || 0)) };
    }
    local.learned = learned;
  }
  if (cur.log || old.log) {
    local.log = unionBy(cur.log, old.log, (e) => e.key).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 1000);
  }
  if (cur.reports || old.reports) local.reports = unionBy(cur.reports, old.reports, (r) => r.id || JSON.stringify(r));
  if (cur.undone || old.undone) local.undone = unionBy(cur.undone, old.undone, (u) => u.page + '#' + u.key).slice(-1000);
  if (cur.applied || old.applied) local.applied = unionBy(cur.applied, old.applied, (u) => u.page + '#' + u.key).slice(-1000);
  if (cur.undoCounts || old.undoCounts) {
    local.undoCounts = { ...(old.undoCounts || {}) };
    for (const [k, v] of Object.entries(cur.undoCounts || {})) local.undoCounts[k] = union(local.undoCounts[k], v).slice(-5);
  }
  if (cur.wl_wikipedia) delete local.wl_wikipedia; // keep the current download
  local.dictVersion = Date.now(); // pages reload learned fixes
  return { sync, local };
}

function summary(data) {
  const s = data.sync || {}, l = data.local || {};
  return [
    `${(s.ignored || []).length} never-change`,
    `${Object.keys(l.learned || {}).length} learned fixes`,
    `${(l.log || []).length} history entries`,
    `${(l.reports || []).length} reports`,
    `${(l.undone || []).length} undone fixes`,
    l.wl_wikipedia ? 'Wikipedia list' : null,
  ].filter(Boolean).join(' · ');
}

if (typeof module !== 'undefined') module.exports = { mergeBackup, summary, APP };

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const say = (id, text) => { $(id).textContent = text; };
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  async function current() {
    const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
    return { sync, local };
  }

  async function showCurrent() {
    say('now', 'This install has: ' + summary(await current()));
  }

  $('backup').addEventListener('click', async () => {
    const { sync, local } = await current();
    for (const k of SKIP_LOCAL) delete local[k];
    const data = { app: APP, version: chrome.runtime.getManifest().version, exported: new Date().toISOString(), sync, local };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `internet-autocorrect-backup-${localDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say('backupStatus', `Saved to Downloads: ${a.download} (${summary(data)}).`);
  });

  $('file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let backup;
    try {
      backup = JSON.parse(await file.text());
      if (backup.app !== APP || !backup.sync || !backup.local) throw new Error('not an Internet Autocorrect backup');
    } catch (err) {
      say('restoreStatus', 'Couldn’t read that file: ' + err.message);
      return;
    }
    const merged = mergeBackup(await current(), backup);
    await chrome.storage.sync.set(merged.sync);
    await chrome.storage.local.set(merged.local);
    say('restoreStatus', `Restored from ${file.name} (backup made ${localDate(new Date(backup.exported))}). Refresh open tabs.`);
    e.target.value = '';
    showCurrent();
  });

  showCurrent();
}
