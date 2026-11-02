const { CATEGORIES, categoryOf } = window.IAC_Engine;
const CATS = Object.keys(CATEGORIES);
const DEFAULTS = {
  enabled: true,
  categories: { wrongword: true, spelling: true, typo: true, regional: true },
  disabledSites: [],
  ignored: [],
  marks: 'underline',
  hover: 'card',
  casualMode: 'auto',
  rememberAI: false,
  fixCopies: false,
  keepLog: false,
  region: 'off',
  ai: { engine: 'off', verify: true, read: true, url: 'http://localhost:11434', model: '' },
};
const AI_DEFAULTS = DEFAULTS.ai;

const $ = (id) => document.getElementById(id);
const TAB_KEY = 'iac:tab'; // localStorage, since it's read before the first paint
const state = { tab: 'page', filter: null, search: null, settings: DEFAULTS, page: [], log: [], tabId: null, host: null, reachable: false };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
};
function icon(name) {
  const box = document.createElement('span');
  box.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return box.firstChild;
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

// ---------------------------------------------------------------- data

async function sendToTab(msg) {
  if (state.tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(state.tabId, msg);
  } catch (_) {
    return null;
  }
}

// Old entries can carry a category that no longer exists (wordform); an unknown one would make renderItem throw
// halfway through a redraw, leaving the previous tab's rows under the new tab's chips.
const known = (it) => ({ ...it, category: categoryOf(it.category) });

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  try { state.host = new URL(tab.url).hostname || null; } catch (_) { state.host = null; }

  const got = await chrome.storage.sync.get(null);
  state.settings = {
    ...DEFAULTS, ...got,
    categories: { ...DEFAULTS.categories, ...(got.categories || {}) },
    ai: { ...AI_DEFAULTS, ...(got.ai || {}) },
  };
  if (got.showMarks === false && !got.marks) state.settings.marks = 'none';
  const local = await chrome.storage.local.get(['log', 'learned', 'wl_wikipedia']);
  state.log = (local.log || []).map(known);
  state.learned = local.learned || {};
  state.wiki = local.wl_wikipedia ? { count: local.wl_wikipedia.count, time: local.wl_wikipedia.time } : null;
  state.tabUrl = /^https?:/.test(tab?.url || '') ? tab.url : '';
  $('rUrl').value = state.tabUrl;
  state.reports = (await chrome.storage.local.get('reports')).reports || [];
  const sel = await sendToTab({ type: 'iac:getSelection' });
  state.selection = sel?.text || '';
  $('useSelection').hidden = !state.selection;

  const res = await sendToTab({ type: 'iac:getPage' });
  state.reachable = !!res;
  state.page = (res?.fixes ?? []).map(known);
  render();
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await chrome.storage.sync.set(patch);
  // content script restarts on settings change; give it a moment then refresh this page's list
  setTimeout(refreshPage, 400);
  render();
}

let pageSig = null;
async function refreshPage() {
  const res = await sendToTab({ type: 'iac:getPage' });
  // The 1.5 s poll only redraws when something changed: rebuilding the list makes Chrome re-hover whatever sits
  // under the last pointer position, which looked like Apply selecting itself.
  const sig = JSON.stringify([!!res, res?.fixes]);
  if (sig === pageSig) return;
  pageSig = sig;
  state.reachable = !!res;
  state.page = (res?.fixes ?? []).map(known);
  render();
}

// ---------------------------------------------------------------- render

function showTab() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === state.tab);
  $('listView').hidden = state.tab !== 'page' && state.tab !== 'history';
  $('settingsView').hidden = state.tab !== 'settings';
  $('reportView').hidden = state.tab !== 'report';
}

function render() {
  const s = state.settings;
  $('enabled').checked = s.enabled;
  $('host').textContent = state.host || 'this page';
  $('siteEnabled').checked = !!state.host && !s.disabledSites.includes(state.host);
  $('siteEnabled').disabled = !state.host || !s.enabled;
  document.querySelector('.site').style.opacity = s.enabled ? 1 : 0.5;

  showTab();
  if (state.tab === 'settings') renderSettings();
  else if (state.tab === 'report') renderReports();
  else renderList();
}

