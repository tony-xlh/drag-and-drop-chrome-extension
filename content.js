(() => {
  if (window.__dragUploadInit) return;
  window.__dragUploadInit = true;

  let dragFile = null;
  let handleEl = null;

  function cleanup() {
    document.removeEventListener('dragover', onDocDragOver, true);
    if (handleEl) { handleEl.remove(); handleEl = null; }
    dragFile = null;
  }

  function createHandle(name, size) {
    const existing = document.getElementById('__ext_drag_handle');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = '__ext_drag_handle';
    el.draggable = true;
    el.innerHTML = `
      <div style="
        position:fixed;bottom:24px;right:24px;z-index:2147483647;
        background:#1e1e2e;color:#cdd6f4;border:2px solid #cba6f7;
        border-radius:12px;padding:14px 18px;cursor:grab;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        font-size:13px;box-shadow:0 4px 24px rgba(0,0,0,0.5);
        display:flex;align-items:center;gap:10px;user-select:none;
      ">
        <span style="font-size:22px;">📄</span>
        <div>
          <div style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>
          <div style="font-size:11px;color:#a6adc8;">${escapeHtml(size)} — Drag me to upload</div>
        </div>
        <button id="__ext_drag_close" style="
          background:none;border:none;color:#6c7086;cursor:pointer;
          font-size:16px;line-height:1;padding:0 0 0 4px;
        " title="Cancel">✕</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('#__ext_drag_close').addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });

    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);

    return el;
  }

  function onDragStart(e) {
    // Add the real File object — this makes it a genuine drag that websites can read
    e.dataTransfer.items.add(dragFile);
    e.dataTransfer.effectAllowed = 'copy';
    handleEl.style.opacity = '0.5';

    // Prevent page elements from blocking the drop
    document.addEventListener('dragover', onDocDragOver, true);
  }

  function onDragEnd() {
    document.removeEventListener('dragover', onDocDragOver, true);
    if (handleEl) { handleEl.style.opacity = ''; }
    cleanup();
  }

  function onDocDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CLEANUP') {
      cleanup();
      return;
    }

    if (msg.type !== 'FILE_SELECTED') return;

    try {
      cleanup();

      dragFile = new File(
        [new Uint8Array(msg.fileData)],
        msg.fileName,
        { type: msg.fileType, lastModified: Date.now() }
      );
      handleEl = createHandle(msg.fileName, formatSize(msg.fileSize));
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  });
})();
