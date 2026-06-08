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

    // Drag state: maintain across mousemove events so the page has time
    // to render its drop zone before the user clicks.
    var currentDragTarget = null;
    var currentDragDoc = null;
    var dragDT = null;

    function leaveCurrentDragTarget() {
      if (currentDragTarget && dragDT) {
        try {
          currentDragTarget.dispatchEvent(new DragEvent('dragleave', {
            bubbles: true, cancelable: true, dataTransfer: dragDT
          }));
        } catch (e) { /* ignore */ }
        currentDragTarget = null;
        currentDragDoc = null;
      }
    }

    function findBestDropTarget(el) {
      // Walk up to find the best ancestor to dispatch drop events on.
      // Prefer contenteditable, textbox roles, file inputs, canvas, and
      // elements with inline drop handlers over leaf text nodes.
      let current = el;
      let depth = 0;
      while (current && current.nodeType === 1 && depth < 14) {
        if (current.ondrop || current.ondragover || current.ondragenter) return current;
        if (current.tagName === 'INPUT' && current.type === 'file') return current;
        if (current.tagName === 'CANVAS') return current;
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return current;
        var role = current.getAttribute && current.getAttribute('role');
        if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return current;
        depth++;
        current = current.parentElement;
      }
      return el;
    }

    function looksLikeDropZone(el) {
      var current = el;
      var depth = 0;
      while (current && current.nodeType === 1 && depth < 8) {
        var tag = current.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'LABEL' || tag === 'FORM' || tag === 'CANVAS') return true;
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return true;
        var cls = current.className;
        if (cls && typeof cls === 'string') {
          cls = cls.toLowerCase();
          if (/(drop|upload|attach|dnd|drag|file|paste|compose|editor|input|dropzone)/.test(cls)) return true;
        }
        depth++;
        current = current.parentElement;
      }
      return false;
    }

    function findDropTarget(el, doc) {
      // Fast path: walk up DOM for inline handlers / known attributes
      var current = el;
      var depth = 0;
      while (current && current.nodeType === 1 && depth < 14) {
        if (current.ondrop || current.ondragover || current.ondragenter) return current;
        if (current.tagName === 'INPUT' && current.type === 'file') return current;
        if (current.tagName === 'CANVAS') return current;
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return current;
        var role = current.getAttribute && current.getAttribute('role');
        if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return current;
        depth++;
        current = current.parentElement;
      }
      // Slow path: maintain real drag state across mousemove events so the
      // page has time to render its drop zone (React/etc. render async).
      if (!pendingFile) return null;
      if (!looksLikeDropZone(el)) {
        leaveCurrentDragTarget();
        return null;
      }

      try {
        if (!dragDT) {
          dragDT = new DataTransfer();
          dragDT.effectAllowed = 'copy';
          dragDT.dropEffect = 'copy';
          dragDT.items.add(pendingFile);
        }

        var target = findBestDropTarget(el);

        if (target !== currentDragTarget) {
          leaveCurrentDragTarget();
          target.dispatchEvent(new DragEvent('dragenter', {
            bubbles: true, cancelable: true, dataTransfer: dragDT
          }));
          currentDragTarget = target;
          currentDragDoc = doc;
        } else if (currentDragTarget) {
          // Still on the same target — keep drag session alive
          currentDragTarget.dispatchEvent(new DragEvent('dragover', {
            bubbles: true, cancelable: true, dataTransfer: dragDT
          }));
        }

        return currentDragTarget;
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

      const dropTarget = findDropTarget(target, deep.doc);
      if (dropTarget) {
        // findBestDropTarget may find a better ancestor (e.g. contenteditable)
        // than what the slow path (test dispatch) returned.
        var highlightEl = findBestDropTarget(target);
        if (highlightEl === target) highlightEl = dropTarget;

        debugLines.push('result: DROP TARGET: ' + describeEl(dropTarget));
        if (highlightEl !== dropTarget) {
          debugLines.push('highlight: ' + describeEl(highlightEl));
        }
        debugDiv.textContent = debugLines.join('\n');
        if (highlightEl !== highlightedEl) {
          unhighlight();
          highlightedEl = highlightEl;
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
      leaveCurrentDragTarget();
      dragDT = null;
      overlay.remove();
      removeKeyHandler();
      pendingFile = null;
      window.__dragDropActive = false;
    }

    // ---- Click → drop on the already-revealed drop zone ----
    overlay.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const deep = deepElementFromPoint(e.clientX, e.clientY);
      if (deep.el && pendingFile) {
        // Hide overlay so it doesn't block the page's drop zone
        overlay.style.display = 'none';
        unhighlight();
        removeKeyHandler();

        var dropEl = highlightedEl || currentDragTarget || findBestDropTarget(deep.el);
        var doc = currentDragDoc || deep.doc;

        if (dropEl) {
          // Ensure we have a DataTransfer (fast-path may have skipped dragenter)
          if (!dragDT) {
            dragDT = new DataTransfer();
            dragDT.effectAllowed = 'copy';
            dragDT.dropEffect = 'copy';
            dragDT.items.add(pendingFile);
          }

          try {
            dropEl.dispatchEvent(new DragEvent('dragover', {
              bubbles: true, cancelable: true, dataTransfer: dragDT
            }));
            dropEl.dispatchEvent(new DragEvent('drop', {
              bubbles: true, cancelable: true, dataTransfer: dragDT
            }));
            leaveCurrentDragTarget();
            showToast('File dropped!', 'success');
          } catch (err) { /* ignore */ }
        }

        dragDT = null;
        overlay.remove();
        pendingFile = null;
        window.__dragDropActive = false;
      } else {
        cleanup();
      }
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