function renderList() {
  const items = state.tab === 'page' ? state.page : state.log;

  const counts = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (const it of items) counts[it.category]++;
  const chips = $('chips');
  chips.replaceChildren(
    // Your spelling is a setting, not a kind of mistake: its chip shows only on pages where it changed something
    ...CATS.filter((cat) => cat !== 'regional' || counts[cat] || state.filter === cat).map((cat) => el('button', {
      class: 'chip' + (state.filter === cat ? ' on' : ''),
      style: state.filter === cat ? `color:${CATEGORIES[cat].color}` : '',
      title: state.filter === cat ? 'Show all' : `Only show ${CATEGORIES[cat].label.toLowerCase()}`,
      onclick: () => { state.filter = state.filter === cat ? null : cat; render(); },
    },
    el('span', { class: 'dot', style: `background:${CATEGORIES[cat].color}` }),
    el('span', { style: 'color:var(--text)' }, CATEGORIES[cat].label),
    el('span', { class: 'n' }, String(counts[cat])))),
  );

  $('chips').hidden = state.search != null;
  $('searchBox').hidden = state.search == null;
  $('searchOpen').hidden = state.search != null;
  const q = (state.search || '').trim().toLowerCase();
  const rows = items.filter((it) => !state.filter || it.category === state.filter)
    .map((it) => renderItem(it))
    // Search matches everything the entry shows: the change, its context and the line under it.
    .filter((li) => !q || li.textContent.toLowerCase().includes(q));
  if (q) for (const li of rows.slice(0, 300)) highlight(li, q);
  $('list').replaceChildren(...rows.slice(0, 300));

  let empty = '';
  if (!rows.length) {
    if (state.tab === 'page') {
      if (!state.settings.enabled) empty = 'Autocorrect is turned off.';
      else if (state.host && state.settings.disabledSites.includes(state.host)) empty = `Turned off on ${state.host}.`;
      else if (!state.reachable) empty = "Can't read this page. Browser pages and the Web Store are off-limits; for other pages, try reloading.";
      else if (q) empty = 'No fixes on this page match.';
      else empty = state.filter ? 'Nothing in this category on this page.' : 'Nothing to fix on this page. Nice writing, internet.';
    } else {
      empty = q ? 'No fixes in your history match.' : state.filter ? 'Nothing in this category yet.' : 'Corrections from every page you read will collect here.';
    }
  }
  $('empty').textContent = empty;
  $('reportBar').hidden = state.tab !== 'page' || !state.tabUrl;
  $('checkBar').hidden = $('reportBar').hidden || state.settings.ai.engine === 'off';
  if ($('reportBar').hidden) $('reportStatus').textContent = '';
}

