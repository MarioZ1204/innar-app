/**
 * Página /soportes/visor-pdf — visor PDF a pantalla completa (PDX o Armado).
 * Parámetros: fuente=pdx&id=… | fuente=armado&exp=…&tipo=OPF&edit=1&titulo=…
 */
(function () {
  'use strict';

  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function apiFetch(url, opts = {}) {
    const method = ((opts.method || 'GET') + '').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && String(url).startsWith('/api/')) {
      const csrf = getCsrf();
      if (csrf) headers.set('x-csrf-token', csrf);
    }
    const res = await fetch(url, { ...opts, headers, credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/?login=1&redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      throw new Error('Sesión expirada');
    }
    return res;
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'visor-pdf-toast' + (type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;background:#0f172a;color:#fff;font-size:.85rem;z-index:9999;max-width:90%;';
    if (type === 'error') el.style.background = '#dc2626';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function parseConfig() {
    const p = new URLSearchParams(window.location.search);
    const fuente = (p.get('fuente') || '').toLowerCase();
    const titulo = p.get('titulo') || 'Documento PDF';
    const edit = p.get('edit') === '1';

    if (fuente === 'pdx') {
      const id = parseInt(p.get('id'), 10);
      if (!id) return { error: 'Falta el parámetro id (depósito PDX)' };
      return {
        title: titulo,
        pdfUrl: `/api/soportes/pdx/archivos/${id}/ver`,
        saveUrl: edit ? `/api/soportes/pdx/archivos/${id}/resaltar` : '',
        appendUrl: edit ? `/api/soportes/pdx/archivos/${id}/anexar-pdf` : '',
        downloadUrl: `/api/soportes/pdx/archivos/${id}/descargar`,
        canEdit: edit
      };
    }
    if (fuente === 'armado') {
      const exp = parseInt(p.get('exp'), 10);
      const tipo = String(p.get('tipo') || '').toUpperCase();
      if (!exp || !tipo) return { error: 'Faltan parámetros exp y tipo (armado)' };
      const tipoEnc = encodeURIComponent(tipo);
      return {
        title: titulo,
        pdfUrl: `/api/soportes/armado/expedientes/${exp}/archivos/${tipoEnc}/descargar?inline=1`,
        saveUrl: edit
          ? `/api/soportes/armado/expedientes/${exp}/archivos/${tipoEnc}/resaltar`
          : '',
        appendUrl: edit
          ? `/api/soportes/armado/expedientes/${exp}/archivos/${tipoEnc}/anexar-pdf`
          : '',
        downloadUrl: `/api/soportes/armado/expedientes/${exp}/archivos/${tipoEnc}/descargar`,
        canEdit: edit
      };
    }
    return { error: 'Parámetro fuente inválido (use pdx o armado)' };
  }

  async function init() {
    const mount = document.getElementById('visorPdfMount');
    const titleEl = document.getElementById('visorPdfPageTitle');
    const cfg = parseConfig();

    if (cfg.error) {
      mount.innerHTML = `<div class="visor-pdf-error-box">${cfg.error}</div>`;
      return;
    }

    if (titleEl) titleEl.textContent = cfg.title;

    if (!window.SopPdfEditor?.mount) {
      mount.innerHTML = '<div class="visor-pdf-error-box">Visor PDF no disponible. Recargue la página.</div>';
      return;
    }

    await window.SopPdfEditor.mount(mount, {
      pdfUrl: cfg.pdfUrl,
      saveUrl: cfg.saveUrl,
      appendUrl: cfg.appendUrl || '',
      downloadUrl: cfg.downloadUrl,
      title: cfg.title,
      canEdit: cfg.canEdit,
      apiFetch,
      toast,
      layout: 'page',
      onClose: null
    });
  }

  init().catch((e) => {
    const mount = document.getElementById('visorPdfMount');
    if (mount) mount.innerHTML = `<div class="visor-pdf-error-box">${e.message || 'Error'}</div>`;
  });
})();
