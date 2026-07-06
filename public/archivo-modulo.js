/**
 * Módulo Archivo — carpetas archivadas de Reportes, Soportes y Anexo con descarga ZIP.
 */
(function () {
  'use strict';

  let initArchivoDone = false;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtFecha(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return iso;
    }
  }

  function labelModulo(m) {
    return ({ pdx: 'Cargar reportes', armado: 'Soportes', anexo: 'Anexo FIDU' }[m] || m);
  }

  async function apiArchivo(path, opts) {
    const fetchFn = typeof apiFetch === 'function' ? apiFetch : fetch;
    const res = await fetchFn(`/api${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...(opts || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || (data.code === 'CSRF_INVALID' ? 'Sesión de seguridad desactualizada. Recargue la página e intente de nuevo.' : `Error ${res.status}`);
      throw new Error(msg);
    }
    return data;
  }

  function htmlVisibleSoportesBtn(it) {
    const visible = !!it.visible_en_soportes;
    const label = visible ? 'Ocultar en Soportes' : 'Mostrar en Soportes';
    const title = visible
      ? 'Dejar de mostrar esta carpeta en el módulo Soportes (permanece aquí en Archivo)'
      : 'Volver a mostrar esta carpeta en el módulo Soportes correspondiente';
    const cls = visible ? 'sop-btn sop-btn-ghost sop-btn-sm' : 'sop-btn sop-btn-teal sop-btn-sm';
    return `<button type="button" class="${cls}" data-archivo-visible="${it.id}" data-archivo-visible-state="${visible ? '1' : '0'}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
  }

  async function cargarArchivoModulo() {
    const tbody = $('archivoModuloBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="sop-empty" style="padding:24px">Cargando…</td></tr>';
    try {
      const data = await apiArchivo('/archivo-modulo');
      const items = data.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="sop-empty" style="padding:24px">Sin registros archivados. Las carpetas pasan aquí automáticamente al cumplir el ciclo de visibilidad (mes activo → gracia → archivo).</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((it) => `
        <tr>
          <td>${escapeHtml(labelModulo(it.modulo))}</td>
          <td>${escapeHtml(it.etiqueta || '—')}</td>
          <td>${escapeHtml(it.periodo || '—')}</td>
          <td>${fmtFecha(it.archivado_en)}</td>
          <td>${it.tiene_backup ? `${it.size_mb || '?'} MB` : '<span style="color:#b45309">Sin ZIP</span>'}</td>
          <td>${it.visible_en_soportes
            ? '<span class="sop-badge sop-badge-listo" style="margin:0;font-size:.7rem">Visible</span>'
            : '<span class="sop-badge" style="margin:0;font-size:.7rem;background:#f1f5f9;color:#64748b">Oculta</span>'}</td>
          <td style="white-space:nowrap;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            ${htmlVisibleSoportesBtn(it)}
            ${it.tiene_backup
              ? `<a class="sop-btn sop-btn-ghost sop-btn-sm" href="/api/archivo-modulo/${it.id}/descargar" download>Descargar ZIP</a>`
              : `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-archivo-regen="${it.id}">Generar ZIP</button>`}
          </td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-archivo-regen]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.archivoRegen, 10);
          btn.disabled = true;
          try {
            await apiArchivo(`/archivo-modulo/${id}/regenerar-backup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}'
            });
            if (typeof showToast === 'function') showToast('Copia de seguridad generada', 'success');
            await cargarArchivoModulo();
          } catch (e) {
            if (typeof showToast === 'function') showToast(e.message || 'Error generando ZIP', 'error');
            btn.disabled = false;
          }
        });
      });
      tbody.querySelectorAll('[data-archivo-visible]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.archivoVisible, 10);
          const actualmenteVisible = btn.dataset.archivoVisibleState === '1';
          const visible = !actualmenteVisible;
          btn.disabled = true;
          try {
            const data = await apiArchivo(`/archivo-modulo/${id}/visible-soportes`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ visible })
            });
            if (typeof showToast === 'function') showToast(data.mensaje || (visible ? 'Visible en Soportes' : 'Oculta en Soportes'), 'success');
            await cargarArchivoModulo();
          } catch (e) {
            if (typeof showToast === 'function') showToast(e.message || 'No se pudo cambiar la visibilidad', 'error');
            btn.disabled = false;
          }
        });
      });
      if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="sop-empty" style="padding:24px;color:#b91c1c">${escapeHtml(e.message || 'Error cargando archivo')}</td></tr>`;
    }
  }

  function initArchivoModulo() {
    if (!initArchivoDone) {
      initArchivoDone = true;
      $('btnVolverArchivoModulo')?.addEventListener('click', () => {
        if (typeof goToMenu === 'function') goToMenu();
        else if (typeof showView === 'function') showView('view-menu');
      });
      $('btnArchivoModuloRefrescar')?.addEventListener('click', () => cargarArchivoModulo());
    }
    cargarArchivoModulo();
  }

  window.initArchivoModulo = initArchivoModulo;
  window.cargarArchivoModulo = cargarArchivoModulo;
})();
