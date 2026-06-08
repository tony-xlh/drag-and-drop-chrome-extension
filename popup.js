document.getElementById('injectBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Opening file picker...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { status.textContent = 'Cannot access tab'; return; }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: startPickAndDrop
    });

    status.textContent = 'Select a file, then click on the upload area of the page.';
  } catch (err) {
    status.textContent = 'Error: ' + (err.message || 'injection failed');
  }
});

// ====== Injected into page MAIN world ======
function startPickAndDrop() {
  // Trusted Types policy for pages like Gmail that enforce it
  var setHTML;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    var policy;
    try {
      policy = window.trustedTypes.createPolicy('__dragDropExt', {
        createHTML: function (s) { return s; }
      });
    } catch (e) { /* policy may already exist */ }
    setHTML = function (el, html) {
      if (policy) { el.innerHTML = policy.createHTML(html); }
      else { el.innerHTML = html; }
    };
  } else {
    setHTML = function (el, html) { el.innerHTML = html; };
  }

  // Clean up any previous instance
  if (window.__dragDropActive) {
    const oldOverlay = document.getElementById('__ext_drop_overlay');
    if (oldOverlay) oldOverlay.remove();
    const oldInput = document.getElementById('__ext_temp_input');
    if (oldInput) oldInput.remove();
  }
  window.__dragDropActive = true;

  // ---- Create hidden file input ----
  const input = document.createElement('input');
  input.type = 'file';
  input.id = '__ext_temp_input';
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(input);

  let pendingFile = null;

  // When file dialog closes (user cancels), the window regains focus
  function onWindowFocus() {
    window.removeEventListener('focus', onWindowFocus);
    setTimeout(function () {
      const inp = document.getElementById('__ext_temp_input');
      if (inp && inp.files.length === 0) {
        inp.remove();
        window.__dragDropActive = false;
      }
    }, 300);
  }

  input.addEventListener('change', function () {
    window.removeEventListener('focus', onWindowFocus);
    const file = input.files[0];
    input.remove();

    if (!file) {
      window.__dragDropActive = false;
      return;
    }

    pendingFile = file;
    showDropOverlay(file);
  });

  window.addEventListener('focus', onWindowFocus);
  input.click();

  // ---- File selected, show click-to-drop overlay ----
  function showDropOverlay(file) {
    const existing = document.getElementById('__ext_drop_overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = '__ext_drop_overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'z-index:2147483646;cursor:copy;' +
      'background:rgba(203,166,247,0.06);';

    const name = file.name.length > 40
      ? file.name.slice(0, 37) + '...'
      : file.name;

    const hint = document.createElement('div');
    hint.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'padding:16px 32px;background:#1e1e2e;color:#cdd6f4;' +
      'border:2px solid #cba6f7;border-radius:12px;' +
      'font-family:system-ui,sans-serif;font-size:14px;font-weight:600;' +
      'pointer-events:none;box-shadow:0 4px 24px rgba(0,0,0,0.5);' +
      'z-index:2147483647;text-align:center;';
    setHTML(hint,
      'Click on the upload area<br>' +
      'to drop <span style="color:#cba6f7;">' + escapeHtml(name) + '</span><br>' +
      '<span style="font-size:11px;color:#a6adc8;">or press Esc to cancel</span>');

    overlay.appendChild(hint);

    // ---- Debug panel ----
    const debugDiv = document.createElement('div');
    debugDiv.style.cssText =
      'position:fixed;bottom:8px;left:8px;' +
      'padding:8px 12px;background:rgba(0,0,0,0.85);color:#a6e3a1;' +
      'font-family:monospace;font-size:11px;line-height:1.6;' +
      'border-radius:6px;pointer-events:none;' +
      'z-index:2147483647;max-width:480px;white-space:pre-wrap;' +
      'min-width:200px;min-height:20px;';
    debugDiv.textContent = 'debug: waiting for mouse move...';
    overlay.appendChild(debugDiv);

    document.body.appendChild(overlay);

    // ---- Highlight drop targets on hover ----
    let highlightedEl = null;
    let originalOutline = '';
    let lastCheck = 0;
    const originalHintHTML = hint.innerHTML;
    let hintChanged = false;

    function findDropTarget(el) {
      // Fast path: check for inline handlers and known patterns.
      // Use nodeType===1 instead of comparing to document.body/documentElement,
      // so we can walk the DOM tree inside iframes too.
      let current = el;
      let depth = 0;
      while (current && current.nodeType === 1 && depth < 12) {
        if (current.ondrop || current.ondragover || current.ondragenter) return current;
        if (current.tagName === 'INPUT' && current.type === 'file') return current;
        depth++;
        current = current.parentElement;
      }
      // Slow path: dispatch a test dragover to detect addEventListener-based handlers
      try {
        const dt = new DataTransfer();
        const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        el.dispatchEvent(ev);
        if (ev.defaultPrevented) return el;
      } catch (e) { /* ignore */ }
      return null;
    }

    function unhighlight() {
      if (highlightedEl) {
        highlightedEl.style.outline = originalOutline;
        highlightedEl = null;
      }
    }

    function setHintFound() {
      if (!hintChanged) {
        hintChanged = true;
        hint.style.borderColor = '#a6e3a1';
        setHTML(hint,
          '<span style="color:#a6e3a1;">Drop target detected</span><br>' +
          'Click to drop <span style="color:#cba6f7;">' + escapeHtml(name) + '</span><br>' +
          '<span style="font-size:11px;color:#a6adc8;">or press Esc to cancel</span>');
      }
    }

    function setHintDefault() {
      if (hintChanged) {
        hintChanged = false;
        hint.style.borderColor = '#cba6f7';
        setHTML(hint, originalHintHTML);
      }
    }

    function describeEl(el) {
      if (!el) return 'null';
      var tag = el.tagName ? el.tagName.toLowerCase() : '?';
      var id = el.id ? '#' + el.id : '';
      var cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
      var txt = (el.textContent || '').trim().slice(0, 30);
      return tag + id + cls + (txt ? ' "' + txt + '"' : '');
    }

    // Drill into same-origin iframes to get the real element at a point.
    // Returns { el, doc, surface } so callers can dispatch events into the right document.
    function deepElementFromPoint(x, y) {
      // Use elementsFromPoint + filter to see through our overlay
      const all = document.elementsFromPoint(x, y);
      const topEl = all.find(function (el) {
        return el !== overlay && el !== hint && el.id !== '__ext_drop_overlay';
      });
      if (!topEl) return { el: null, doc: document, surface: null };

      if (topEl.tagName === 'IFRAME') {
        try {
          var innerDoc = topEl.contentDocument || topEl.contentWindow.document;
          if (innerDoc) {
            var rect = topEl.getBoundingClientRect();
            var innerEl = innerDoc.elementFromPoint(x - rect.left, y - rect.top);
            if (innerEl) {
              return { el: innerEl, doc: innerDoc, surface: topEl };
            }
          }
        } catch (e) {
          // cross-origin iframe — use the iframe element itself
        }
      }

      return { el: topEl, doc: document, surface: topEl };
    }

    overlay.addEventListener('mousemove', function (e) {
      const now = Date.now();
      if (now - lastCheck < 120) return;
      lastCheck = now;

      var deep = deepElementFromPoint(e.clientX, e.clientY);
      var target = deep.el;
      var surfaceTarget = deep.surface;

      var debugLines = [];
      debugLines.push('mouse: (' + e.clientX + ', ' + e.clientY + ')');
      debugLines.push('surface: ' + describeEl(surfaceTarget));
      if (target !== surfaceTarget) {
        debugLines.push('deep:   ' + describeEl(target) + ' [inside iframe]');
      } else {
        debugLines.push('target: ' + describeEl(target));
      }

      if (!target || target === document.documentElement || target === document.body) {
        debugLines.push('result: skipped (doc/body)');
        debugDiv.textContent = debugLines.join('\n');
        unhighlight();
        setHintDefault();
        return;
      }

      const dropTarget = findDropTarget(target);
      if (dropTarget) {
        debugLines.push('result: DROP TARGET: ' + describeEl(dropTarget));
        debugDiv.textContent = debugLines.join('\n');
        if (dropTarget !== highlightedEl) {
          unhighlight();
          highlightedEl = dropTarget;
          originalOutline = highlightedEl.style.outline;
          highlightedEl.style.outline = '2px solid #cba6f7';
          highlightedEl.style.outlineOffset = '1px';
        }
        setHintFound();
      } else {
        debugLines.push('result: no drop handler');
        debugDiv.textContent = debugLines.join('\n');
        unhighlight();
        setHintDefault();
      }
    });

    function cleanup() {
      unhighlight();
      overlay.remove();
      removeKeyHandler();
      pendingFile = null;
      window.__dragDropActive = false;
    }

    // ---- Click → find real target and simulate drop ----
    overlay.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const deep = deepElementFromPoint(e.clientX, e.clientY);
      if (deep.el && pendingFile) {
        simulateDrop(deep.el, e.clientX, e.clientY, pendingFile, deep.doc);
      }

      cleanup();
    });

    // ---- Esc to cancel ----
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
      }
    }
    function removeKeyHandler() {
      document.removeEventListener('keydown', onKeyDown);
    }
    document.addEventListener('keydown', onKeyDown);
  }

  // ---- Simulate drag-and-drop using native DragEvent + DataTransfer ----
  function simulateDrop(target, x, y, file, doc) {
    var win = doc ? (doc.defaultView || doc.ownerDocument.defaultView) : window;
    var dt = new win.DataTransfer();
    dt.items.add(file);

    // Convert coordinates if target is inside an iframe
    var cx = x, cy = y;
    if (doc && doc !== document) {
      var frameEl = doc.defaultView ? doc.defaultView.frameElement : null;
      if (frameEl) {
        var r = frameEl.getBoundingClientRect();
        cx = x - r.left;
        cy = y - r.top;
      }
    }

    var eventConfig = {
      bubbles: true,
      cancelable: true,
      view: win,
      clientX: cx,
      clientY: cy,
      screenX: x,
      screenY: y,
      dataTransfer: dt
    };

    // Dispatch the full drag sequence: dragenter → dragover → drop
    target.dispatchEvent(new win.DragEvent('dragenter', eventConfig));
    target.dispatchEvent(new win.DragEvent('dragover', eventConfig));
    target.dispatchEvent(new win.DragEvent('drop', eventConfig));

    showToast('File dropped!', 'success');
  }

  // ---- Helpers ----
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function showToast(msg, type) {
    const existing = document.getElementById('__ext_toast');
    if (existing) existing.remove();

    const bg = type === 'success' ? '#a6e3a1' : '#f9e2af';
    const toast = document.createElement('div');
    toast.id = '__ext_toast';
    toast.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;padding:12px 20px;border-radius:10px;' +
      'font-size:14px;font-weight:600;font-family:system-ui,sans-serif;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;' +
      'transition:opacity 0.4s;' +
      'background:' + bg + ';color:#1e1e2e;';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, 3000);
  }
}
