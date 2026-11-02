// Popup shim: reuse the demo page iframe's chrome object so messages reach its content script.
window.chrome = parent.document.getElementById('page').contentWindow.chrome;