// Wraps each search match in the entry's text (not its buttons) in <span class="hit">.
function highlight(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement.closest('.actions') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let i = lower.indexOf(q);
    if (i < 0) continue;
    const parts = [];
    let last = 0;
    for (; i >= 0; i = lower.indexOf(q, last)) {
      if (i > last) parts.push(text.slice(last, i));
      parts.push(el('span', { class: 'hit' }, text.slice(i, i + q.length)));
      last = i + q.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
}

const REGION_FLAG = { u: '🇺🇸', b: '🇬🇧', c: '🇨🇦', a: '🇦🇺' };

function renderItem(it) {
  const color = CATEGORIES[it.category].color;
  const isPage = state.tab === 'page';
  const actions = [];
  if (isPage) {
    const setReverted = async (reverted) => {
      await sendToTab({ type: 'iac:setReverted', id: it.id, reverted });
      refreshPage();
    };
    if (it.vetoed || it.pending) actions.push(el('button', { onclick: () => setReverted(!it.reverted) }, 'Apply'));
    else {
      const undo = el('button', { class: 'icon undo', title: 'Undo', 'aria-label': 'Undo', onclick: () => setReverted(true) }, icon('undo'));
      const redo = el('button', { class: 'icon redo', title: 'Redo', 'aria-label': 'Redo', onclick: () => setReverted(false) }, icon('redo'));
      if (it.reverted) undo.disabled = true; else redo.disabled = true;
      actions.push(undo, redo);
    }
  } else {
    actions.push(el('button', {
      title: 'Go to the page and show this change',
      onclick: async () => {
        const res = await chrome.runtime.sendMessage({ type: 'iac:open', entry: it }).catch(() => null);
        if (!res || !res.ok) chrome.tabs.create({ url: it.link || it.url });
        window.close();
      },
    }, 'Open'));
  }

  const meta = isPage
    ? (it.pending ? el('div', { class: 'meta' }, 'Checking with the AI')
      : it.vetoed ? el('div', { class: 'meta' }, 'AI kept the original')
        : it.missing ? el('div', { class: 'meta', title: 'Remembered from an earlier visit. Redo makes the change next time this text is on the page.' }, 'Undone, not on the page now')
          : it.reverted ? el('div', { class: 'meta' }, 'Undone')
            : null)
    : el('div', { class: 'meta' },
      el('span', {}, it.host), el('span', {}, '·'), el('span', {}, timeAgo(it.time)),
      it.reverted ? el('span', {}, '· undone') : null);

  // Your spelling: a muted flag of the region whose spelling the page used, under the buttons; the original
  // isn't wrong (POLICY.md §7). The name ("US spelling") is in its tooltip.
  const flags = it.category === 'regional' && it.variety
    ? [...it.variety].map((t) => REGION_FLAG[t]).filter(Boolean).join('') : '';
  if (flags) actions.push(el('span', { class: 'flag', title: window.IAC_Policy.varietyName(it.variety) }, flags));

  // On this page the row itself shows the fix (scrolls to it and flashes it); its buttons do their own thing.
  const jumps = isPage && !it.missing;
  return el('li', {
    class: 'item' + (it.reverted ? ' reverted' : '') + (jumps ? ' jumps' : ''),
    ...(jumps ? { title: 'Show on the page', onclick: (e) => { if (!e.target.closest('button')) sendToTab({ type: 'iac:jump', id: it.id }); } } : {}),
  },
    el('div', { class: 'bar', style: `background:${color}` }),
    // The change on the left, its context beside it (not under it), the buttons on the right.
    el('div', { class: 'change' },
      el('span', { class: it.category === 'regional' ? 'from plain' : 'from' }, it.original),
      el('span', { class: 'arrow' }, '→'),
      el('span', { class: 'to' }, it.replacement),
      it.source === 'ai' ? el('span', { class: 'aiTag', title: it.reason || 'Found by the AI checker', style: 'margin-left:6px' }, 'AI') : null),
    el('div', { class: 'body' },
      el('div', { class: 'ctx', title: it.before + (it.reverted ? it.original : it.replacement) + it.after }, it.before, el('mark', {}, it.reverted ? it.original : it.replacement), it.after),
      meta),
    el('div', { class: 'actions' }, actions));
}

function setSeg(id, value) {
  for (const b of $(id).querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === value);
    b.setAttribute('aria-checked', String(b.dataset.v === value));
  }
}

