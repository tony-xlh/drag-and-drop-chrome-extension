document.getElementById('injectBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Opening file picker...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { status.textContent = 'Cannot access tab'; return; }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: injectAndSelect
    });

    status.textContent = 'File dialog should open on the page...';
  } catch (err) {
    status.textContent = 'Error: ' + (err.message || 'injection failed');
  }
});

// ====== Injected into page MAIN world ======
function injectAndSelect() {
  if (document.getElementById('__ext_temp_input')) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.id = '__ext_temp_input';
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(input);

  input.addEventListener('change', function () {
    const file = input.files[0];
    if (!file) { cleanup(); return; }

    const existing = document.getElementById('__ext_drag_handle');
    if (existing) existing.remove();

    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();

    reader.onload = function () {
      const dataUrl = /** @type {string} */ (reader.result);

      if (isImage) {
        createDraggableImage(file, dataUrl, null);
      } else {
        // Pre-decode data URL → Blob → File so dragstart is fast
        const blob = dataUrlToBlob(dataUrl);
        const dragFile = new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
        createDraggableCard(file, dataUrl, dragFile);
      }

      showToast('Drag it into any drop zone on the page.', 'success');
    };
    reader.readAsDataURL(file);

    cleanup();
  });

  input.click();

  function cleanup() {
    input.remove();
  }

  // ======== Data URL → Blob (sync) ========
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    while (n--) { u8arr[n] = bstr.charCodeAt(n); }
    return new Blob([u8arr], { type: mime });
  }

  // ======== Draggable image (native <img> drag) ========
  function createDraggableImage(file, dataUrl, _unused) {
    const wrapper = document.createElement('div');
    wrapper.id = '__ext_drag_handle';
    wrapper.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:2147483647;' +
      'display:flex;flex-direction:column;align-items:center;';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = file.name;
    img.style.cssText =
      'max-width:200px;max-height:200px;border-radius:10px;' +
      'border:2px solid #cba6f7;box-shadow:0 4px 24px rgba(0,0,0,0.5);' +
      'display:block;background:#1e1e2e;object-fit:contain;' +
      'cursor:grab;';

    const label = document.createElement('div');
    label.style.cssText =
      'margin-top:6px;padding:4px 10px;border-radius:6px;' +
      'background:#1e1e2e;color:#cdd6f4;font-size:11px;' +
      'font-family:system-ui,sans-serif;text-align:center;' +
      'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    label.textContent = file.name;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;' +
      'border:2px solid #cba6f7;background:#1e1e2e;color:#cdd6f4;font-size:14px;' +
      'cursor:pointer;line-height:1;padding:0;z-index:1;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      wrapper.remove();
    });

    wrapper.appendChild(img);
    wrapper.appendChild(label);
    wrapper.appendChild(closeBtn);

    img.addEventListener('dragstart', function (e) {
      e.dataTransfer.effectAllowed = 'copy';
      img.style.opacity = '0.5';
      document.addEventListener('dragover', onDocDragOver, false);
    });

    img.addEventListener('dragend', function () {
      document.removeEventListener('dragover', onDocDragOver, false);
      img.style.opacity = '';
    });

    document.body.appendChild(wrapper);
  }

  // ======== Draggable file card (div + items.add) ========
  function createDraggableCard(file, dataUrl, dragFile) {
    const wrapper = document.createElement('div');
    wrapper.id = '__ext_drag_handle';
    wrapper.draggable = true;
    wrapper.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:2147483647;' +
      'cursor:grab;user-select:none;';

    const iconMap = {
      'application/pdf': '📄',
      'application/zip': '📦',
      'text/': '📃',
      'video/': '🎥',
      'audio/': '🎵',
    };
    let icon = '📄';
    for (const [key, val] of Object.entries(iconMap)) {
      if (file.type.startsWith(key)) { icon = val; break; }
    }

    const card = document.createElement('div');
    card.style.cssText =
      'background:#1e1e2e;color:#cdd6f4;border:2px solid #cba6f7;' +
      'border-radius:12px;padding:14px 18px;' +
      'font-family:system-ui,sans-serif;font-size:13px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;gap:10px;';
    card.innerHTML =
      '<span style="font-size:22px;">' + icon + '</span>' +
      '<div>' +
      '<div style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(file.name) + '</div>' +
      '<div style="font-size:11px;color:#a6adc8;">' + formatSize(file.size) + ' — Drag me to upload</div>' +
      '</div>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;' +
      'border:2px solid #cba6f7;background:#1e1e2e;color:#cdd6f4;font-size:14px;' +
      'cursor:pointer;line-height:1;padding:0;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      wrapper.remove();
    });

    wrapper.appendChild(card);
    wrapper.appendChild(closeBtn);

    wrapper.addEventListener('dragstart', function (e) {
      e.dataTransfer.items.add(dragFile);
      e.dataTransfer.effectAllowed = 'copy';
      wrapper.style.opacity = '0.5';
      document.addEventListener('dragover', onDocDragOver, false);
    });

    wrapper.addEventListener('dragend', function () {
      document.removeEventListener('dragover', onDocDragOver, false);
      wrapper.style.opacity = '';
    });

    document.body.appendChild(wrapper);
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

    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, 3000);
  }
}
