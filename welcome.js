// First-run page. The AI checker starts off; the download needs a click, so it's offered here.
(async () => {
  const on = document.getElementById('aiOn');
  const note = document.getElementById('aiNote');
  const OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

  const { ai } = await chrome.storage.sync.get('ai');
  if (ai?.engine && ai.engine !== 'off') { note.textContent = 'The AI checker is on. You can change it in Settings.'; return; }
  let state = 'unavailable';
  try { if (typeof LanguageModel !== 'undefined') state = await LanguageModel.availability(OPTIONS); } catch (_) { /* unavailable */ }
  if (state === 'unavailable') {
    note.textContent = 'Chrome’s model isn’t available on this computer, so the extension will use its rules. You can turn on the Built-in checker, or Ollama if you run it, in Settings.';
    return;
  }
  on.hidden = false;
  on.addEventListener('click', async () => {
    on.disabled = true;
    try {
      const session = await LanguageModel.create({
        ...OPTIONS,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            note.textContent = `Downloading the model… ${Math.round(e.loaded * 100)}% (you can close this page; it keeps going)`;
          });
        },
      });
      session.destroy();
      const { ai: now = {} } = await chrome.storage.sync.get('ai');
      await chrome.storage.sync.set({ ai: { verify: true, read: true, url: 'http://localhost:11434', model: '', ...now, engine: 'nano' } });
      on.hidden = true;
      note.textContent = 'The AI checker is on. You can change it in Settings.';
    } catch (e) {
      on.disabled = false;
      note.textContent = 'The download didn’t work: ' + (e.message || e);
    }
  });
})();