function renderSettings() {
  const s = state.settings;

  // AI
  setSeg('aiEngine', s.ai.engine);
  $('aiExplain').textContent = {
    off: 'Only the built-in rules run. Turn on an AI to catch mistakes the rules miss and skip words people are only talking about.',
    small: 'A small model that comes with the extension: it finds real words used by mistake (their/there, loose/lose). Works in any browser, stays cool, and pages are never sent anywhere. Chrome on-device or Ollama add it to what they catch.',
    nano: 'Uses Gemini Nano, the small model built into Chrome. It runs on this computer; pages are never sent anywhere.',
    ollama: 'Uses a model in the free Ollama app on this computer (ollama.com). Pages never leave your computer.',
  }[s.ai.engine];
  $('aiStatusRow').hidden = s.ai.engine === 'off';
  $('ollamaFields').hidden = s.ai.engine !== 'ollama';
  $('aiVerifyRow').hidden = s.ai.engine === 'off';
  $('aiVerify').checked = s.ai.verify;
  $('aiReadRow').hidden = s.ai.engine === 'off';
  $('aiRead').checked = !!s.ai.read;
  $('rememberRow').hidden = s.ai.engine === 'off';
  if (s.ai.engine === 'off') $('rememberWarn').hidden = true;
  $('rememberAI').checked = s.rememberAI === true;
  $('fixCopies').checked = s.fixCopies === true;
  $('keepLog').checked = s.keepLog === true;
  if (document.activeElement !== $('ollamaUrl')) $('ollamaUrl').value = s.ai.url;

  const descriptions = {
    wrongword: 'Not the word the sentence needs: their/there/they’re, then/than, could of, a apple → an apple, fastly → fast, goed → went, on a weekly bases → basis.',
    spelling: 'Words that aren’t words: definately, recieve, seperate.',
    typo: 'Slips of the fingers: missing apostrophes (dont), spaces (it s), doubled words (the the).',
  };
  $('catToggles').replaceChildren(...CATS.filter((cat) => descriptions[cat]).map((cat) => {
    const input = el('input', { type: 'checkbox' });
    input.checked = s.categories[cat];
    input.addEventListener('change', () => saveSettings({ categories: { ...s.categories, [cat]: input.checked } }));
    return el('label', { class: 'row' }, input,
      el('span', {},
        el('b', {}, el('span', { class: 'dot', style: `background:${CATEGORIES[cat].color}` }), CATEGORIES[cat].label),
        el('small', {}, descriptions[cat])));
  }));

  setSeg('casualMode', s.casualMode);
  $('casualExplain').textContent = {
    auto: 'Left alone in casual posts (lowercase, lol, emoji…), fixed in carefully written ones. Undoing the same change in two places adds it to the never-change list.',
    fix: 'Always fixed, however casual the writing.',
    never: 'Never fixed. Misspellings and mixed-up words are still fixed.',
  }[s.casualMode] || '';
  setSeg('region', s.region);
  $('regionExplain').textContent = s.region === 'off'
    ? 'Every region’s spelling is left as written.'
    : `Spellings from other regions are shown the ${{ us: 'US', uk: 'UK', ca: 'Canadian', au: 'Australian' }[s.region]} way, marked in teal. Names, quotes and posts about spelling stay as written.`;
  setSeg('marks', s.marks);
  setSeg('hover', s.hover);
  $('hoverExplain').textContent = s.hover === 'compact'
    ? 'A small box over the word shows what was there before. Click it to undo; press and hold to never change it again.'
    : 'A card shows what changed and why, with Undo and Never change this buttons.';

  $('ignoredList').replaceChildren(...(s.ignored.length
    ? s.ignored.map((k) => el('li', {}, el('span', {}, k.replace('→', ' → ')),
      el('button', { class: 'link', onclick: () => saveSettings({ ignored: s.ignored.filter((x) => x !== k) }) }, 'Remove')))
    : [el('li', { class: 'none' }, 'Nothing yet. Add a word above, or hover a change on any page and pick “Never change this”.')]));
  $('clearIgnored').hidden = !s.ignored.length;

  const learned = Object.entries(state.learned || {})
    .filter(([, i]) => i.source !== 'ai' || i.auto || i.hits >= 2)
    .sort((a, b) => (b[1].time || 0) - (a[1].time || 0));
  $('learnedCount').textContent = learned.length ? String(learned.length) : '';
  $('learnedList').replaceChildren(...(learned.length
    ? learned.map(([key, i]) => el('li', {},
      el('span', {}, `${i.original} → ${i.replacement}`,
        el('span', { class: 'src' }, i.source === 'you' ? 'you' : i.auto ? `AI · ${i.hits}×` : `AI · ${i.hits}× · learning`)),
      el('button', { class: 'link', onclick: () => saveLearned(key, null) }, 'Remove')))
    : [el('li', { class: 'none' }, 'Nothing learned yet.')]));

  $('wikiStatus').textContent = state.wiki
    ? `${state.wiki.count.toLocaleString()} misspellings added ${timeAgo(state.wiki.time)}.`
    : 'About 4,000 misspellings collected by Wikipedia editors. Downloads the list once from wikipedia.org.';
  $('wikiImport').textContent = state.wiki ? 'Update' : 'Add';

  $('sitesList').replaceChildren(...(s.disabledSites.length
    ? s.disabledSites.map((h) => el('li', {}, el('span', {}, h),
      el('button', { class: 'link', onclick: () => saveSettings({ disabledSites: s.disabledSites.filter((x) => x !== h) }) }, 'Turn on')))
    : [el('li', { class: 'none' }, 'No sites.')]));
}

