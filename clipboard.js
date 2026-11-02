/*
 * Internet Autocorrect — runs in the page's own world (manifest "world": "MAIN"), so it can see what the page
 * puts on the clipboard. content.js sends it the page's current fixes (event "iac-fixes"); it applies them to
 * text the page copies from its own data (Copy buttons, copy handlers). Nothing is sent anywhere.
 */
(() => {
  'use strict';
  if (window.__iacClipboard) return;
  window.__iacClipboard = true;
  const { correctCopy } = window.IAC_CopyFix;

  let fixes = [];
  document.addEventListener('iac-fixes', (e) => {
    try { fixes = JSON.parse(e.detail) || []; } catch (_) { /* ignore */ }
  });
  const fix = (t) => (fixes.length && typeof t === 'string' ? correctCopy(t, fixes) : t);

  const C = typeof Clipboard === 'function' && Clipboard.prototype;
  if (C && C.writeText) {
    const writeText = C.writeText;
    C.writeText = function (text) { return writeText.call(this, fix(text)); };
  }
  if (C && C.write && typeof ClipboardItem === 'function') {
    const write = C.write;
    C.write = function (items) {
      if (!fixes.length || !Array.isArray(items)) return write.call(this, items);
      // ClipboardItem takes promises, so the new items are built straight away and the user's click still counts
      const fixed = items.map((item) => {
        if (!item.types.includes('text/plain')) return item;
        const parts = {};
        for (const type of item.types) {
          parts[type] = type === 'text/plain'
            ? item.getType(type).then((b) => b.text()).then((t) => new Blob([fix(t)], { type }))
            : item.getType(type);
        }
        return new ClipboardItem(parts);
      });
      return write.call(this, fixed);
    };
  }
  if (typeof DataTransfer === 'function') {
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type, data) {
      return setData.call(this, type, /^text(\/plain)?$/i.test(type) ? fix(data) : data);
    };
  }
})();
