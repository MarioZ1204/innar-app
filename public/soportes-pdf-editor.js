/**
 * Visor PDF con resaltado (PDX + Armado). Marcas se guardan incrustadas en el PDF.
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
      yellow: 'rgba(253,224,71,0.55)',
      green: 'rgba(134,239,172,0.55)',
      pink: 'rgba(249,168,212,0.55)',
      blue: 'rgba(147,197,253,0.55)'
    };
    return map[color] || map.yellow;
  }

  /**
   * @param {object} opts
   * @param {string} opts.pdfUrl
   * @param {string} [opts.saveUrl]
   * @param {string} [opts.downloadUrl]
   * @param {string} [opts.title]
   * @param {boolean} [opts.canEdit]
   * @param {function} [opts.onSaved]
   * @param {function} [opts.apiFetch]
   * @param {function} [opts.toast]
   */
  async function openPdfEditor(opts) {
    const pdfUrl = opts.pdfUrl;
    const saveUrl = opts.saveUrl || '';
    const downloadUrl = opts.downloadUrl || pdfUrl.replace(/\/ver(\?|$)/, '/descargar$1').replace(/\?inline=1/, '');
    const canEdit = !!opts.canEdit && !!saveUrl;
    const apiFetch = opts.apiFetch || global.apiFetch;
    const toast = opts.toast || global.showToast || (() => {});

    const backdrop = document.createElement('div');
    backdrop.className = 'sop-pdf-editor-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    const shell = document.createElement('div');
    shell.className = 'sop-pdf-editor';
    shell.innerHTML = `
      <div class="sop-pdf-editor-header">
        <h3>${escapeHtml(opts.title || 'Documento PDF')}</h3>
        <div class="sop-pdf-editor-toolbar">
          ${canEdit ? `
          <div class="sop-pdf-editor-colors" role="group" aria-label="Color de resaltado">
            ${MARK_COLORS.map((c, i) => `<button type="button" class="sop-pdf-editor-color${i === 0 ? ' is-active' : ''}" data-color="${c}" title="${c}"></button>`).join('')}
          </div>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdUndo">Deshacer</button>
          ` : ''}
          <a class="sop-btn sop-btn-ghost sop-btn-sm" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener">Descargar</a>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdfEdClose">Cerrar</button>
        </div>
      </div>
      ${canEdit ? '<div class="sop-pdf-editor-hint">Arrastre sobre el documento para resaltar. Pulse <strong>Guardar en PDF</strong> para que las marcas queden al descargar.</div>' : '<div class="sop-pdf-editor-hint">Vista previa (solo lectura).</div>'}
      <div class="sop-pdf-editor-body" id="sopPdfEdBody"><div class="sop-pdf-editor-loading">Cargando PDF…</div></div>
      <div class="sop-pdf-editor-footer">
        <span class="sop-pdf-editor-count" id="sopPdfEdCount"></span>
        ${canEdit ? '<button type="button" class="sop-btn sop-btn-primary" id="sopPdfEdSave" disabled>Guardar en PDF</button>' : ''}
      </div>`;

    backdrop.appendChild(shell);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    const body = shell.querySelector('#sopPdfEdBody');
    const countEl = shell.querySelector('#sopPdfEdCount');
    const btnSave = shell.querySelector('#sopPdfEdSave');
    const pending = [];

    let activeColor = 'yellow';
    let drag = null;

    function close() {
      document.body.style.overflow = '';
      backdrop.remove();
    }

    function updateCount() {
      if (countEl) countEl.textContent = canEdit ? `${pending.length} resaltado(s) pendiente(s)` : '';
      if (btnSave) btnSave.disabled = pending.length === 0;
    }

    function renderPendingMarks() {
      shell.querySelectorAll('.sop-pdf-overlay').forEach((ov) => {
        ov.querySelectorAll('.sop-pdf-mark:not(.is-draft)').forEach((n) => n.remove());
        const pageIndex = parseInt(ov.dataset.pageIndex, 10);
        const pw = ov.offsetWidth;
        const ph = ov.offsetHeight;
        pending.filter((m) => m.pageIndex === pageIndex).forEach((m) => {
          const el = document.createElement('div');
          el.className = 'sop-pdf-mark';
          el.dataset.color = m.color;
          el.style.left = `${m.x * 100}%`;
          el.style.top = `${m.y * 100}%`;
          el.style.width = `${m.w * 100}%`;
          el.style.height = `${m.h * 100}%`;
          el.style.background = markBg(m.color);
          ov.appendChild(el);
        });
      });
      updateCount();
    }

    function attachOverlay(overlay, pageIndex) {
      overlay.dataset.pageIndex = String(pageIndex);
      if (!canEdit) {
        overlay.classList.add('is-readonly');
        return;
      }

      overlay.addEventListener('pointerdown', (ev) => {
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
        overlay.appendChild(drag.draft);
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
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });

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
        close();
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
      body.innerHTML = '';
      const scale = Math.min(1.5, (body.clientWidth || 800) / 612);

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const wrap = document.createElement('div');
        wrap.className = 'sop-pdf-page';
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const overlay = document.createElement('div');
        overlay.className = 'sop-pdf-overlay';
        attachOverlay(overlay, i - 1);
        wrap.appendChild(canvas);
        wrap.appendChild(overlay);
        body.appendChild(wrap);
      }
      updateCount();
    } catch (e) {
      body.innerHTML = `<div class="sop-pdf-editor-error">${escapeHtml(e.message || 'No se pudo cargar el PDF')}</div>`;
    }
  }

  global.SopPdfEditor = { open: openPdfEditor };
})(typeof window !== 'undefined' ? window : globalThis);