// ---------------------------------------------------------------- AI status

// The reading pass rests itself when the model can't keep up (background.js, noteAiOutcome).
async function showReadPause() {
  const { readPause } = (await chrome.storage.session?.get('readPause')) || {};
  const paused = !!readPause && Date.now() < readPause.until && state.settings.ai.read;
  $('aiPaused').hidden = !paused;
  if (paused) {
    const at = new Date(readPause.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('aiPaused').textContent = `Reading is resting until ${at}: the AI has been too slow on this computer. Rule fixes still work.`;
  }
}

async function refreshAiStatus() {
  const ai = state.settings.ai;
  showReadPause();
  if (ai.engine === 'off') return;
  const dot = $('aiDot'), label = $('aiStatus'), action = $('aiAction');
  dot.className = 'statusDot';
  label.textContent = 'Checking…';
  action.hidden = true;
  let st;
  try {
    st = await chrome.runtime.sendMessage({ type: 'iac:aiStatus', ai });
  } catch (e) {
    st = { state: 'error', error: String(e.message || e) };
  }
  if (state.settings.ai.engine !== ai.engine) return;
  const set = (cls, text, act) => {
    $('aiTest').hidden = cls !== 'ok';
    dot.className = 'statusDot ' + cls;
    label.textContent = text;
    action.hidden = !act;
    if (act) { action.textContent = act.label; action.onclick = act.run; }
  };
  if (ai.engine === 'small') return set('ok', 'Ready. Runs on this computer.');
  if (ai.engine === 'nano') {
    switch (st && st.state) {
      case 'available': return set('ok', 'Ready. Runs on this computer.');
      case 'downloadable': return set('warn', 'One-time model download needed (a few GB).', { label: 'Download', run: downloadNano });
      case 'downloading': return set('warn', 'Downloading the model…', { label: 'Check again', run: refreshAiStatus });
      case 'unavailable': return set('bad', 'This computer can’t run Chrome’s built-in AI. Try Built-in or the Ollama app instead.');
      default: return set('bad', 'Not available in this version of Chrome (needs Chrome 138+ on a desktop). Try Built-in or Ollama.');
    }
  }
  // ollama
  switch (st && st.state) {
    case 'available': {
      const models = st.models || [];
      const sel = $('ollamaModel');
      sel.replaceChildren(...(models.length ? models : ['(no models installed)']).map((m) => el('option', { value: m }, m)));
      if (models.length && !models.includes(ai.model)) {
        const pick = models.find((m) => /gemma|qwen|llama|mistral|phi/i.test(m)) || models[0];
        saveSettings({ ai: { ...ai, model: pick } });
        sel.value = pick;
      } else if (models.length) sel.value = ai.model;
      return models.length
        ? set('ok', 'Connected to Ollama.')
        : set('warn', 'Ollama is running but has no models. In Terminal run: ollama pull gemma3:4b');
    }
    case 'forbidden':
      return set('bad', 'Ollama refused the extension. Set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.', { label: 'Retry', run: refreshAiStatus });
    default:
      return set('bad', 'Can’t reach Ollama. Is the app open?', { label: 'Retry', run: refreshAiStatus });
  }
}

// Run the real AI on two known sentences: one real mistake, one word that is only being talked about.
async function testAi() {
  const out = $('aiTestResult');
  out.textContent = 'Asking the AI… (the first run can take a little while)';
  $('aiTest').disabled = true;
  const t0 = performance.now();
  const s1 = 'For issues were the editor says no, I ask another person to start the work.';
  const s2 = 'As a Scot, only their/there are homophones. They’re is not pronounced the same.';
  const res = await chrome.runtime.sendMessage({
    type: 'iac:proofread',
    req: {
      text: s1 + ' ' + s2,
      find: false,
      candidates: [
        { original: 'were', replacement: 'where', sentence: s1, fixedSentence: s1.replace('were', 'where') },
        { original: 'They’re', replacement: 'There', sentence: 'They’re is not pronounced the same.', fixedSentence: 'There is not pronounced the same.' },
      ],
    },
  });
  $('aiTest').disabled = false;
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (!res || !res.ok) { out.textContent = 'The AI didn’t answer: ' + ((res && res.error) || 'no reply'); return; }
  const [a, b] = res.result.checks.map((c) => c.ok);
  out.textContent = `${a ? '✓' : '✗'} fixes “issues were the editor says” → where  ·  ` +
    `${b ? '✗' : '✓'} leaves “They’re is not pronounced” alone  ·  ${secs}s`;
}
$('aiTest').addEventListener('click', testAi);

async function downloadNano() {
  const label = $('aiStatus');
  if (typeof LanguageModel === 'undefined') { label.textContent = 'Chrome’s AI isn’t available here.'; return; }
  $('aiAction').hidden = true;
  try {
    const session = await LanguageModel.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          label.textContent = `Downloading the model… ${Math.round(e.loaded * 100)}% (you can close this; it keeps going)`;
        });
      },
    });
    session.destroy();
    refreshAiStatus();
  } catch (e) {
    label.textContent = 'Download failed: ' + (e.message || e);
  }
}

