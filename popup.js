document.getElementById('injectBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Injecting...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { status.textContent = 'Cannot access tab'; return; }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: injectAndSelect
    });

    // Popup will close when file dialog opens; that's expected
    status.textContent = 'File dialog should open on the page...';
  } catch (err) {
    status.textContent = 'Error: ' + (err.message || 'injection failed');
  }
});

// ====== Injected into page MAIN world ======
function injectAndSelect() {
  // Don't inject twice
  if (document.getElementById('__ext_temp_input')) return;

  // Create a temporary file input to trigger OS file picker
  const input = document.createElement('input');
  input.type = 'file';
  input.id = '__ext_temp_input';
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(input);

  input.addEventListener('change', function() {
    const file = input.files[0];
    if (!file) { cleanup(); return; }

    // Find ALL file inputs on the page (excluding our temp one)
    const pageInputs = document.querySelectorAll('input[type="file"]:not(#__ext_temp_input)');

    let injected = 0;
    const dt = new DataTransfer();
    dt.items.add(file);

    for (const pageInput of pageInputs) {
      try {
        pageInput.files = dt.files;
        pageInput.dispatchEvent(new Event('change', { bubbles: true }));
        injected++;

        // Also dispatch input event (some frameworks use this)
        pageInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) {}
    }

    // Show result on page
    showToast(
      injected > 0
        ? 'Injected "' + file.name + '" into ' + injected + ' file input(s)'
        : 'File "' + file.name + '" selected, but no file inputs found on this page.',
      injected > 0 ? 'success' : 'warn'
    );

    cleanup();
  });

  // Trigger OS file dialog
  input.click();

  function cleanup() {
    input.remove();
  }

  function showToast(msg, type) {
    const existing = document.getElementById('__ext_toast');
    if (existing) existing.remove();

    const bg = type === 'success' ? '#a6e3a1' : '#f9e2af';
    const fg = '#1e1e2e';
    const toast = document.createElement('div');
    toast.id = '__ext_toast';
    toast.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;' +
      'font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);' +
      'pointer-events:none;transition:opacity 0.4s;' +
      'background:' + bg + ';color:' + fg + ';';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 400);
    }, 3000);
  }
}
