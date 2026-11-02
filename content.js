/*
 * Internet Autocorrect — content script.
 *
 * Rewrites text nodes in place (node.data) and marks each change with the CSS Custom Highlight API,
 * so no wrapper elements are inserted into the page. That keeps React/Vue-driven sites like Reddit
 * from tripping over foreign DOM nodes.
 *
 * Text is handled per paragraph ("block"): the rule engine sees the whole paragraph so it can tell when
 * a word is being talked about, and when an AI engine is on, each visible paragraph is sent to it
 * (on this computer only) to confirm the rule fixes and find what the rules missed.
 */
(() => {
  'use strict';
  if (window.__iacLoaded) return;
  window.__iacLoaded = true;

  const { findCorrections, CATEGORIES, categoryOf, isQuoted, isKnownMisspelling, isMentioned } = window.IAC_Engine;
  const P = window.IAC_Policy;
  const CATS = Object.keys(CATEGORIES);

  const AI_DEFAULTS = { engine: 'off', verify: true, read: true, url: 'http://localhost:11434', model: '' };
  const DEFAULTS = {
    enabled: true,
    categories: { wrongword: true, spelling: true, typo: true, regional: true },
    disabledSites: [],
    ignored: [],
    marks: 'underline', // underline | squiggle | none
    hover: 'card', // card | compact
    casualMode: 'auto', // auto | fix | never — casual spellings like "dont", "ive", "would of" (POLICY.md §4)
    region: 'off', // off | us | uk | ca | au — show other regions' spellings in this one (POLICY.md §7)
    ai: AI_DEFAULTS,
  };

  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp',
    'var', 'svg', 'math', 'template', 'iframe', 'title', '[contenteditable]', '[translate="no"]',
    '.notranslate', '.iac-ignore', '#iac-tooltip-host', '#iac-marks-host',
  ].join(',');
  const BLOCK_SELECTOR = 'p,li,td,th,dd,dt,h1,h2,h3,h4,h5,h6,blockquote,figcaption,summary,caption,legend,' +
    'article,section,div,main,body';
  const EMPHASIS_SELECTOR = 'em,i,b,strong,q,mark,u,cite,dfn';
  // What one writer wrote, on sites whose markup is known. Reddit: the text of a post or comment, without its replies.
  const COMMENT_SELECTOR = '[id$="-rtjson-content"]';
  const HOLD_MS = 650;
  const MAX_AI_BLOCKS = 400;

  let settings = { ...DEFAULTS };
  let active = false;
  let nextId = 1;
  let dict = null;
  let regional = null; // word -> the reader's spelling, when settings.region is on

  // textNode -> { orig, written, fixes: [fix] }
  // fix: { id, start, end, original, replacement, category, rule, source, reason, state, range, pos, logKey }
  // state: 'pending' (waiting for the AI) | 'on' | 'reverted' (undone) | 'vetoed' (AI said leave it)
  const records = new WeakMap();
  const trackedNodes = new Set();
  const byId = new Map(); // id -> { node, fix }
  const loggedKeys = new Set();
  const shadowRoots = new Set();
  let blockState = new WeakMap(); // block element -> { sig, status }
  let aiBlocksSent = 0;

  const aiOn = () => settings.ai.engine !== 'off';
  const verifyFirst = () => aiOn() && settings.ai.verify;

  // ------------------------------------------------------------------ highlights

  const supportsHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  const highlights = {};
  if (supportsHighlights) {
    for (const cat of CATS) highlights[cat] = new Highlight();
    highlights.flash = new Highlight();
    highlights.flash.priority = 10;
  }

  function highlightCss() {
    const marks = settings.marks;
    return CATS.map((cat) => {
      const c = CATEGORIES[cat].color;
      if (marks === 'squiggle') return ''; // drawn by the squiggle layer instead (CSS can't place an overline)
      return `::highlight(iac-${cat}) { text-decoration: underline 2px ${c}; text-underline-offset: 3px;
        text-decoration-skip-ink: none; background-color: ${c}1f; }`;
    }).join('\n') + '\n::highlight(iac-flash) { background-color: #facc15aa; }';
  }

  const sheets = [];
  function applyMarkStyle() {
    if (!supportsHighlights) return;
    const css = highlightCss();
    let style = document.getElementById('iac-highlight-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'iac-highlight-style';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
    for (const sheet of sheets) sheet.replaceSync(css);
    for (const [name, hl] of Object.entries(highlights)) {
      if (settings.marks !== 'none' || name === 'flash') CSS.highlights.set('iac-' + name, hl);
      else CSS.highlights.delete('iac-' + name);
    }
    watchLayout(active);
    scheduleSquiggles();
  }

  // ------------------------------------------------------------------ squiggle-above layer
  // A thin wavy line above the word, the same distance above the letters as a wavy underline sits
  // below them. Positioned from the text's real font metrics and redrawn when the page moves.

  const waveCache = {};
  function waveImage(color) {
    if (!waveCache[color]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3" viewBox="0 0 4 3">` +
        `<path d="M0 1.5 Q1 0.4 2 1.5 T4 1.5" fill="none" stroke="${color}" stroke-width="0.55" stroke-opacity="0.7"/></svg>`;
      waveCache[color] = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    }
    return waveCache[color];
  }

  const metricsCache = new Map();
  const measureCtx = document.createElement('canvas').getContext('2d');
  function fontMetrics(el) {
    const cs = getComputedStyle(el);
    const key = cs.font;
    if (!metricsCache.has(key)) {
      measureCtx.font = key;
      const m = measureCtx.measureText('Hdlbx');
      const size = parseFloat(cs.fontSize) || 16;
      metricsCache.set(key, {
        size,
        fontAscent: m.fontBoundingBoxAscent || size * 0.92,
        inkAscent: m.actualBoundingBoxAscent || size * 0.72, // top of tall letters above the baseline
      });
    }
    return metricsCache.get(key);
  }

  let squiggleFrame = 0;
  let lastSquiggles = '';
  function scheduleSquiggles() {
    if (squiggleFrame) return;
    squiggleFrame = requestAnimationFrame(drawSquiggles);
  }

  // top of the 3px squiggle over a word's line box r (window coordinates)
  function squiggleTop(r, metrics) {
    const baseline = r.top + metrics.fontAscent;
    const gap = Math.max(1.5, metrics.size * 0.1); // what a wavy underline leaves below the baseline
    return baseline - metrics.inkAscent - gap - 3;
  }

  function drawSquiggles() {
    squiggleFrame = 0;
    if (!active || settings.marks !== 'squiggle') {
      marksLayer?.replaceChildren();
      lastSquiggles = '';
      return;
    }
    const lines = [];
    const vh = window.innerHeight, vw = window.innerWidth;
    const sx = window.scrollX, sy = window.scrollY;
    const clips = new Map();
    for (const node of trackedNodes) {
      if (!node.isConnected) continue;
      const rec = records.get(node);
      if (!rec || !rec.fixes.some((f) => f.range)) continue;
      const el = node.parentElement;
      if (!el || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))) continue;
      const clip = clipRect(el, clips);
      let metrics = null;
      for (const fix of rec.fixes) {
        if (!fix.range) continue;
        for (const r of fix.range.getClientRects()) {
          // a screen above and below too, so lines are already there when the page scrolls
          if (r.bottom < -vh || r.top > 2 * vh || r.right < 0 || r.left > vw || r.width < 1) continue;
          // hidden by a collapsed or scrolled container (overflow clipping)
          if (r.right <= clip.left || r.left >= clip.right || r.bottom <= clip.top || r.top >= clip.bottom) continue;
          metrics = metrics || fontMetrics(node.parentElement);
          const y = squiggleTop(r, metrics);
          lines.push(`position:absolute;left:${r.left + sx}px;top:${y + sy}px;width:${r.width}px;height:3px;` +
            `background:${waveImage(CATEGORIES[fix.category].color)} repeat-x 0 0/4px 3px;pointer-events:none;`);
        }
      }
    }
    // Most redraws (busy pages announce changes all the time) find every line where it was: leave the layer be.
    const sig = lines.join('|');
    if (sig === lastSquiggles && marksLayer?.isConnected) return;
    lastSquiggles = sig;
    const frag = document.createDocumentFragment();
    for (const css of lines) {
      const line = document.createElement('div');
      line.style.cssText = css;
      frag.append(line);
    }
    marksLayerEl().replaceChildren(frag);
  }

  // The squiggles live in a layer anchored to the page (not the window), so they scroll with the text natively
  // instead of being re-placed a frame late. Only layout changes and inner scroll boxes need a redraw.
  let marksHost = null, marksLayer = null;
  function marksLayerEl() {
    if (!marksHost || !marksHost.isConnected) {
      marksHost = document.createElement('div');
      marksHost.id = 'iac-marks-host';
      marksHost.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;' +
        'z-index:2147483646;pointer-events:none;';
      marksLayer = document.createElement('div');
      marksHost.attachShadow({ mode: 'open' }).append(marksLayer);
      document.documentElement.append(marksHost);
    }
    return marksLayer;
  }

  // The visible area an element is clipped to by its scrolling/overflow-hidden ancestors.
  function clipRect(el, cache) {
    if (!el || el === document.body || el === document.documentElement) {
      return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    }
    if (cache.has(el)) return cache.get(el);
    const up = el.assignedSlot || el.parentElement || el.getRootNode().host || null;
    const out = { ...clipRect(up, cache) };
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.contain.includes('paint')) {
      const b = el.getBoundingClientRect();
      out.left = Math.max(out.left, b.left); out.top = Math.max(out.top, b.top);
      out.right = Math.min(out.right, b.right); out.bottom = Math.min(out.bottom, b.bottom);
    }
    cache.set(el, out);
    return out;
  }

  // Anything that can move or hide text redraws the squiggles: attribute changes (collapsing a thread),
  // size changes, transitions and animations, clicks. Underlines (CSS highlights) move by themselves.
  const layoutObserver = new MutationObserver(() => scheduleSquiggles());
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleSquiggles()) : null;
  const LAYOUT_EVENTS = ['transitionend', 'animationend', 'click', 'toggle', 'load'];
  let squiggleTimer = null;
  function watchLayout(on) {
    layoutObserver.disconnect();
    resizeObserver?.disconnect();
    for (const ev of LAYOUT_EVENTS) document.removeEventListener(ev, scheduleSquiggles, true);
    clearInterval(squiggleTimer);
    if (!on || settings.marks !== 'squiggle') return;
    const opts = { attributes: true, childList: true, subtree: true, characterData: true };
    layoutObserver.observe(document.documentElement, opts);
    for (const sr of shadowRoots) layoutObserver.observe(sr, opts);
    if (document.body) resizeObserver?.observe(document.body);
    for (const ev of LAYOUT_EVENTS) document.addEventListener(ev, scheduleSquiggles, true);
    // last resort for changes nothing announces (not in background tabs)
    squiggleTimer = setInterval(() => { if (!document.hidden) scheduleSquiggles(); }, 1000);
  }

  function adoptStyles(rootNode) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(highlightCss());
      sheets.push(sheet);
      rootNode.adoptedStyleSheets = [...rootNode.adoptedStyleSheets, sheet];
    } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------ settings

  function normalizeSettings(got) {
    const s = { ...DEFAULTS, ...got };
    s.categories = { ...DEFAULTS.categories, ...(got.categories || {}) };
    s.ai = { ...AI_DEFAULTS, ...(got.ai || {}) };
    if (got.showMarks === false && !got.marks) s.marks = 'none';
    return s;
  }

  async function loadSettings() {
    try {
      settings = normalizeSettings(await chrome.storage.sync.get(null));
    } catch (_) {
      settings = { ...DEFAULTS };
    }
  }

  async function loadDict() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'iac:getDict' });
      dict = res && res.dict ? res.dict : null;
    } catch (_) {
      dict = null;
    }
  }

  async function loadRegional() {
    regional = null;
    if (!P.REGION_NAME[settings.region]) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'iac:getRegional', region: settings.region });
      regional = res && res.table ? res.table : null;
    } catch (_) { /* ignore */ }
  }

  const shouldRun = () => settings.enabled && !settings.disabledSites.includes(location.hostname);

  function isIgnored(original, replacement) {
    const o = original.toLowerCase();
    return settings.ignored.some((k) => k === o || k === (o + '→' + replacement.toLowerCase()));
  }

  // ------------------------------------------------------------------ text nodes and blocks

  function acceptable(node) {
    const parent = node.parentElement;
    if (!parent || parent.isContentEditable || parent.closest(SKIP_SELECTOR)) return false;
    const len = node.data.length;
    return len > 2 && len < 20000 && /[A-Za-z]{2}/.test(node.data);
  }

  const blockOf = (node) => node.parentElement.closest(BLOCK_SELECTOR) || node.parentElement;
  const origText = (node) => {
    const rec = records.get(node);
    return rec && node.data === rec.written ? rec.orig : node.data;
  };

  // The paragraph as originally written, plus where each of its text nodes sits in it.
  function blockSegments(block, limit = 6000) {
    const segs = [];
    let text = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (text.length > limit) break;
      const parent = n.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR) || blockOf(n) !== block) continue;
      const t = origText(n);
      if (acceptable(n)) segs.push({ node: n, start: text.length, end: text.length + t.length });
      text += t;
    }
    return { text, segs };
  }

  // The writer's whole comment as originally written, to judge casual vs careful writing (POLICY.md §4). Quotes are
  // someone else's words, so they don't count, and a paragraph inside one is judged alone. Null means use the paragraph.
  function commentText(block) {
    const box = block.closest(COMMENT_SELECTOR);
    if (!box || block.closest('blockquote')) return null;
    let text = '';
    let last = null;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && text.length <= 6000; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR) || parent.closest('blockquote')) continue;
      const b = blockOf(n);
      if (last && b !== last) text += '\n';
      last = b;
      text += origText(n);
    }
    return text;
  }

  // A short <em>/<b>/<q> run on its own is usually a word being mentioned ("*their* is possessive").
  function isEmphasized(node) {
    const em = node.parentElement.closest(EMPHASIS_SELECTOR);
    if (!em) return false;
    const t = em.textContent.trim();
    return t.split(/\s+/).length <= 3 && t === node.data.trim();
  }

  // Short link text is usually a name, a username or a title (u/some_username, a product page).
  function isShortLink(node) {
    const a = node.parentElement.closest('a[href]');
    return !!a && a.textContent.trim().split(/\s+/).length <= 4;
  }

  // Names this page uses (GOALS.md §4a): the site's own name and domain, and every word it writes as a name
  // somewhere (so "Fastly" at the start of a sentence is still the company if the page names it elsewhere).
  const pageNames = new Set();
  function seedPageNames() {
    const meta = (sel) => document.querySelector(sel)?.content || '';
    for (const n of [meta('meta[property="og:site_name"]'), meta('meta[name="application-name"]')]) {
      for (const w of n.split(/[^A-Za-z'-]+/)) if (w.length > 2) pageNames.add(w.toLowerCase());
    }
    const host = location.hostname.replace(/^www\./, '').split('.');
    if (host.length >= 2 && host[host.length - 2].length > 2) pageNames.add(host[host.length - 2].toLowerCase());
  }

  function processNode(node, blockText, registerText) {
    const existing = records.get(node);
    // Already done, but a fix still waiting for the AI means its paragraph needs (another) review: the page may
    // have moved this text into a new paragraph element, and the one we queued is gone.
    if (existing && node.data === existing.written) return existing.fixes.some((f) => f.state === 'pending');
    if (existing) dropRecord(node, existing); // page changed it underneath us
    if (!acceptable(node)) return false;

    const data = node.data;
    const fixes = findCorrections(data, {
      // emphasis is judged by what's around it (a mention is left alone, emphasis on a used word isn't); link text is a name
      blockText, emphasized: isShortLink(node), marked: isEmphasized(node) ? blockText.indexOf(node.data) : null,
      extraSpelling: dict, casualMode: settings.casualMode, registerText,
      names: pageNames, regional,
      onDecision: (d) => trace({ kind: 'rule', rule: d.rule, original: d.original, replacement: d.replacement,
        verdict: d.verdict, why: d.why, context: around(data, d.start, d.end) }),
    }).filter((f) => {
      if (!settings.categories[f.category]) return false;
      if (!isIgnored(f.original, f.replacement)) return true;
      trace({ kind: 'rule', original: f.original, replacement: f.replacement, verdict: 'block', why: 'on the never-change list' });
      return false;
    });
    if (!fixes.length) return true;

    const rec = ensureRecord(node);
    for (const f of fixes) {
      const chosen = !wasUndone(node, f) && wasApplied(node, f);
      const state = wasUndone(node, f) ? 'reverted' : chosen ? 'on' : verifyFirst() && f.needsCheck ? 'pending' : 'on';
      addFix(node, rec, { ...f, source: 'rules', state, chosen, since: Date.now() });
      if (state === 'pending') sweepPendingSoon();
    }
    render(node, rec);
    logFixes(rec, rec.fixes.filter((f) => f.state === 'on'));
    return true;
  }

  function ensureRecord(node) {
    let rec = records.get(node);
    if (!rec) {
      rec = { orig: node.data, written: node.data, fixes: [] };
      records.set(node, rec);
      trackedNodes.add(node);
    }
    return rec;
  }

  function addFix(node, rec, f) {
    if (rec.fixes.some((x) => f.start < x.end && f.end > x.start)) return null;
    const fix = { ...f, id: nextId++, range: null, pos: null };
    rec.fixes.push(fix);
    rec.fixes.sort((a, b) => a.start - b.start);
    byId.set(fix.id, { node, fix });
    return fix;
  }

  // Write the corrected text into the node and (re)build its highlight ranges.
  function render(node, rec) {
    let out = '';
    let last = 0;
    const spans = [];
    for (const fix of rec.fixes) {
      out += rec.orig.slice(last, fix.start);
      const text = fix.state === 'on' ? fix.replacement : fix.original;
      spans.push([fix, out.length, out.length + text.length]);
      out += text;
      last = fix.end;
    }
    out += rec.orig.slice(last);

    for (const fix of rec.fixes) removeRange(fix);
    rec.written = out;
    if (node.data !== out) node.data = out;

    for (const [fix, s, e] of spans) {
      fix.pos = [s, e];
      if (fix.state !== 'on') continue;
      const range = new Range();
      range.setStart(node, s);
      range.setEnd(node, e);
      fix.range = range;
      highlights[fix.category]?.add(range);
      if (range.toString() !== fix.replacement) {
        trace({ kind: 'render', verdict: 'mismatch', original: fix.original, replacement: fix.replacement,
          why: 'highlighted text differs from the fix', shown: range.toString(), context: around(out, s, e) });
      }
    }
    scheduleSquiggles();
    publishFixes();
  }

  // ------------------------------------------------------------------ copies
  // Tell clipboard.js (the page's world) which fixes are showing, with the words around each, so text the page
  // copies from its own data comes out corrected too. Selections already carry the fixes.
  let publishTimer = null;
  function publishFixes() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      document.dispatchEvent(new CustomEvent('iac-fixes', { detail: JSON.stringify(active ? liveFixes() : []) }));
    }, 150);
  }

  function liveFixes() {
    const out = [];
    for (const node of trackedNodes) {
      const rec = records.get(node);
      if (!rec || !node.isConnected) continue;
      for (const fix of rec.fixes) {
        if (fix.state !== 'on') continue;
        fix.copyCtx = fix.copyCtx || paragraphContext(node, fix.start, fix.end);
        out.push({ original: fix.original, replacement: fix.replacement, ...fix.copyCtx });
      }
      if (out.length > 2000) break;
    }
    return out;
  }

  // Copy buttons that copy through a hidden or read-only text box: the box holds the page's own text.
  document.addEventListener('copy', (e) => {
    const el = e.target instanceof Element ? e.target : document.activeElement;
    if (!active || !el || !/^(TEXTAREA|INPUT)$/.test(el.tagName) || !e.clipboardData) return;
    const r = el.getBoundingClientRect();
    const hidden = el.readOnly || r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 ||
      r.top > window.innerHeight || r.left > window.innerWidth;
    if (!hidden) return; // a box the reader is typing in holds their own words
    let text;
    try { text = el.value.slice(el.selectionStart, el.selectionEnd); } catch (_) { return; }
    const fixed = window.IAC_CopyFix.correctCopy(text, liveFixes());
    if (fixed === text) return;
    e.clipboardData.setData('text/plain', fixed);
    e.preventDefault();
  }, true);

  function removeRange(fix) {
    if (fix.range) {
      highlights[fix.category]?.delete(fix.range);
      fix.range = null;
    }
  }

  function dropRecord(node, rec) {
    for (const fix of rec.fixes) {
      removeRange(fix);
      byId.delete(fix.id);
    }
    records.delete(node);
    trackedNodes.delete(node);
  }

  function restoreAll() {
    for (const node of trackedNodes) {
      const rec = records.get(node);
      if (!rec) continue;
      if (node.data === rec.written) node.data = rec.orig;
      dropRecord(node, rec);
    }
    trackedNodes.clear();
    updateBadge();
  }

  // Surrounding text as it now reads on the page (other fixes applied), split around this fix.
  function contextOf(rec, fix) {
    const text = rec.written;
    const [s0, e0] = fix.pos || [fix.start, fix.end];
    const a = Math.max(0, s0 - 50);
    const b = Math.min(text.length, e0 + 50);
    return {
      before: (a > 0 ? '…' : '') + text.slice(a, s0).replace(/\s+/g, ' '),
      after: text.slice(e0, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : ''),
    };
  }

  // ------------------------------------------------------------------ AI review (per paragraph)

  // HEAT FIX (1.7.26), not a design choice: Gemini Nano reading every paragraph near the window, in every tab,
  // kept the Mac hot. A paragraph goes to the AI only once it has stayed within one window-height of the view
  // (LOOKAHEAD, so the fix is usually in place before it's seen) for DWELL_MS while the tab is visible: paragraphs
  // flung past and background tabs are skipped. Cost: This page lists only what was near the reader. GOALS.md §6
  // has the trade-off; revisit if heat matters less (the old setting was rootMargin '800px 0px', no dwell, any tab).
  const DWELL_MS = 1000;
  const LOOKAHEAD = '100% 0px';
  const inView = new Set();
  const dwell = new Map(); // block -> timer
  function startDwell(block) {
    if (dwell.has(block) || document.hidden) return;
    dwell.set(block, setTimeout(() => {
      dwell.delete(block);
      if (document.hidden || !inView.has(block)) return;
      unwatch(block);
      reviewBlock(block);
    }, DWELL_MS));
  }
  function stopDwell(block) {
    clearTimeout(dwell.get(block));
    dwell.delete(block);
  }
  function unwatch(block) {
    stopDwell(block);
    inView.delete(block);
    io.unobserve(block);
  }
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { inView.add(e.target); startDwell(e.target); }
        else { inView.delete(e.target); stopDwell(e.target); }
      }
    }, { rootMargin: LOOKAHEAD })
    : null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) for (const b of [...dwell.keys()]) stopDwell(b);
    else for (const b of inView) startDwell(b);
  });

  function scheduleReview(block) {
    if (!aiOn() || !io) return;
    const st = blockState.get(block);
    if (st && (st.status === 'queued' || st.status === 'sent')) return; // its answer will settle it
    blockState.set(block, { ...(st || {}), status: 'queued' });
    io.observe(block);
    reviewBlock(block, { peek: true }); // an answer from an earlier visit settles it now, on screen or not
  }

  function snippet(text, s, e) {
    let a = Math.max(0, s - 30), b = Math.min(text.length, e + 30);
    while (a > 0 && /\S/.test(text[a - 1])) a--;
    while (b < text.length && /\S/.test(text[b])) b++;
    return text.slice(a, b).replace(/\s+/g, ' ').trim();
  }

  // Settle rule fixes without (new) AI help: AI off, failed, slow, paragraph not suitable, or already judged.
  // vetoed: 'original→replacement@offset' keys the AI turned down earlier in this paragraph.
  function settlePending(segs, vetoed) {
    for (const { node, start } of segs) {
      const rec = records.get(node);
      if (!rec || node.data !== rec.written) continue;
      const pending = rec.fixes.filter((f) => f.state === 'pending');
      if (!pending.length) continue;
      for (const f of pending) {
        f.state = vetoed && vetoed.has(f.original + '→' + f.replacement + '@' + (start + f.start)) ? 'vetoed' : 'on';
      }
      render(node, rec);
      logFixes(rec, pending);
    }
    updateBadge();
  }

  // Last resort: a rule fix never waits more than this for the AI. If the AI answers later and disagrees, the
  // veto still takes the fix back (it's kept in the popup as "AI kept the original").
  const PENDING_MAX_MS = 20000;
  // Why a fix is still waiting: where its paragraph is and how far its review got (for reports).
  function pendingDiag(node) {
    const block = blockOf(node);
    const st = blockState.get(block) || {};
    const r = block.getBoundingClientRect();
    const cs = getComputedStyle(block);
    const { text } = blockSegments(block);
    return {
      block: block.tagName.toLowerCase() + (block.id ? '#' + block.id : '') + (block.className && typeof block.className === 'string' ? '.' + block.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      inShadow: block.getRootNode() !== document, connected: block.isConnected, status: st.status || 'none',
      sameText: st.sig === text, textLen: text.length, rect: [Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      display: cs.display, visibility: cs.visibility, sentCount: aiBlocksSent,
    };
  }
  let pendingSweep = null;
  function sweepPendingSoon(delay = PENDING_MAX_MS + 500) {
    if (pendingSweep) return;
    pendingSweep = setTimeout(() => {
      pendingSweep = null;
      const now = Date.now();
      let next = Infinity; // when the next fix still waiting is due
      for (const node of trackedNodes) {
        const rec = records.get(node);
        if (!rec || !node.isConnected || node.data !== rec.written) continue;
        const late = rec.fixes.filter((f) => f.state === 'pending' && now - (f.since || now) >= PENDING_MAX_MS);
        for (const f of rec.fixes) if (f.state === 'pending' && !late.includes(f)) next = Math.min(next, (f.since || now) + PENDING_MAX_MS);
        if (!late.length) continue;
        const diag = pendingDiag(node);
        for (const f of late) {
          f.state = 'on';
          trace({ kind: 'rule-check', original: f.original, replacement: f.replacement, verdict: 'apply', why: 'the AI took too long, rule kept', diag });
        }
        render(node, rec);
        logFixes(rec, late);
      }
      updateBadge();
      if (next < Infinity) sweepPendingSoon(Math.max(200, next - now + 100));
    }, delay);
  }

  // A queued paragraph left the page before it was reviewed (the site rebuilt it). Its text may live on in new
  // elements: queue the paragraphs that now hold fixes still waiting for the AI.
  function requeuePending() {
    for (const node of trackedNodes) {
      const rec = records.get(node);
      if (!rec || !node.isConnected || node.data !== rec.written || !node.parentElement) continue;
      if (rec.fixes.some((f) => f.state === 'pending')) scheduleReview(blockOf(node));
    }
  }

  // peek: take an answer the AI already gave for this paragraph (cached). Without one, a paragraph with a fix
  // waiting for the AI is sent now; any other waits until it scrolls into view (the find pass is for what's seen).
  async function reviewBlock(block, { peek = false } = {}) {
    if (!active) return;
    if (!block.isConnected) { if (!peek) { blockState.delete(block); requeuePending(); } return; }
    const { text, segs } = blockSegments(block);
    const st = blockState.get(block) || {};
    if (peek && (st.sig === text || st.status !== 'queued')) return;
    if (st.sig === text) {
      // Same paragraph, page re-rendered it (e.g. React): put back the AI fixes it had, and settle the rule fixes
      // found again with the verdicts already given (they'd otherwise wait for a check that never comes).
      if (st.edits && st.edits.length) replayEdits(text, segs, st.edits);
      settlePending(segs, st.vetoed);
      blockState.set(block, { ...st, status: 'done' });
      return;
    }
    const words = (text.match(/[A-Za-z]{2,}/g) || []).length;
    const skip = words < 4 || text.length > 4000 || aiBlocksSent >= MAX_AI_BLOCKS;
    if (peek && skip) return; // decided when it scrolls into view
    if (!peek) blockState.set(block, { sig: text, status: 'sent' });
    if (skip) {
      const all = blockSegments(block, Infinity).segs; // every fix in it, even past the usual cut-off
      const waiting = all.some(({ node }) => records.get(node)?.fixes.some((f) => f.state === 'pending'));
      if (waiting) {
        trace({ kind: 'paragraph', pid: hash(text), text: text.slice(0, 300), skipped: true,
          why: words < 4 ? 'too short for the AI' : text.length > 4000 ? 'too long for the AI' : 'AI limit for this page reached' });
      }
      blockState.set(block, { sig: text, status: 'done' });
      settlePending(all);
      return;
    }
    // Rule fixes in this paragraph become numbered suggestions for the AI to confirm.
    const cands = [];
    for (const seg of segs) {
      const rec = records.get(seg.node);
      if (!rec || seg.node.data !== rec.written) continue;
      for (const fix of rec.fixes) {
        if (fix.source !== 'rules' || !fix.needsCheck || fix.state === 'reverted' || fix.state === 'vetoed' || fix.chosen) continue;
        cands.push({ seg, rec, fix });
      }
    }
    // Not reading every paragraph (the reader turned it off): one with nothing to ask is left alone.
    // Forgotten rather than marked done, so a rule fix found in it later is still asked about.
    if (!cands.length && !settings.ai.read) {
      unwatch(block);
      blockState.delete(block);
      return;
    }
    if (!peek) aiBlocksSent++;
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'iac:proofread', cacheOnly: peek,
        req: {
          text, url: location.href, registerText: commentText(block),
          candidates: cands.map(({ seg, fix }) => ({
            original: fix.original, replacement: fix.replacement,
            ...P.sentenceAround(text, seg.start + fix.start, seg.start + fix.end, fix.replacement),
          })),
        },
      });
    } catch (_) {
      res = null;
    }
    if (!active || commentChoices[choiceKey(text)]) return; // left or fixed by the reader while the AI was thinking
    if (peek) {
      if (blockState.get(block)?.status !== 'queued') return; // it came into view and its own review took over
      if (!res || !res.ok || !res.result) {
        // No earlier answer. A paragraph with a fix waiting for the AI is checked now, seen or not: otherwise an
        // off-screen one would wait (and fall back to the timeout) on every visit and never get an answer saved.
        if (cands.some(({ fix }) => fix.state === 'pending')) { unwatch(block); reviewBlock(block); }
        return;
      }
      unwatch(block);
    }
    if (!res || !res.ok || !res.result) {
      trace({ kind: 'paragraph', pid: hash(text), text: text.slice(0, 300), skipped: true, why: 'no answer: ' + (res?.error || 'no reply') });
      blockState.set(block, { sig: text, status: 'done' });
      settlePending(segs);
      return;
    }

    const { checks = [], edits = [] } = res.result;
    const pid = hash(text);
    trace({ kind: 'paragraph', pid, text: text.slice(0, 1500), skipped: !!res.skipped, cached: !!res.cached, noAnswer: !!res.noAnswer });
    for (const t of res.result.trace || []) trace({ ...t, pid });
    const verdict = new Map();
    for (const c of checks) if (c && Number.isInteger(c.n)) verdict.set(c.n, !!c.ok);
    const vetoed = new Set();
    cands.forEach(({ seg, fix }, i) => {
      if (verdict.get(i + 1) === false) vetoed.add(fix.original + '→' + fix.replacement + '@' + (seg.start + fix.start));
    });
    blockState.set(block, { sig: text, status: 'done', edits, vetoed });

    const touched = new Set();
    cands.forEach(({ seg, rec, fix }, i) => {
      if (seg.node.data !== rec.written) return;
      // The user undid or applied it while the AI was thinking: their choice stands.
      if (fix.state === 'reverted' || fix.chosen) return;
      const ok = verdict.has(i + 1) ? verdict.get(i + 1) : true; // no answer: trust the rule
      trace({ kind: 'rule-check', pid, original: fix.original, replacement: fix.replacement, verdict: ok ? 'apply' : 'veto',
        why: verdict.has(i + 1) ? (ok ? '' : 'the AI preferred the original in both orders') : 'no answer from the AI, rule kept' });
      if (ok) {
        if (fix.state === 'pending') { fix.state = 'on'; logFixes(rec, [fix]); }
        if (fix.rule === 'learned') learn([fix], 'hit');
      } else {
        // kept visible in the popup ("AI kept the original") so it can be applied anyway
        if (fix.state === 'on' && fix.logKey) send({ type: 'iac:reverted', key: location.href + '#' + fix.logKey, reverted: true });
        fix.state = 'vetoed';
      }
      touched.add(seg.node);
    });

    const found = [];
    for (const edit of edits) {
      const placed = placeEdit(text, segs, edit);
      if (placed.fix) { found.push(placed.fix); touched.add(placed.node); }
      trace({ kind: 'place', pid, original: edit.original, replacement: edit.replacement, verdict: placed.fix ? 'apply' : 'block', why: placed.why || '' });
    }
    for (const node of touched) {
      const rec = records.get(node);
      if (rec) render(node, rec);
    }
    for (const fix of found) {
      const { node } = byId.get(fix.id) || {};
      if (node) logFixes(records.get(node), [fix]);
    }
    if (found.length) learn(found, 'hit');
    settlePending(segs);
  }

  // Place an AI edit on the page. background.js has already screened it against the policy and the
  // dictionary; the policy runs again here because this is the copy of the text that gets changed.
  // Returns { fix, node } or { why }.
  function placeEdit(text, segs, raw) {
    if (!raw || typeof raw.original !== 'string' || typeof raw.replacement !== 'string') return { why: 'malformed' };
    const edit = trimEdit(raw);
    const at = P.locate(text, edit);
    if (!at) return { why: 'could not find it in the paragraph' };
    const why = P.checkAiEdit(edit, { text, at, known: isKnownMisspelling, mentioned: (w) => isMentioned(text, w),
      casualMode: settings.casualMode, names: pageNames,
      registerText: segs[0] ? commentText(blockOf(segs[0].node)) : null });
    if (why) return { why };
    const original = edit.original.trim();
    const replacement = edit.replacement.trim();
    const category = categoryOf(edit.type);
    if (!settings.categories[category]) return { why: 'category turned off' };
    if (isIgnored(original, replacement)) return { why: 'on the never-change list' };
    const mention = isQuoted(text, at.start, at.end) && P.mentionReason(text, at.start, at.end, { block: text, replacement });
    if (mention) return { why: mention };

    const seg = segs.find((sg) => sg.start <= at.start && at.end <= sg.end);
    if (!seg) return { why: 'spans more than one piece of text on the page' };
    if (isEmphasized(seg.node)) {
      const marked = P.mentionReason(text, at.start, at.end, { block: text, replacement });
      if (marked) return { why: marked };
    }
    const rec = ensureRecord(seg.node);
    if (seg.node.data !== rec.written) return { why: 'the page changed the text' };
    const start = at.start - seg.start;
    if (rec.orig.slice(start, start + original.length) !== original) return { why: 'text did not match' };

    const f = {
      start, end: start + original.length, original,
      replacement: matchCase(original, replacement), category, rule: 'ai', source: 'ai', via: edit.source || 'ai',
      reason: typeof edit.reason === 'string' ? edit.reason.slice(0, 160) : '',
    };
    f.state = wasUndone(seg.node, f) ? 'reverted' : 'on';
    const fix = addFix(seg.node, rec, f);
    return fix ? { fix, node: seg.node } : { why: 'overlaps another fix' };
  }

  // Models sometimes include unchanged words around the fix ("it s huge" -> "it's huge"): drop them,
  // so only the changed words are replaced and highlighted.
  function trimEdit(edit) {
    const o = edit.original.trim().split(/\s+/), r = edit.replacement.trim().split(/\s+/);
    while (o.length > 1 && r.length > 1 && o[0] === r[0]) { o.shift(); r.shift(); }
    while (o.length > 1 && r.length > 1 && o[o.length - 1] === r[r.length - 1]) { o.pop(); r.pop(); }
    return { ...edit, original: o.join(' '), replacement: r.join(' ') };
  }

  function replayEdits(text, segs, edits) {
    const touched = new Set();
    for (const edit of edits) {
      const placed = placeEdit(text, segs, edit);
      if (placed.fix) touched.add(placed.node);
    }
    for (const node of touched) render(node, records.get(node));
  }

  function matchCase(orig, repl) {
    if (orig.length > 1 && orig === orig.toUpperCase() && /[A-Z]/.test(orig)) return repl.toUpperCase();
    if (/^[A-Z]/.test(orig)) return repl.charAt(0).toUpperCase() + repl.slice(1);
    return repl;
  }

  function learn(fixes, kind) {
    send({
      type: 'iac:learn',
      events: fixes.map((f) => ({ original: f.original, replacement: f.replacement, category: f.category, kind })),
    });
  }

  // ------------------------------------------------------------------ walking

  const queue = [];
  let scheduled = false;

  function enqueue(root) {
    if (!active || !root) return;
    queue.push(root);
    if (!scheduled) {
      scheduled = true;
      (window.requestIdleCallback || setTimeout)(drain, { timeout: 300 });
    }
  }

  function drain(deadline) {
    scheduled = false;
    // An idle callback that fired on its timeout (busy or background page) has no idle time left;
    // still take a small slice so the queue always drains.
    const started = performance.now();
    const limit = deadline && !deadline.didTimeout && deadline.timeRemaining ? Math.max(8, deadline.timeRemaining()) : 12;
    const textNodes = [];
    while (queue.length && performance.now() - started < limit) {
      const root = queue.shift();
      if (root.nodeType === Node.TEXT_NODE) { textNodes.push(root); continue; }
      if (root.nodeType === Node.ELEMENT_NODE && root.closest && root.closest(SKIP_SELECTOR)) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walker.currentNode; n; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) textNodes.push(n);
        else if (n.shadowRoot && !/^iac-/.test(n.id)) attachShadow(n.shadowRoot);
      }
    }

    // group by paragraph so the rules (and the AI) see whole paragraphs
    const blocks = new Map();
    for (const n of textNodes) {
      if (!n.isConnected || !n.parentElement) continue;
      const b = blockOf(n);
      if (!blocks.has(b)) blocks.set(b, []);
      blocks.get(b).push(n);
    }
    const texts = new Map();
    for (const block of blocks.keys()) {
      const { text } = blockSegments(block);
      texts.set(block, text);
      if (pageNames.size < 3000) for (const n of P.namesIn(text)) pageNames.add(n);
    }
    for (const [block, nodes] of blocks) {
      const text = texts.get(block);
      const choice = commentChoices[choiceKey(text)];
      if (choice?.left) continue; // the reader said to leave this one as written
      const registerText = commentText(block);
      let any = false;
      for (const n of nodes) if (processNode(n, text, registerText)) any = true;
      if (undone.length) restoreUndone(nodes);
      if (choice?.edits) { placeAsked(block, choice.edits); continue; } // the reader's own fix: no AI check needed
      if (any) scheduleReview(block);
    }

    if (queue.length) {
      scheduled = true;
      (window.requestIdleCallback || setTimeout)(drain, { timeout: 300 });
    }
    updateBadge();
  }

  function attachShadow(sr) {
    if (shadowRoots.has(sr)) return;
    shadowRoots.add(sr);
    adoptStyles(sr);
    observer.observe(sr, OBSERVE_OPTS);
    if (settings.marks === 'squiggle' && active) watchLayout(true);
    enqueue(sr);
  }

  const OBSERVE_OPTS = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver((mutations) => {
    if (!active) return;
    scheduleSquiggles();
    for (const m of mutations) {
      if (m.type === 'characterData') {
        const rec = records.get(m.target);
        if (rec && m.target.data === rec.written) continue; // our own write
        enqueue(m.target);
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.ELEMENT_NODE) enqueue(n);
        }
      }
    }
  });

  // ------------------------------------------------------------------ right-click: fix or leave one comment
  // POLICY.md §5. The rules and the AI leave jokes and deliberate typos alone as best they can; only the reader can
  // really tell, so they can overrule it for one comment either way. Each choice undoes the other.
  let commentChoices = {}; // paragraph hash -> { left: true } | { edits: [{ start, end, original, replacement, type }] }
  let menuTarget = null;
  const choiceKey = (text) => hash(squash(text).trim());
  document.addEventListener('contextmenu', (e) => { menuTarget = e.composedPath()[0]; }, true);

  // The paragraphs of the comment under the pointer; off Reddit (no comment box known), the paragraph itself.
  function commentBlocks(target) {
    const el = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el?.closest) return [];
    const box = el.closest(COMMENT_SELECTOR);
    if (!box) return [el.closest(BLOCK_SELECTOR) || el];
    const blocks = new Set();
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement && !n.parentElement.closest(SKIP_SELECTOR) && !n.parentElement.closest('blockquote') && acceptable(n)) blocks.add(blockOf(n));
    }
    return [...blocks];
  }

  function setChoice(text, value) {
    const key = choiceKey(text);
    if (value) commentChoices[key] = value; else delete commentChoices[key];
    send({ type: 'iac:commentChoice', key, value });
  }

  function leaveComment(blocks) {
    for (const block of blocks) {
      const { text } = blockSegments(block);
      const { segs } = blockSegments(block, Infinity);
      setChoice(text, { left: true });
      unwatch(block);
      blockState.delete(block);
      for (const { node } of segs) {
        const rec = records.get(node);
        if (!rec) continue;
        for (const fix of rec.fixes) if (fix.logKey) send({ type: 'iac:reverted', key: location.href + '#' + fix.logKey, reverted: true });
        if (node.data === rec.written) node.data = rec.orig;
        dropRecord(node, rec);
      }
      trace({ kind: 'user', verdict: 'leave', text: text.slice(0, 300), pid: hash(text) });
    }
    scheduleSquiggles();
    publishFixes();
    updateBadge();
  }

  // Put the reader's asked-for fixes on the page; a rule fix waiting for the AI in this paragraph is settled.
  function placeAsked(block, edits) {
    const { text, segs } = blockSegments(block);
    const touched = new Set();
    let placed = 0;
    for (const e of edits) {
      const seg = segs.find((g) => g.start <= e.start && e.end <= g.end);
      if (!seg || text.slice(e.start, e.end) !== e.original) continue; // spans a link or bold run, or the text changed
      const rec = ensureRecord(seg.node);
      const start = e.start - seg.start;
      const f = { start, end: start + e.original.length, original: e.original, replacement: matchCase(e.original, e.replacement),
        category: categoryOf(e.type), rule: 'ai', source: 'ai', via: 'asked', reason: '', chosen: true };
      f.state = wasUndone(seg.node, f) ? 'reverted' : 'on';
      if (addFix(seg.node, rec, f)) { touched.add(seg.node); placed++; }
    }
    for (const node of touched) {
      const rec = records.get(node);
      render(node, rec);
      logFixes(rec, rec.fixes);
    }
    settlePending(segs);
    blockState.set(block, { sig: text, status: 'done' });
    updateBadge();
    return placed;
  }

  async function fixComment(blocks) {
    let placed = 0, failed = null;
    const asking = blocks.filter((b) => !commentChoices[choiceKey(blockSegments(b).text)]?.edits);
    if (asking.length) toast('Fixing this comment…', 0);
    for (const block of blocks) {
      const { text } = blockSegments(block);
      if (!/[A-Za-z]{2}/.test(text)) continue;
      const had = commentChoices[choiceKey(text)];
      if (had?.left) { setChoice(text, null); enqueue(block); } // takes back "leave as written"
      if (had?.edits) { placed += placeAsked(block, had.edits); continue; }
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'iac:restore', req: { text, url: location.href } });
      } catch (_) {
        res = null;
      }
      if (!active) return;
      if (!res?.ok) { failed = res?.error || 'no reply'; continue; }
      if (res.edits.length) {
        setChoice(text, { edits: res.edits });
        unwatch(block);
        placed += placeAsked(block, res.edits);
      }
    }
    toast(placed ? `Fixed ${placed} ${placed === 1 ? 'place' : 'places'}`
      : failed === 'off' ? 'Turn on an AI checker in Settings first'
      : failed === 'ollama' ? 'The AI checker is set to Ollama, which isn’t running'
      : failed === 'timeout' ? 'The AI took too long' : failed ? `The AI gave no answer (${failed})` : 'The AI found nothing to fix');
  }

  // A small note at the bottom of the window: the only thing on the page while the AI works.
  let toastHost = null, toastTimer = null;
  function toast(message, ms = 3000) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'iac-toast-host';
      toastHost.attachShadow({ mode: 'open' }).innerHTML = `<style>div { position: fixed; left: 50%; bottom: 24px;
        transform: translateX(-50%); z-index: 2147483647; padding: 6px 12px; border-radius: 6px; background: #1f2937;
        color: #e5e7eb; font: 13px/1.4 system-ui, sans-serif; pointer-events: none; }</style><div role="status"></div>`;
    }
    if (!toastHost.isConnected) document.documentElement.appendChild(toastHost);
    toastHost.shadowRoot.querySelector('div').textContent = message;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => toastHost.remove(), ms);
  }

  // ------------------------------------------------------------------ decision trace
  // Every candidate fix and what happened to it, sent to background.js (kept on this computer).

  let traceBuf = [];
  let traceTimer = null;
  const traced = new Set();
  const around = (text, s, e) => text.slice(Math.max(0, s - 60), Math.min(text.length, e + 60));
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function trace(entry) {
    const sig = JSON.stringify(entry);
    if (traced.has(sig)) return; // the page re-rendered the same text
    if (traced.size > 5000) traced.clear();
    traced.add(sig);
    traceBuf.push({ t: Date.now(), url: location.href, ...entry });
    if (!traceTimer) {
      traceTimer = setTimeout(flushTrace, 1000);
    }
  }

  function flushTrace() {
    clearTimeout(traceTimer);
    traceTimer = null;
    if (!traceBuf.length) return;
    const entries = traceBuf;
    traceBuf = [];
    send({ type: 'iac:trace', entries });
  }

  // "Report" on the hover card: mark the fix as wrong and save this page's report for Claude.
  async function sendReport(fix) {
    const hit = byId.get(fix.id);
    const rec = hit && records.get(hit.node);
    const flagged = { original: fix.original, replacement: fix.replacement, source: fix.source, via: fix.via,
      reason: fix.reason || '', state: fix.state, context: rec ? around(rec.orig, fix.start, fix.end) : '' };
    trace({ kind: 'user', verdict: 'flag', ...flagged });
    flushTrace();
    try {
      return await chrome.runtime.sendMessage({ type: 'iac:report', url: location.href, save: true, flagged });
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------------ undone fixes, remembered per page

  // An undo is remembered by the words around the fix in its paragraph, not by the page's text nodes or URL:
  // sites split text into different nodes from one load to the next (React, streaming chat replies), and the same
  // comment shows up in a feed and on its own page. So an undo holds on every visit, on any page showing the text.
  let undone = []; // [{ page, key, original, replacement, before, after, category, source, reason }]
  // Fixes the user chose to make (Apply on an AI veto, Redo, Apply while checking), same shape. The AI never
  // takes these back, on this visit or a later one.
  let applied = [];
  const pageKey = () => location.origin + location.pathname;
  const squash = (s) => s.replace(/\s+/g, ' ');

  async function loadUndone() {
    try {
      ({ undone = [], applied = [], commentChoices = {} } = await chrome.storage.local.get(['undone', 'applied', 'commentChoices']));
    } catch (_) {
      undone = [];
      applied = [];
      commentChoices = {};
    }
  }

  // Up to 24 characters either side of [s,e) in the node, read across the whole paragraph.
  function paragraphContext(node, s, e) {
    const text = origText(node);
    let before = text.slice(0, s), after = text.slice(e);
    if (node.parentElement) {
      const { text: para, segs } = blockSegments(blockOf(node));
      const seg = segs.find((g) => g.node === node);
      if (seg) { before = para.slice(0, seg.start) + before; after += para.slice(seg.end); }
    }
    return { before: squash(before).slice(-24), after: squash(after).slice(0, 24) };
  }

  function occurrence(node, fix) {
    const { before, after } = paragraphContext(node, fix.start, fix.end);
    return { before, after, key: fix.original + '→' + fix.replacement + '@' + before + '|' + after };
  }

  // Same change in the same words? Older entries hold less context (text-node based), so the shorter side only
  // has to line up with the longer one, as long as enough of it is there to be specific.
  function sameOccurrence(u, occ) {
    const ub = squash(u.before), ua = squash(u.after);
    const endsAlike = (a, b) => (a.length < b.length ? b.endsWith(a) : a.endsWith(b));
    const startsAlike = (a, b) => (a.length < b.length ? b.startsWith(a) : a.startsWith(b));
    if (!endsAlike(ub, occ.before) || !startsAlike(ua, occ.after)) return false;
    const shared = Math.min(ub.length, occ.before.length) + Math.min(ua.length, occ.after.length);
    return shared >= 12 || (ub === occ.before && ua === occ.after);
  }

  const findIn = (list, node, fix) => {
    const cands = list.filter((u) => u.original === fix.original && u.replacement === fix.replacement);
    if (!cands.length) return null;
    const occ = occurrence(node, fix);
    return cands.find((u) => sameOccurrence(u, occ)) || null;
  };
  const findUndone = (node, fix) => findIn(undone, node, fix);
  const wasUndone = (node, fix) => !!findUndone(node, fix);
  const wasApplied = (node, fix) => !!findIn(applied, node, fix);

  // Undo remembers "leave this"; Redo or Apply remembers "make this", which also outranks an AI veto.
  function rememberUndo(node, fix, isUndone) {
    const prior = findUndone(node, fix);
    const prevApply = findIn(applied, node, fix);
    const entry = { page: pageKey(), ...occurrence(node, fix), original: fix.original, replacement: fix.replacement,
      category: fix.category, source: fix.source, reason: fix.reason || '' };
    if (prior) forgetUndo(prior);
    if (prevApply) forgetApply(prevApply);
    if (isUndone) {
      fix.chosen = false;
      undone.push(entry);
      send({ type: 'iac:undone', entry, undone: true });
    } else {
      if (!prior) send({ type: 'iac:undone', entry, undone: false });
      fix.chosen = true;
      rememberApply(entry);
    }
  }

  function rememberApply(entry) {
    applied.push(entry);
    send({ type: 'iac:applied', entry, applied: true });
  }

  function forgetApply(u) {
    applied = applied.filter((x) => x !== u);
    send({ type: 'iac:applied', entry: u, applied: false });
  }

  function forgetUndo(u) {
    undone = undone.filter((x) => x !== u);
    send({ type: 'iac:undone', entry: u, undone: false });
  }

  // Fixes undone on an earlier visit come back as "undone" (with Redo), even if nothing re-finds them
  // (the AI is off, or the change is now on the never-change list).
  function restoreUndone(nodes) {
    for (const node of nodes) {
      if (!node.isConnected || !acceptable(node)) continue;
      const text = origText(node);
      for (const u of undone) {
        if (!text.includes(u.original)) continue;
        const re = new RegExp('(?<![A-Za-z])' + u.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
        for (const m of text.matchAll(re)) {
          const start = m.index, end = start + u.original.length;
          const rec = records.get(node);
          if (rec && rec.fixes.some((f) => start < f.end && end > f.start)) continue;
          if (!sameOccurrence(u, paragraphContext(node, start, end))) continue;
          const r = ensureRecord(node);
          addFix(node, r, { start, end, original: u.original, replacement: u.replacement,
            category: categoryOf(u.category), rule: 'restored', source: u.source, reason: u.reason, state: 'reverted' });
          render(node, r);
        }
      }
    }
  }

  // Undos remembered for this page whose text isn't on it right now (not loaded yet, or edited since).
  // Listed in the popup so they never silently vanish; Redo there forgets the undo.
  function missingUndos() {
    const shown = new Set();
    for (const node of trackedNodes) {
      const rec = records.get(node);
      if (!rec || !node.isConnected) continue;
      for (const fix of rec.fixes) if (fix.state === 'reverted') { const u = findUndone(node, fix); if (u) shown.add(u); }
    }
    return undone.filter((u) => u.page === pageKey() && !shown.has(u));
  }

  // ------------------------------------------------------------------ logging

  let pendingLog = [];
  let logTimer = null;

  function logFixes(rec, fixes) {
    for (const fix of fixes) {
      if (fix.state !== 'on' || fix.logKey) continue;
      const ctx = contextOf(rec, fix);
      const key = fix.original + '>' + fix.replacement + '@' + ctx.before.slice(-30) + ctx.after.slice(0, 30);
      fix.logKey = key;
      if (loggedKeys.has(key)) continue; // same text re-rendered by the page
      loggedKeys.add(key);
      pendingLog.push({
        key: location.href + '#' + key,
        original: fix.original,
        replacement: fix.replacement,
        category: fix.category,
        source: fix.source,
        reason: fix.reason || '',
        variety: fix.variety || '',
        before: ctx.before,
        after: ctx.after,
        url: location.href,
        link: permalinkOf(byId.get(fix.id)?.node),
        host: location.hostname,
        title: document.title,
        time: Date.now(),
      });
    }
    if (!logTimer && pendingLog.length) logTimer = setTimeout(flushLog, 800);
  }

  // The comment's or post's own address, when the fix sits in one: a feed or chat list shows text from many
  // pages, and History's Open should go to the one the text belongs to. Sites mark it with a permalink
  // attribute (Reddit) or a link around the post's timestamp (X, Mastodon, forums).
  function permalinkOf(node) {
    let el = node?.parentElement;
    for (let depth = 0; el && depth < 40; depth++) {
      const attr = el.getAttribute('permalink') || el.getAttribute('data-permalink');
      if (attr) { try { return new URL(attr, location.href).href; } catch (_) { /* ignore */ } }
      if (el.matches('article,[role="article"],shreddit-comment,shreddit-post')) {
        const a = el.querySelector('a[href] time')?.closest('a');
        if (a && a.origin === location.origin) return a.href;
      }
      el = el.parentElement || el.getRootNode().host || null;
    }
    return location.href;
  }

  function flushLog() {
    logTimer = null;
    if (!pendingLog.length) return;
    const entries = pendingLog;
    pendingLog = [];
    send({ type: 'iac:log', entries });
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) { /* extension reloaded */ }
  }

  let badgeTimer = null;
  function updateBadge() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => send({ type: 'iac:count', count: pageFixes().filter((f) => !f.reverted && f.category !== 'regional').length }), 300);
  }

  function pageFixes() {
    const list = [];
    for (const node of trackedNodes) {
      if (!node.isConnected) continue;
      const rec = records.get(node);
      if (!rec) continue;
      for (const fix of rec.fixes) {
        const ctx = contextOf(rec, fix);
        list.push({
          id: fix.id, original: fix.original, replacement: fix.replacement, category: fix.category,
          source: fix.source, reason: fix.reason || '', variety: fix.variety || '', reverted: fix.state !== 'on', vetoed: fix.state === 'vetoed',
          pending: fix.state === 'pending',
          before: ctx.before, after: ctx.after,
        });
      }
    }
    return list;
  }

  // ------------------------------------------------------------------ undo / ignore / jump

  function setReverted(id, reverted) {
    const hit = byId.get(id);
    if (!hit) return false;
    const rec = records.get(hit.node);
    if (!rec) return false;
    const wasVetoed = hit.fix.state === 'vetoed';
    hit.fix.state = reverted ? 'reverted' : 'on';
    rememberUndo(hit.node, hit.fix, reverted);
    trace({ kind: 'user', verdict: reverted ? 'undo' : wasVetoed ? 'apply' : 'redo', original: hit.fix.original,
      replacement: hit.fix.replacement, source: hit.fix.source, context: around(rec.orig, hit.fix.start, hit.fix.end) });
    render(hit.node, rec);
    if (!reverted) logFixes(rec, [hit.fix]);
    if (!reverted && wasVetoed) learn([hit.fix], 'hit');
    if (hit.fix.logKey) send({ type: 'iac:reverted', key: location.href + '#' + hit.fix.logKey, reverted });
    if (reverted && (hit.fix.source === 'ai' || hit.fix.rule === 'learned')) learn([hit.fix], 'reject');
    updateBadge();
    return true;
  }

  async function neverChange(fix) {
    setReverted(fix.id, true);
    trace({ kind: 'user', verdict: 'never', original: fix.original, replacement: fix.replacement });
    const key = (fix.original + '→' + fix.replacement).toLowerCase();
    if (!settings.ignored.includes(key)) {
      settings.ignored = [...settings.ignored, key];
      try { await chrome.storage.sync.set({ ignored: settings.ignored }); } catch (_) { /* ignore */ }
    }
  }

  function jumpTo(id) {
    const hit = byId.get(id);
    if (!hit || !hit.node.isConnected || !hit.fix.pos) return false;
    const range = new Range();
    range.setStart(hit.node, hit.fix.pos[0]);
    range.setEnd(hit.node, hit.fix.pos[1]);
    // scrollIntoView also scrolls inner panes (chat apps scroll a div, not the window)
    hit.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (supportsHighlights) {
      highlights.flash.clear();
      highlights.flash.add(range);
      setTimeout(() => highlights.flash.delete(range), 1800);
    }
    return true;
  }

  // History's Open: find the change on the page by its words and context, and show it. Pages load lazily, so
  // keep looking for a while.
  function findOnPage(target, tries = 25) {
    const clean = (x) => squash(String(x || '').replace(/…/g, '')).trim();
    const tb = clean(target.before).slice(-16), ta = clean(target.after).slice(0, 16);
    let best = null, bestScore = -1;
    for (const node of trackedNodes) {
      const rec = records.get(node);
      if (!rec || !node.isConnected) continue;
      for (const fix of rec.fixes) {
        if (fix.original !== target.original || fix.replacement !== target.replacement || !fix.pos) continue;
        const ctx = contextOf(rec, fix);
        const score = (clean(ctx.before).endsWith(tb) ? 2 : 0) + (clean(ctx.after).startsWith(ta) ? 2 : 0) + 1;
        if (score > bestScore) { best = fix; bestScore = score; }
      }
    }
    if (best && jumpTo(best.id)) return;
    if (tries > 0) setTimeout(() => findOnPage(target, tries - 1), 600);
  }

  // ------------------------------------------------------------------ hover: card and compact box

  let tipHost = null, tipRoot = null, card = null, box = null, tipFix = null, hideTimer = null;

  function buildTooltip() {
    tipHost = document.createElement('div');
    tipHost.id = 'iac-tooltip-host';
    tipHost.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
    tipRoot = tipHost.attachShadow({ mode: 'open' });
    tipRoot.innerHTML = `
      <style>
        .tip { position: fixed; pointer-events: auto; font: 13px/1.4 system-ui, -apple-system, sans-serif;
          background: #111827; color: #f9fafb; border-radius: 10px; padding: 8px 10px; min-width: 160px;
          max-width: 280px; box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: 0; transform: translateY(4px);
          transition: opacity .12s, transform .12s; visibility: hidden; }
        .tip.on { opacity: 1; transform: none; visibility: visible; }
        .cat { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase;
          letter-spacing: .04em; color: #9ca3af; margin-bottom: 4px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; }
        .ai { margin-left: auto; color: #a5b4fc; }
        .change { font-size: 14px; }
        .from { text-decoration: line-through; color: #fca5a5; }
        .plain .from { text-decoration: none; color: #d1d5db; }
        .globe { display: none; width: 13px; height: 13px; color: #9ca3af; margin-right: 6px; vertical-align: -2px; }
        .plain .globe { display: inline-block; }
        .plain .cat { display: none; }
        .arrow { color: #6b7280; margin: 0 4px; }
        .to { color: #fff; font-weight: 600; }
        .reason { color: #d1d5db; font-size: 12px; margin-top: 4px; }
        .reason:empty { display: none; }
        .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        button { font: inherit; font-size: 12px; border: 0; border-radius: 6px; padding: 3px 8px;
          cursor: pointer; background: #374151; color: #f9fafb; }
        button:hover { background: #4b5563; }

        .box { position: fixed; pointer-events: auto; box-sizing: border-box; display: flex; align-items: center;
          justify-content: center; white-space: nowrap; border-radius: 4px; border: 1px solid rgba(127,127,127,.45);
          box-shadow: 0 1px 6px rgba(0,0,0,.18); cursor: pointer; user-select: none; -webkit-user-select: none;
          touch-action: none; opacity: 0; visibility: hidden; transition: opacity .16s ease-out, visibility 0s .16s; }
        .box.on { opacity: 1; visibility: visible; transition: opacity .1s ease-out, visibility 0s; }
        .box .inner { position: absolute; inset: 2px; border-radius: 3px; background: #e5e7eb; transform: scale(0);
          transition: transform .12s ease-out, opacity .09s ease-out; }
        .box.pressing .inner { transform: scale(1); transition: transform ${HOLD_MS}ms cubic-bezier(.2,.8,.3,1); }
        .box.closing .inner { opacity: 0; transition: opacity .09s ease-out, transform .09s ease-out; }
        .box .word { position: relative; color: #dc2626; text-decoration: line-through; text-decoration-color: #dc2626;
          text-decoration-thickness: 1.5px; padding: 0 3px; }
        .box .globe { position: relative; margin: 0; color: #6b7280; }
        .box.plain .word { display: none; }
      </style>
      <div class="tip" role="tooltip">
        <div class="cat"><span class="dot"></span><span class="label"></span><span class="ai"></span></div>
        <div class="change"><svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Your spelling"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg><span class="from"></span><span class="arrow">→</span><span class="to"></span></div>
        <div class="reason"></div>
        <div class="actions"><button class="undo">Undo</button><button class="ignore">Never change this</button><button class="report" title="Mark this fix as wrong and send this page's report to Claude">Report</button></div>
      </div>
      <div class="box" role="button" aria-label="Click to undo, hold to never change this">
        <div class="inner"></div><span class="word"></span><svg class="globe" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Your spelling"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
      </div>`;
    card = tipRoot.querySelector('.tip');
    box = tipRoot.querySelector('.box');

    for (const el of [card, box]) {
      el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      el.addEventListener('mouseleave', () => { if (!box.classList.contains('pressing')) scheduleHide(); });
    }
    tipRoot.querySelector('.undo').addEventListener('click', () => {
      if (tipFix) setReverted(tipFix.id, true);
      hideTip();
    });
    tipRoot.querySelector('.ignore').addEventListener('click', () => {
      if (tipFix) neverChange(tipFix);
      hideTip();
    });
    tipRoot.querySelector('.report').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!tipFix) return;
      btn.textContent = 'Sending…';
      const res = await sendReport(tipFix);
      btn.textContent = res && res.ok ? 'Sent to Downloads ✓' : 'Couldn’t send';
      setTimeout(() => { btn.textContent = 'Report'; hideTip(); }, 1400);
    });

    // compact box: click = undo, press and hold = never change this
    let holdTimer = null, held = false;
    box.addEventListener('contextmenu', (e) => e.preventDefault());
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !tipFix) return;
      e.preventDefault();
      try { box.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or already released */ }
      held = false;
      box.classList.remove('closing');
      box.classList.add('pressing');
      clearTimeout(hideTimer);
      // held long enough: never change this (the box stays, full grey, until the press is released)
      holdTimer = setTimeout(() => {
        held = true;
        if (tipFix) neverChange(tipFix);
      }, HOLD_MS);
    });
    box.addEventListener('pointerup', () => {
      if (!box.classList.contains('pressing')) return;
      clearTimeout(holdTimer);
      const fix = tipFix;
      closeBox();
      if (fix && !held) setReverted(fix.id, true);
    });
    box.addEventListener('pointercancel', () => {
      clearTimeout(holdTimer);
      box.classList.remove('pressing');
    });
    document.documentElement.appendChild(tipHost);
  }

  // inner grey box fades a beat before the outer box
  function closeBox() {
    box.classList.add('closing');
    box.classList.remove('on');
    tipFix = null;
    setTimeout(() => box.classList.remove('pressing', 'closing'), 220);
  }

  function pageBackground(el) {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#ffffff';
  }

  function showTip(fix, rect, node) {
    if (!tipHost || !tipHost.isConnected) buildTooltip();
    clearTimeout(hideTimer);
    tipFix = fix;
    // Your spelling isn't a mistake: no strikethrough, a globe instead of a category, just the change (POLICY.md §7)
    const plain = fix.category === 'regional';
    card.classList.toggle('plain', plain);
    box.classList.toggle('plain', plain);
    if (settings.hover === 'compact') {
      card.classList.remove('on');
      const cs = getComputedStyle(node.parentElement);
      const word = box.querySelector('.word');
      word.textContent = fix.original;
      box.style.font = cs.font;
      box.style.letterSpacing = cs.letterSpacing;
      box.style.background = pageBackground(node.parentElement);
      box.style.height = rect.height + 4 + 'px';
      // Your spelling: just a globe, not the original (the page's spelling isn't a mistake)
      box.style.minWidth = (plain ? rect.height + 4 : rect.width + 6) + 'px';
      box.style.width = 'auto';
      box.classList.remove('pressing', 'closing');
      // float the original just above the fixed word (below if there's no room), centred on it;
      // with squiggles its bottom border sits on the squiggle and hides it
      const h = rect.height + 4;
      const bottom = settings.marks === 'squiggle' && active
        ? squiggleTop(rect, fontMetrics(node.parentElement)) + 3 : rect.top - 1;
      box.style.left = '0px';
      box.style.top = (bottom - h >= 0 ? bottom - h : rect.bottom + 1) + 'px';
      const w = box.getBoundingClientRect().width || rect.width + 6;
      box.style.left = Math.min(Math.max(2, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 2) + 'px';
      box.classList.add('on');
      return;
    }
    box.classList.remove('on');
    const meta = CATEGORIES[fix.category];
    card.querySelector('.dot').style.background = meta.color;
    card.querySelector('.label').textContent = meta.label;
    card.querySelector('.ai').textContent = fix.source === 'ai' ? 'AI' : '';
    card.querySelector('.from').textContent = fix.original;
    card.querySelector('.to').textContent = fix.replacement;
    card.querySelector('.reason').textContent = fix.source === 'ai' ? fix.reason || '' : '';
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 288);
    const below = rect.bottom + 6;
    card.style.left = left + 'px';
    card.style.top = (below + 110 > window.innerHeight ? rect.top - 112 : below) + 'px';
    card.classList.add('on');
  }

  function hideTip() {
    tipFix = null;
    if (card) card.classList.remove('on');
    if (box && box.classList.contains('on')) closeBox();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTip, settings.hover === 'compact' ? 120 : 250);
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      let pos;
      try {
        pos = shadowRoots.size
          ? document.caretPositionFromPoint(x, y, { shadowRoots: [...shadowRoots] })
          : document.caretPositionFromPoint(x, y);
      } catch (_) {
        pos = document.caretPositionFromPoint(x, y);
      }
      return pos && { node: pos.offsetNode, offset: pos.offset };
    }
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }

  function fixAtPoint(x, y) {
    const pos = caretAt(x, y);
    if (!pos || !pos.node || pos.node.nodeType !== Node.TEXT_NODE) return null;
    const rec = records.get(pos.node);
    if (!rec) return null;
    for (const fix of rec.fixes) {
      if (!fix.range) continue;
      for (const r of fix.range.getClientRects()) {
        if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return { fix, rect: r, node: pos.node };
      }
    }
    return null;
  }

  let moveFrame = 0;
  function onMouseMove(e) {
    if (moveFrame) return;
    const { clientX: x, clientY: y } = e;
    const path = e.composedPath ? e.composedPath() : [];
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (!active) return;
      if (tipHost && path.includes(tipHost)) return;
      const hit = fixAtPoint(x, y);
      if (hit) {
        if (hit.fix !== tipFix) showTip(hit.fix, hit.rect, hit.node);
        else clearTimeout(hideTimer);
      } else if (tipFix) {
        scheduleHide();
      }
    });
  }

  function onScroll() {
    hideTip();
    scheduleSquiggles();
  }

  // ------------------------------------------------------------------ lifecycle

  function start() {
    if (active) return;
    active = true;
    seedPageNames();
    applyMarkStyle();
    observer.observe(document.documentElement, OBSERVE_OPTS);
    for (const sr of shadowRoots) observer.observe(sr, OBSERVE_OPTS);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', scheduleSquiggles, { passive: true });
    enqueue(document.body || document.documentElement);
  }

  function stop() {
    if (!active) return;
    active = false;
    observer.disconnect();
    if (io) io.disconnect();
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', scheduleSquiggles);
    watchLayout(false);
    queue.length = 0;
    hideTip();
    restoreAll();
    drawSquiggles();
    publishFixes();
  }

  async function restart() {
    stop();
    loggedKeys.clear();
    traced.clear();
    aiBlocksSent = 0;
    blockState = new WeakMap();
    if (shouldRun()) {
      await Promise.all([loadDict(), loadUndone(), loadRegional()]);
      start();
    } else {
      updateBadge();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dictVersion) { loadDict(); return; }
    if (area !== 'sync') return;
    const raw = {};
    for (const [k, { newValue }] of Object.entries(changes)) raw[k] = newValue;
    const prev = settings;
    settings = normalizeSettings({ ...prev, ...raw });
    const keys = Object.keys(changes);
    // Cosmetic changes and new ignore rules don't need the page re-done.
    if (keys.every((k) => ['marks', 'hover', 'ignored', 'showMarks'].includes(k))) {
      applyMarkStyle();
      if (keys.includes('marks') || keys.includes('hover')) hideTip();
      return;
    }
    if (keys.length === 1 && keys[0] === 'ai' && prev.ai.url !== settings.ai.url) return;
    restart();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg && msg.type) {
      case 'iac:getPage':
        reply({ fixes: [...pageFixes(), ...missingUndos().map((u) => ({ id: 'undo:' + u.key, original: u.original,
          replacement: u.replacement, category: u.category, source: u.source, reason: u.reason, reverted: true,
          missing: true, before: u.before, after: u.after }))], active, host: location.hostname, highlights: !!supportsHighlights });
        break;
      case 'iac:getSelection':
        reply({ text: String(window.getSelection() || '').trim().slice(0, 2000) });
        break;
      case 'iac:comment': {
        const blocks = active ? commentBlocks(menuTarget) : [];
        trace({ kind: 'user', verdict: msg.action, why: active ? `${blocks.length} paragraphs` : 'extension off on this page' });
        if (!active) toast('Internet Autocorrect is off on this page');
        if (blocks.length) (msg.action === 'fix' ? fixComment : leaveComment)(blocks);
        reply({ ok: !!blocks.length });
        break;
      }
      case 'iac:jump':
        reply({ ok: jumpTo(msg.id) });
        break;
      case 'iac:find':
        findOnPage(msg.target);
        reply({ ok: true });
        break;
      case 'iac:setReverted':
        if (typeof msg.id === 'string' && msg.id.startsWith('undo:')) {
          // Redo of an undo whose text isn't on the page now: forget it, so the fix is made when the text shows.
          const u = undone.find((x) => 'undo:' + x.key === msg.id);
          if (u && !msg.reverted) { forgetUndo(u); rememberApply({ ...u }); }
          reply({ ok: !!u });
          break;
        }
        reply({ ok: setReverted(msg.id, msg.reverted) });
        break;
      default:
        return false;
    }
    return false;
  });

  // test harness only (test/chrome-shim.js sets this)
  if (window.__iacTest) {
    window.__iacState = () => ({
      active, settings, queue: queue.length, scheduled, aiBlocksSent,
      fixes: [...trackedNodes].flatMap((nd) => (records.get(nd)?.fixes || []).map((f) => `${f.original}>${f.replacement}:${f.state}`)),
    });
  }

  // After the extension is updated or reloaded, this copy of the script is cut off from it but keeps running
  // (its squiggles would stop following the page). Put the page back and step aside: background.js injects the
  // new version, which starts clean.
  const orphanWatch = setInterval(() => {
    let alive = false;
    try { alive = !!chrome.runtime?.id; } catch (_) { /* context invalidated */ }
    if (alive) return;
    clearInterval(orphanWatch);
    try { stop(); } catch (_) { /* ignore */ }
    marksHost?.remove();
    tipHost?.remove();
    window.__iacLoaded = false;
  }, 1500);

  (async () => {
    await loadSettings();
    if (!shouldRun()) return;
    await Promise.all([loadDict(), loadUndone(), loadRegional()]);
    start();
    // opened from History: show that change once it's on the page
    try {
      const res = await chrome.runtime.sendMessage({ type: 'iac:pendingFind' });
      if (res && res.target) findOnPage(res.target);
    } catch (_) { /* ignore */ }
  })();
})();