// ---------------------------------------------------------------- learned list

// "wrong → right", "wrong -> right", "wrong > right" or "wrong, right"
function parsePair(text) {
  const m = /^\s*(.+?)\s*(?:→|->|=>|>|,)\s*(.+?)\s*$/.exec(text);
  return m ? [m[1], m[2]] : null;
}

async function saveLearned(key, item) {
  const { learned = {} } = await chrome.storage.local.get('learned');
  if (item) learned[key] = item;
  else delete learned[key];
  await chrome.storage.local.set({ learned, dictVersion: Date.now() });
  state.learned = learned;
  render();
}

function teach(wrong, right) {
  const original = wrong.trim().toLowerCase();
  return saveLearned((original + '→' + right.trim()).toLowerCase(), {
    original, replacement: right.trim(), category: 'spelling', hits: 0, rejects: 0,
    source: 'you', auto: /^[a-z']+$/.test(original), time: Date.now(),
  });
}

// ---------------------------------------------------------------- reports

const KIND_LABEL = { missed: 'Missed', wrongfix: 'Wrong fix', other: 'Other' };

function renderReports() {
  const list = state.reports || [];
  $('exportReports').hidden = $('copyReports').hidden = !list.length;
  $('reportList').replaceChildren(...(list.length
    ? list.map((r) => el('li', {},
      el('div', {},
        el('div', { class: 'q' }, `“${r.text}”`),
        el('div', { class: 'sub' },
          `${KIND_LABEL[r.kind] || r.kind}` + (r.wrong || r.right ? ` · ${r.wrong || '?'} → ${r.right || '?'}` : '') +
          (r.url ? ` · ${r.url}` : '') + ` · ${timeAgo(r.time)}`),
        r.note ? el('div', { class: 'sub' }, r.note) : null),
      el('button', { class: 'link', onclick: () => saveReports(list.filter((x) => x !== r)) }, 'Delete')))
    : [el('li', { class: 'none' }, 'No reports yet.')]));
}

async function saveReports(reports) {
  state.reports = reports;
  await chrome.storage.local.set({ reports });
  render();
}

function reportsExport() {
  return JSON.stringify({
    app: 'Internet Autocorrect',
    version: chrome.runtime.getManifest().version,
    exported: new Date().toISOString(),
    reports: (state.reports || []).map(({ time, ...r }) => ({ ...r, time: new Date(time).toISOString() })),
  }, null, 2);
}

$('rKind').addEventListener('change', () => {
  $('rTeachRow').querySelector('small').textContent = $('rKind').value === 'wrongfix'
    ? 'Never make this change again (it changed “Should be” into “Wrong word”).'
    : 'Always change “Wrong word” to “Should be” from now on.';
});
$('useSelection').addEventListener('click', () => { $('rText').value = state.selection; $('rText').focus(); });
$('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('rText').value.trim();
  if (!text) return;
  const report = {
    kind: $('rKind').value,
    url: $('rUrl').value.trim(),
    text,
    wrong: $('rWrong').value.trim(),
    right: $('rRight').value.trim(),
    note: $('rNote').value.trim(),
    time: Date.now(),
  };
  report.taught = $('rTeach').checked && !!report.wrong && !!report.right && report.kind !== 'wrongfix';
  await saveReports([report, ...(state.reports || [])]);
  if (report.taught) await teach(report.wrong, report.right);
  if (report.kind === 'wrongfix' && report.wrong && report.right && $('rTeach').checked) {
    // "it changed X to Y and shouldn't have" -> never make that change again
    const key = (report.right + '→' + report.wrong).toLowerCase();
    if (!state.settings.ignored.includes(key)) await saveSettings({ ignored: [...state.settings.ignored, key] });
  }
  for (const id of ['rText', 'rWrong', 'rRight', 'rNote']) $(id).value = '';
  $('rTeach').checked = false;
  $('rStatus').textContent = report.taught ? 'Saved, and it will fix this from now on.' : 'Saved. Thanks!';
  setTimeout(() => { $('rStatus').textContent = ''; }, 2500);
});
$('exportReports').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([reportsExport()], { type: 'application/json' }));
  const a = el('a', { href: url, download: `autocorrect-reports-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('copyReports').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(reportsExport());
  e.target.textContent = 'Copied';
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
});

// ---------------------------------------------------------------- events

$('enabled').addEventListener('change', (e) => saveSettings({ enabled: e.target.checked }));
$('siteEnabled').addEventListener('change', (e) => {
  const sites = new Set(state.settings.disabledSites);
  if (e.target.checked) sites.delete(state.host);
  else sites.add(state.host);
  saveSettings({ disabledSites: [...sites] });
});
for (const id of ['marks', 'hover', 'casualMode', 'region']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) saveSettings({ [id]: b.dataset.v });
  });
}
$('aiEngine').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  await saveSettings({ ai: { ...state.settings.ai, engine: b.dataset.v } });
  refreshAiStatus();
});
$('aiVerify').addEventListener('change', (e) => saveSettings({ ai: { ...state.settings.ai, verify: e.target.checked } }));
$('aiRead').addEventListener('change', (e) => saveSettings({ ai: { ...state.settings.ai, read: e.target.checked } }));
$('rememberAI').addEventListener('change', (e) => {
  // Turning it off deletes the answers, so it stays on until the warning is answered.
  if (e.target.checked) {
    $('rememberWarn').hidden = true;
    saveSettings({ rememberAI: true });
  } else {
    e.target.checked = true;
    $('rememberWarn').hidden = false;
  }
});
$('rememberKeep').addEventListener('click', () => { $('rememberWarn').hidden = true; });
$('rememberOff').addEventListener('click', () => {
  $('rememberWarn').hidden = true;
  $('rememberAI').checked = false;
  saveSettings({ rememberAI: false });
});
$('fixCopies').addEventListener('change', (e) => saveSettings({ fixCopies: e.target.checked }));
$('keepLog').addEventListener('change', (e) => saveSettings({ keepLog: e.target.checked }));
$('ollamaUrl').addEventListener('change', async (e) => {
  await saveSettings({ ai: { ...state.settings.ai, url: e.target.value.trim() || AI_DEFAULTS.url } });
  refreshAiStatus();
});
$('ollamaModel').addEventListener('change', (e) => saveSettings({ ai: { ...state.settings.ai, model: e.target.value } }));
$('ignoreForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('ignoreInput').value.trim();
  if (!v) return;
  const pair = parsePair(v);
  const key = (pair ? pair[0] + '→' + pair[1] : v).toLowerCase();
  if (!state.settings.ignored.includes(key)) saveSettings({ ignored: [...state.settings.ignored, key] });
  $('ignoreInput').value = '';
});
$('learnForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pair = parsePair($('learnInput').value);
  e.currentTarget.classList.toggle('err', !pair);
  if (!pair) return;
  await teach(pair[0], pair[1]);
  $('learnInput').value = '';
});
$('learnInput').addEventListener('input', () => $('learnForm').classList.remove('err'));
$('wikiImport').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  $('wikiStatus').textContent = 'Downloading the list from wikipedia.org…';
  const res = await chrome.runtime.sendMessage({ type: 'iac:importWikipedia' });
  btn.disabled = false;
  if (res && res.ok) {
    state.wiki = { count: res.count, time: Date.now() };
    render();
  } else {
    $('wikiStatus').textContent = 'Couldn’t get the list: ' + ((res && res.error) || 'unknown error');
  }
});
// ---------------------------------------------------------------- diagnostics (the decision trace)

const SENT_NOTE = 'Saved to Downloads › internet-autocorrect-reports.';
const LOG_OFF_NOTE = 'The debug log is off, so the report has only your settings. Turn on Keep a debug log ' +
  '(Settings › Diagnostics), reload the page, then send it again.';

async function report(opts) {
  return (await chrome.runtime.sendMessage({ type: 'iac:report', url: state.tabUrl, ...opts })) || { ok: false };
}
async function copyReport(statusId) {
  const res = await report({});
  if (!res.ok) { $(statusId).textContent = 'Couldn’t build the report: ' + (res.error || 'no reply'); return; }
  await navigator.clipboard.writeText(res.json);
  $(statusId).textContent = res.logOff ? LOG_OFF_NOTE : res.entries ? `Copied ${res.entries} decisions for this page.` : 'Nothing logged for this page yet. Reload it with the extension on.';
}
async function sendReport(statusId, all) {
  const res = await report({ save: true, all });
  $(statusId).textContent = res.ok ? (res.logOff ? LOG_OFF_NOTE : SENT_NOTE) : 'Couldn’t save the report: ' + (res.error || 'no reply');
}
// Saving a report needs the downloads permission, which only the unpacked copy has (package.sh takes it out).
if (!chrome.runtime.getManifest().permissions?.includes('downloads')) {
  $('reportBar').remove();
  $('downloadTrace').remove();
}
$('checkPage').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Checking the whole page…';
  await chrome.tabs.sendMessage(state.tabId, { type: 'iac:checkPage' }).catch(() => {});
});
$('sendReport')?.addEventListener('click', () => sendReport('reportStatus', false));
$('copyReport')?.addEventListener('click', () => copyReport('reportStatus'));
$('copyTrace').addEventListener('click', () => copyReport('traceStatus'));
$('downloadTrace')?.addEventListener('click', () => sendReport('traceStatus', true));
$('openBackup').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('clearTrace').addEventListener('click', async () => {
  await chrome.storage.local.set({ trace: [] });
  $('traceStatus').textContent = 'Log cleared.';
});
$('clearIgnored').addEventListener('click', () => saveSettings({ ignored: [] }));
$('clearLog').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = `Click again to delete ${state.log.length} entries`;
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Clear correction history'; }, 3000);
    return;
  }
  await chrome.storage.local.set({ log: [] });
  state.log = [];
  btn.dataset.confirm = '';
  btn.textContent = 'History cleared';
  render();
});
$('searchOpen').addEventListener('click', () => {
  state.search = '';
  state.filter = null;
  render();
  $('searchInput').focus();
});
function closeSearch() {
  state.search = null;
  $('searchInput').value = '';
  render();
}
$('searchClose').addEventListener('click', closeSearch);
$('searchInput').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    try { localStorage.setItem(TAB_KEY, state.tab); } catch (_) { /* not critical */ }
    render();
    if (state.tab === 'settings') refreshAiStatus();
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.log) {
    state.log = (changes.log.newValue || []).map(known);
    render();
  }
  if (area === 'local' && changes.learned) {
    state.learned = changes.learned.newValue || {};
    if (state.tab === 'settings') render();
  }
});

// No hover styling while the pointer is outside the popup (Chrome can keep a stale pointer position).
document.documentElement.addEventListener('mouseleave', () => document.body.classList.add('pointer-out'));
document.addEventListener('mousemove', () => document.body.classList.remove('pointer-out'));

// AI fixes arrive a moment after the rules, so keep this page's list fresh while the popup is open.
setInterval(() => { if (state.tab === 'page' && !document.hidden) refreshPage(); }, 1500);

// Reopen on the tab it was closed on. Shown now, so the first paint and popup-tabs.js start on it.
try {
  const tab = localStorage.getItem(TAB_KEY);
  if (document.querySelector(`.tabs button[data-tab="${tab}"]`)) state.tab = tab;
} catch (_) { /* not critical */ }
showTab();

load().then(() => { if (state.tab === 'settings') refreshAiStatus(); });
