/*
 * Internet Autocorrect — corrected copies.
 *
 * Text selected on the page is already corrected (the fixes are written into the page). But many sites copy from
 * their own copy of the text: chat apps' Copy buttons, "copy link text" menus, hidden textareas. This applies the
 * page's fixes to such text. Loaded in the page's own world (clipboard.js wraps the clipboard calls) and in the
 * extension's (content.js handles copies from hidden or read-only text boxes).
 */
(function (root) {
  'use strict';
  const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Copies differ from the page in spacing and markup (Markdown adds * _ ` and line breaks), so context is
  // compared on letters and digits only.
  const bare = (str) => String(str || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

  /**
   * fixes: [{ original, replacement, before, after }], before/after = the text around the fix as written.
   * A word is replaced only where the words around it match, so other uses of the same word are left alone.
   */
  function correctCopy(text, fixes) {
    if (typeof text !== 'string' || !text || !fixes || !fixes.length) return text;
    const edits = [];
    for (const f of fixes) {
      if (!f.original || !text.includes(f.original)) continue;
      const fb = bare(f.before).slice(-10), fa = bare(f.after).slice(0, 10);
      const re = new RegExp('(?<![A-Za-z])' + esc(f.original) + '(?![A-Za-z])', 'g');
      for (const m of text.matchAll(re)) {
        const s = m.index, e = s + f.original.length;
        const cb = bare(text.slice(Math.max(0, s - 60), s)), ca = bare(text.slice(e, e + 60));
        // the copy may start or end inside the context
        const okB = cb.endsWith(fb) || (cb.length < fb.length && fb.endsWith(cb));
        const okA = ca.startsWith(fa) || (ca.length < fa.length && fa.startsWith(ca));
        const shared = Math.min(cb.length, fb.length) + Math.min(ca.length, fa.length);
        const justTheWord = !cb && !ca; // the copy is the fixed word itself
        if (okB && okA && (shared >= 6 || justTheWord || (fb === cb && fa === ca))) edits.push([s, e, f.replacement]);
      }
    }
    if (!edits.length) return text;
    edits.sort((a, b) => a[0] - b[0]);
    let out = '', last = 0;
    for (const [s, e, r] of edits) {
      if (s < last) continue;
      out += text.slice(last, s) + r;
      last = e;
    }
    return out + text.slice(last);
  }

  const api = { correctCopy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IAC_CopyFix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
