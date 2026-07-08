/**
 * Visor PDF con resaltado (PDX + Armado). Modal o página dedicada.
 */
(function (global) {
  'use strict';

  let pdfjsLib = null;
  let pdfjsLoading = null;

  const MARK_COLORS = ['yellow', 'green', 'pink', 'blue'];

  function loadPdfJsScript() {
    return new Promise((resolve, reject) => {
      const lib = global.pdfjsLib || global['pdfjs-dist/build/pdf'];
      if (lib?.getDocument) {
        resolve(lib);
        return;
      }
      const existing = document.querySelector('script[data-innar-pdfjs]');
      if (existing) {
        existing.addEventListener('load', () => {
          const l = global.pdfjsLib || global['pdfjs-dist/build/pdf'];
          if (l?.getDocument) resolve(l);
          else reject(new Error('PDF.js no inicializó'));
        });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar PDF.js')));
        return;
      }
      const s = document.createElement('script');
      s.src = '/libs/pdfjs/pdf.min.js';
      s.dataset.innarPdfjs = '1';
      s.onload = () => {
        const l = global.pdfjsLib || global['pdfjs-dist/build/pdf'];
        if (!l?.getDocument) {
          reject(new Error('PDF.js no disponible tras cargar'));
          return;
        }
        l.GlobalWorkerOptions.workerSrc = '/libs/pdfjs/pdf.worker.min.js';
        resolve(l);
      };
      s.onerror = () => reject(new Error('No se pudo cargar el visor PDF (/libs/pdfjs/pdf.min.js)'));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs() {
    if (pdfjsLib) return pdfjsLib;
    if (!pdfjsLoading) {
      pdfjsLoading = loadPdfJsScript().then((lib) => {
        pdfjsLib = lib;
        return pdfjsLib;
      });
    }
    return pdfjsLoading;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function markBg(color) {
    const map = {
      yellow: 'rgba(253,224,71,0.32)',
      green: 'rgba(134,239,172,0.32)',
      pink: 'rgba(249,168,212,0.32)',
      blue: 'rgba(147,197,253,0.32)'
    };
    return map[color] || map.yellow;
  }

  async function renderPageTextLayer(lib, page, viewport, wrap) {
    const layer = document.createElement('div');
    layer.className = 'sop-pdf-text-layer textLayer';
    layer.setAttribute('aria-hidden', 'true');
    const textContent = await page.getTextContent();
    const task = lib.renderTextLayer({
      textContentSource: textContent,
      container: layer,
      viewport
    });
    await (task?.promise ?? task);
    wrap.appendChild(layer);
  }

  /**
   * Monta el visor en un contenedor (modal o página).
   * @returns {Promise<{ destroy: function }>}
   */
  async function mountPdfViewer(container, opts) {
    const pdfUrl = opts.pdfUrl;
    const saveUrl = opts.saveUrl || '';
    const downloadUrl = opts.downloadUrl || pdfUrl.replace(/\/ver(\?|$)/, '/descargar$1').replace(/\?inline=1/, '');
    const canEdit = !!opts.canEdit && !!saveUrl;
    const apiFetch = opts.apiFetch || global.apiFetch;
    const toast = opts.toast || global.showToast || (() => {});
    const isPage = opts.layout === 'page';
    const closeLabel = isPage ? 'Cerrar pestaña' : 'Cerrar';

    const saveInTopbar = isPage && !!opts.saveInTopbar && canEdit;

    const shell = document.createElement('div');
    shell.className = 'sop-pdf-editor is-select-mode'
      + (isPage ? ' sop-pdf-editor--page' : '')
      + (saveInTopbar ? ' sop-pdf-editor--topbar-save' : '');
    const appendUrl = opts.appendUrl || '';
    const deletePagesUrl = opts.deletePagesUrl || '';
    const reorderPagesUrl = opts.reorderPagesUrl || '';
    const canDeletePages = canEdit && isPage && !!deletePagesUrl;
    const canReorderPages = canEdit && isPage && !!reorderPagesUrl;
    const hintSelect = isPage
      ? 'Seleccione texto (Ctrl+C). Use <strong>Resaltar</strong>, <strong>Añadir PDF</strong> o <strong>Eliminar páginas</strong> y guarde los cambios.'
      : 'Seleccione el texto con el ratón y copie con <strong>Ctrl+C</strong> (o clic derecho → Copiar).';
    const hintHighlight = isPage
      ? 'Arrastre para resaltar. Guarde antes de añadir otro PDF si ya tiene marcas pendientes.'
      : 'Modo resaltar: arrastre sobre el documento. Pulse <strong>Guardar en PDF</strong> para que las marcas queden al descargar.';
    const hintDelete = 'Marque las páginas a quitar y pulse <strong>Eliminar seleccionadas</strong>. Debe quedar al menos una página.';
    const hintReorder = 'Arrastre las páginas en la lista para definir el orden y confirme con <strong>Guardar orden</strong>.';
    shell.innerHTML = `
      <div class="sop-pdf-editor-header">
        <h3>${escapeHtml(opts.title || 'Documento PDF')}</h3>
        <div class="sop-pdf-editor-toolbar">
          ${canEdit ? `
          <div class="sop-pdf-editor-modes" role="group" aria-label="Modo del visor">
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm is-active" id="sopPdfEdModeSelect" title="Seleccionar y copiar texto">Seleccionar texto</button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdModeHighlight" title="Dibujar resaltados">Resaltar</button>
            ${canDeletePages ? '<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdModeDelete" title="Quitar páginas del PDF">Eliminar páginas</button>' : ''}
            ${canReorderPages ? '<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdModeReorder" title="Cambiar el orden de las páginas del PDF">Reordenar</button>' : ''}
          </div>
          <div class="sop-pdf-editor-colors is-hidden" role="group" aria-label="Color de resaltado" id="sopPdfEdColors">
            ${MARK_COLORS.map((c, i) => {
              const bg = { yellow: '#fde047', green: '#4ade80', pink: '#f472b6', blue: '#60a5fa' }[c] || '#fde047';
              return `<button type="button" class="sop-pdf-editor-color${i === 0 ? ' is-active' : ''}" data-color="${c}" title="${c}" aria-label="Color ${c}" style="background-color:${bg}"></button>`;
            }).join('')}
          </div>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm is-hidden" id="sopPdfEdUndo">Deshacer</button>
          ${isPage && appendUrl ? `<label class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdAnexarLbl" title="Añadir páginas de otro PDF al final">Añadir PDF
            <input type="file" id="sopPdfEdAnexarInp" accept=".pdf,application/pdf" multiple class="sop-file-input-hidden">
          </label>` : ''}
          ` : ''}
          <a class="sop-btn sop-btn-ghost sop-btn-sm" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener">Descargar</a>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdClose">${closeLabel}</button>
        </div>
      </div>
      <div class="sop-pdf-editor-hint" id="sopPdfEdHint">${canEdit ? hintSelect : hintSelect}</div>
      ${canDeletePages ? `
      <div class="sop-pdf-delete-actions is-hidden" id="sopPdfEdDeleteBar">
        <span class="sop-pdf-delete-count" id="sopPdfEdDelCount"></span>
        <button type="button" class="sop-btn sop-btn-danger sop-btn-sm" id="sopPdfEdDelApply" disabled>Eliminar seleccionadas</button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdDelCancel">Cancelar</button>
      </div>` : ''}
      ${canReorderPages ? `
      <div class="sop-pdf-reorder-actions is-hidden" id="sopPdfEdReorderBar">
        <span class="sop-pdf-reorder-hint">Arrastre las páginas para cambiar el orden y confirme.</span>
        <button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="sopPdfEdReorderApply" disabled>Guardar orden</button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdReorderCancel">Cancelar</button>
      </div>` : ''}
      ${canReorderPages ? '<div class="sop-pdf-reorder-list is-hidden" id="sopPdfEdReorderList"></div>' : ''}
      <div class="sop-pdf-editor-body" id="sopPdfEdBody"><div class="sop-pdf-editor-loading">Cargando PDF…</div></div>
      <div class="sop-pdf-editor-footer">
        <span class="sop-pdf-editor-count" id="sopPdfEdCount"></span>
        ${canEdit && !saveInTopbar ? '<button type="button" class="sop-btn sop-btn-primary" id="sopPdfEdSave" disabled>Guardar en PDF</button>' : ''}
      </div>`;

    container.innerHTML = '';
    container.appendChild(shell);

    const body = shell.querySelector('#sopPdfEdBody');
    const countEl = saveInTopbar
      ? document.getElementById('visorPdfTopCount')
      : shell.querySelector('#sopPdfEdCount');
    const btnSave = saveInTopbar
      ? document.getElementById('sopPdfEdSave')
      : shell.querySelector('#sopPdfEdSave');
    const pending = [];

    let activeColor = 'yellow';
    let drag = null;
    let destroyed = false;
    const hintEl = shell.querySelector('#sopPdfEdHint');
    const colorsEl = shell.querySelector('#sopPdfEdColors');
    const btnUndo = shell.querySelector('#sopPdfEdUndo');
    const deleteBar = shell.querySelector('#sopPdfEdDeleteBar');
    const delCountEl = shell.querySelector('#sopPdfEdDelCount');
    const btnDelApply = shell.querySelector('#sopPdfEdDelApply');
    const btnDelCancel = shell.querySelector('#sopPdfEdDelCancel');
    const reorderBar = shell.querySelector('#sopPdfEdReorderBar');
    const reorderList = shell.querySelector('#sopPdfEdReorderList');
    const btnReorderApply = shell.querySelector('#sopPdfEdReorderApply');
    const btnReorderCancel = shell.querySelector('#sopPdfEdReorderCancel');
    const pageDeleteChecks = [];
    const reorderItems = [];
    let interactionMode = 'select';

    function updateDeleteSelection() {
      const n = pageDeleteChecks.filter((c) => c.checked).length;
      if (delCountEl) {
        delCountEl.textContent = n
          ? `${n} página(s) marcada(s)`
          : 'Marque las páginas a eliminar';
      }
      if (btnDelApply) btnDelApply.disabled = n === 0;
      shell.querySelectorAll('.sop-pdf-page').forEach((wrap) => {
        const inp = wrap.querySelector('.sop-pdf-page-del input');
        wrap.classList.toggle('is-marked-delete', !!(inp && inp.checked));
      });
    }

    function setInteractionMode(mode) {
      if (mode !== 'delete' && pending.length) {
        toast('Guarde o deshaga los resaltados pendientes antes de cambiar de modo', 'error');
        return;
      }
      interactionMode = mode;
      const highlight = mode === 'highlight';
      const del = mode === 'delete';
      const reorder = mode === 'reorder';
      shell.classList.toggle('is-select-mode', mode === 'select');
      shell.classList.toggle('is-highlight-mode', highlight);
      shell.classList.toggle('is-delete-mode', del);
      shell.classList.toggle('is-reorder-mode', reorder);
      shell.querySelector('#sopPdfEdModeSelect')?.classList.toggle('is-active', mode === 'select');
      shell.querySelector('#sopPdfEdModeHighlight')?.classList.toggle('is-active', highlight);
      shell.querySelector('#sopPdfEdModeDelete')?.classList.toggle('is-active', del);
      shell.querySelector('#sopPdfEdModeReorder')?.classList.toggle('is-active', reorder);
      colorsEl?.classList.toggle('is-hidden', !highlight);
      btnUndo?.classList.toggle('is-hidden', !highlight);
      shell.querySelector('#sopPdfEdAnexarLbl')?.classList.toggle('is-hidden', del || mode === 'reorder');
      deleteBar?.classList.toggle('is-hidden', !del);
      reorderBar?.classList.toggle('is-hidden', mode !== 'reorder');
      reorderList?.classList.toggle('is-hidden', mode !== 'reorder');
      if (hintEl) {
        hintEl.innerHTML = del ? hintDelete : (highlight ? hintHighlight : (mode === 'reorder' ? hintReorder : hintSelect));
      }
      if (!del) {
        pageDeleteChecks.forEach((c) => { c.checked = false; });
        updateDeleteSelection();
      }
      if (mode !== 'reorder') {
        reorderItems.forEach((item) => item.classList.remove('is-dragging'));
      }
    }

    function close() {
      if (destroyed) return;
      destroyed = true;
      if (typeof opts.onClose === 'function') opts.onClose();
      else if (isPage) {
        if (window.opener) window.close();
        else window.history.length > 1 ? window.history.back() : (window.location.href = '/');
      }
      if (!isPage) {
        document.body.style.overflow = '';
        container.remove();
      }
    }

    function updateCount() {
      if (countEl) {
        countEl.textContent = canEdit && pending.length
          ? `${pending.length} resaltado(s) pendiente(s)`
          : '';
      }
      if (btnSave) {
        btnSave.disabled = pending.length === 0;
        if (pending.length > 0 && btnSave.textContent === 'Guardado') {
          btnSave.textContent = 'Guardar en PDF';
        }
      }
    }

    function renderPendingMarks() {
      shell.querySelectorAll('.sop-pdf-highlight-layer').forEach((hl) => {
        hl.querySelectorAll('.sop-pdf-mark:not(.is-draft)').forEach((n) => n.remove());
        const pageIndex = parseInt(hl.dataset.pageIndex, 10);
        pending.filter((m) => m.pageIndex === pageIndex).forEach((m) => {
          const el = document.createElement('div');
          el.className = 'sop-pdf-mark';
          el.dataset.color = m.color;
          el.style.left = `${m.x * 100}%`;
          el.style.top = `${m.y * 100}%`;
          el.style.width = `${m.w * 100}%`;
          el.style.height = `${m.h * 100}%`;
          el.style.background = markBg(m.color);
          hl.appendChild(el);
        });
      });
      updateCount();
    }

    function attachOverlay(overlay, highlightLayer, pageIndex) {
      overlay.dataset.pageIndex = String(pageIndex);
      highlightLayer.dataset.pageIndex = String(pageIndex);
      if (!canEdit) {
        overlay.classList.add('is-readonly');
        return;
      }

      overlay.addEventListener('pointerdown', (ev) => {
        if (interactionMode !== 'highlight') return;
        if (ev.button !== 0) return;
        const rect = overlay.getBoundingClientRect();
        drag = {
          pageIndex,
          overlay,
          startX: ev.clientX - rect.left,
          startY: ev.clientY - rect.top,
          draft: null
        };
        drag.draft = document.createElement('div');
        drag.draft.className = 'sop-pdf-mark is-draft';
        drag.draft.dataset.color = activeColor;
        drag.draft.style.background = markBg(activeColor);
        highlightLayer.appendChild(drag.draft);
        overlay.setPointerCapture(ev.pointerId);
      });

      overlay.addEventListener('pointermove', (ev) => {
        if (!drag || drag.pageIndex !== pageIndex) return;
        const rect = overlay.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const left = Math.min(drag.startX, x);
        const top = Math.min(drag.startY, y);
        const w = Math.abs(x - drag.startX);
        const h = Math.abs(y - drag.startY);
        drag.draft.style.left = `${left}px`;
        drag.draft.style.top = `${top}px`;
        drag.draft.style.width = `${w}px`;
        drag.draft.style.height = `${h}px`;
      });

      const finish = (ev) => {
        if (!drag || drag.pageIndex !== pageIndex) return;
        try { overlay.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
        const pw = overlay.offsetWidth;
        const ph = overlay.offsetHeight;
        const left = parseFloat(drag.draft.style.left) || 0;
        const top = parseFloat(drag.draft.style.top) || 0;
        const w = parseFloat(drag.draft.style.width) || 0;
        const h = parseFloat(drag.draft.style.height) || 0;
        drag.draft.remove();
        drag = null;
        if (pw < 4 || ph < 4 || w < 6 || h < 6) return;
        pending.push({
          pageIndex,
          x: left / pw,
          y: top / ph,
          w: w / pw,
          h: h / ph,
          color: activeColor
        });
        renderPendingMarks();
      };

      overlay.addEventListener('pointerup', finish);
      overlay.addEventListener('pointercancel', finish);
    }

    shell.querySelector('#sopPdfEdClose')?.addEventListener('click', close);

    shell.querySelector('#sopPdfEdModeSelect')?.addEventListener('click', () => setInteractionMode('select'));
    shell.querySelector('#sopPdfEdModeHighlight')?.addEventListener('click', () => setInteractionMode('highlight'));
    shell.querySelector('#sopPdfEdModeDelete')?.addEventListener('click', () => setInteractionMode('delete'));
    shell.querySelector('#sopPdfEdModeReorder')?.addEventListener('click', () => setInteractionMode('reorder'));
    btnDelCancel?.addEventListener('click', () => setInteractionMode('select'));
    btnReorderCancel?.addEventListener('click', () => setInteractionMode('select'));

    btnDelApply?.addEventListener('click', async () => {
      const pages = pageDeleteChecks.filter((c) => c.checked).map((c) => parseInt(c.dataset.pageNum, 10));
      if (!pages.length || !deletePagesUrl || !apiFetch) return;
      btnDelApply.disabled = true;
      btnDelApply.textContent = 'Eliminando…';
      try {
        const res = await apiFetch(deletePagesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron eliminar las páginas');
        toast(data.message || 'Páginas eliminadas', 'success');
        window.location.reload();
      } catch (e) {
        toast(e.message || 'Error al eliminar páginas', 'error');
        btnDelApply.disabled = false;
        btnDelApply.textContent = 'Eliminar seleccionadas';
        updateDeleteSelection();
      }
    });

    btnReorderApply?.addEventListener('click', async () => {
      const order = reorderItems.map((item) => parseInt(item.dataset.pageNum, 10));
      if (!order.length || !reorderPagesUrl || !apiFetch) return;
      btnReorderApply.disabled = true;
      btnReorderApply.textContent = 'Guardando…';
      try {
        const res = await apiFetch(reorderPagesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el orden');
        toast(data.message || 'Orden actualizado', 'success');
        window.location.reload();
      } catch (e) {
        toast(e.message || 'Error al guardar el orden', 'error');
        btnReorderApply.disabled = false;
        btnReorderApply.textContent = 'Guardar orden';
      }
    });

    const anexarInp = shell.querySelector('#sopPdfEdAnexarInp');
    anexarInp?.addEventListener('change', async (ev) => {
      const files = [...(ev.target.files || [])];
      ev.target.value = '';
      if (!files.length || !appendUrl || !apiFetch) return;
      if (pending.length) {
        toast('Guarde los resaltados pendientes antes de añadir otro PDF', 'error');
        return;
      }
      const lbl = shell.querySelector('#sopPdfEdAnexarLbl');
      if (lbl) lbl.style.pointerEvents = 'none';
      toast('Añadiendo PDF…', 'success');
      try {
        const fd = new FormData();
        files.forEach((f) => fd.append('partes', f));
        const res = await apiFetch(appendUrl, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo añadir el PDF');
        toast(data.message || `Se añadieron ${data.anexados || files.length} PDF`, 'success');
        window.location.reload();
      } catch (e) {
        toast(e.message || 'Error al añadir PDF', 'error');
        if (lbl) lbl.style.pointerEvents = '';
      }
    });

    shell.querySelectorAll('.sop-pdf-editor-color').forEach((btn) => {
      btn.addEventListener('click', () => {
        shell.querySelectorAll('.sop-pdf-editor-color').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        activeColor = btn.dataset.color || 'yellow';
      });
    });

    shell.querySelector('#sopPdfEdUndo')?.addEventListener('click', () => {
      pending.pop();
      renderPendingMarks();
    });

    btnSave?.addEventListener('click', async () => {
      if (!pending.length || !apiFetch) return;
      btnSave.disabled = true;
      btnSave.textContent = 'Guardando…';
      try {
        const res = await apiFetch(saveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ highlights: pending })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar');
        toast(`PDF actualizado (${data.aplicados || pending.length} resaltado(s))`, 'success');
        pending.length = 0;
        updateCount();
        if (typeof opts.onSaved === 'function') opts.onSaved(data);
        if (!isPage) close();
        else {
          btnSave.disabled = true;
          btnSave.textContent = 'Guardado';
        }
      } catch (e) {
        toast(e.message || 'Error al guardar resaltados', 'error');
        btnSave.disabled = false;
        btnSave.textContent = 'Guardar en PDF';
      }
    });

    try {
      const lib = await ensurePdfJs();
      const loadingTask = lib.getDocument({ url: pdfUrl, withCredentials: true });
      const pdf = await loadingTask.promise;
      if (destroyed) return { destroy: close };
      body.innerHTML = '';
      const scale = Math.min(isPage ? 1.6 : 1.5, (body.clientWidth || 800) / 612);

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const wrap = document.createElement('div');
        wrap.className = 'sop-pdf-page';
        wrap.style.width = `${viewport.width}px`;
        wrap.style.maxWidth = '100%';
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        await page.render({ canvasContext: ctx, viewport }).promise;
        wrap.appendChild(canvas);
        const highlightLayer = document.createElement('div');
        highlightLayer.className = 'sop-pdf-highlight-layer';
        highlightLayer.setAttribute('aria-hidden', 'true');
        wrap.appendChild(highlightLayer);
        try {
          await renderPageTextLayer(lib, page, viewport, wrap);
        } catch (textErr) {
          console.warn('[SopPdfEditor] Capa de texto no disponible:', textErr);
        }
        const overlay = document.createElement('div');
        overlay.className = 'sop-pdf-overlay';
        attachOverlay(overlay, highlightLayer, i - 1);
        wrap.appendChild(overlay);
        if (canDeletePages) {
          const lbl = document.createElement('label');
          lbl.className = 'sop-pdf-page-del';
          const inp = document.createElement('input');
          inp.type = 'checkbox';
          inp.dataset.pageNum = String(i);
          inp.addEventListener('change', updateDeleteSelection);
          pageDeleteChecks.push(inp);
          lbl.appendChild(inp);
          const span = document.createElement('span');
          span.textContent = `Pág. ${i}`;
          lbl.appendChild(span);
          wrap.appendChild(lbl);
        }
        if (canReorderPages) {
          const reorderItem = document.createElement('button');
          reorderItem.type = 'button';
          reorderItem.className = 'sop-pdf-reorder-item';
          reorderItem.dataset.pageNum = String(i);
          reorderItem.innerHTML = `<span class="sop-pdf-reorder-item__num">Pág. ${i}</span><span class="sop-pdf-reorder-item__hint">Arrastre</span>`;
          reorderItem.draggable = true;
          reorderItem.addEventListener('dragstart', (ev) => {
            reorderItem.classList.add('is-dragging');
            reorderItem.dataset.dragging = '1';
            if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
          });
          reorderItem.addEventListener('dragend', () => {
            reorderItem.classList.remove('is-dragging');
            reorderItem.classList.remove('is-over');
            delete reorderItem.dataset.dragging;
          });
          reorderItem.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
            reorderItem.classList.add('is-over');
          });
          reorderItem.addEventListener('dragleave', () => {
            reorderItem.classList.remove('is-over');
          });
          reorderItem.addEventListener('drop', (ev) => {
            ev.preventDefault();
            reorderItem.classList.remove('is-over');
            const from = shell.querySelector('.sop-pdf-reorder-item.is-dragging');
            if (!from || from === reorderItem) return;
            const fromIndex = Array.from(reorderItems).indexOf(from);
            const toIndex = Array.from(reorderItems).indexOf(reorderItem);
            if (fromIndex < 0 || toIndex < 0) return;
            const [moved] = reorderItems.splice(fromIndex, 1);
            reorderItems.splice(toIndex, 0, moved);
            const parent = reorderList;
            if (parent) {
              if (fromIndex < toIndex) {
                parent.insertBefore(moved, reorderItem.nextSibling);
              } else {
                parent.insertBefore(moved, reorderItem);
              }
            }
            btnReorderApply.disabled = false;
          });
          reorderItems.push(reorderItem);
          reorderList?.appendChild(reorderItem);
        }
        body.appendChild(wrap);
      }
      updateCount();
    } catch (e) {
      body.innerHTML = `<div class="sop-pdf-editor-error">${escapeHtml(e.message || 'No se pudo cargar el PDF')}</div>`;
    }

    return { destroy: close };
  }

  async function openPdfEditor(opts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'sop-pdf-editor-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    const holder = document.createElement('div');
    backdrop.appendChild(holder);

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) mountApi?.destroy();
    });

    let mountApi;
    mountApi = await mountPdfViewer(holder, {
      ...opts,
      layout: 'modal',
      onClose: () => {
        document.body.style.overflow = '';
        backdrop.remove();
      }
    });
  }

  /**
   * Abre el visor en pestaña nueva (misma sesión).
   */
  function openPdfInPage(cfg) {
    const q = new URLSearchParams();
    q.set('fuente', cfg.fuente);
    if (cfg.fuente === 'pdx') {
      q.set('id', String(cfg.id));
      if (cfg.edit) q.set('edit', '1');
    } else if (cfg.fuente === 'armado') {
      q.set('exp', String(cfg.expId));
      q.set('tipo', String(cfg.tipo || '').toUpperCase());
      if (cfg.edit) q.set('edit', '1');
    }
    if (cfg.titulo) q.set('titulo', String(cfg.titulo).slice(0, 240));
    const url = `/soportes/visor-pdf?${q.toString()}`;
    window.open(url, '_blank', 'noopener');
  }

  global.SopPdfEditor = { open: openPdfEditor, mount: mountPdfViewer, openPage: openPdfInPage };
})(typeof window !== 'undefined' ? window : globalThis);
