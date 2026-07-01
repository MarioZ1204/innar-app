/**
 * Módulo Archivo — carpetas archivadas de Reportes, Soportes y Anexo con descarga ZIP.
 */
(function () {
  'use strict';

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
    const res = await fetch(`/api${path}`, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function cargarArchivoModulo() {
    const tbody = $('archivoModuloBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="sop-empty" style="padding:24px">Cargando…</td></tr>';
    try {
      const data = await apiArchivo('/archivo-modulo');
      const items = data.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="sop-empty" style="padding:24px">Sin registros archivados. Las carpetas pasan aquí automáticamente al cumplir el ciclo de visibilidad (mes activo → gracia → archivo).</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((it) => `
        <tr>
          <td>${escapeHtml(labelModulo(it.modulo))}</td>
          <td>${escapeHtml(it.etiqueta || '—')}</td>
          <td>${escapeHtml(it.periodo || '—')}</td>
          <td>${fmtFecha(it.archivado_en)}</td>
          <td>${it.tiene_backup ? `${it.size_mb || '?'} MB` : '<span style="color:#b45309">Sin ZIP</span>'}</td>
          <td style="white-space:nowrap">
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
            await apiArchivo(`/archivo-modulo/${id}/regenerar-backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (typeof showToast === 'function') showToast('Copia de seguridad generada', 'success');
            await cargarArchivoModulo();
          } catch (e) {
            if (typeof showToast === 'function') showToast(e.message || 'Error generando ZIP', 'error');
            btn.disabled = false;
          }
        });
      });
      if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="sop-empty" style="padding:24px;color:#b91c1c">${escapeHtml(e.message || 'Error cargando archivo')}</td></tr>`;
    }
  }

  function initArchivoModulo() {
    $('btnVolverArchivoModulo')?.addEventListener('click', () => {
      if (typeof showMenu === 'function') showMenu();
    });
    $('btnArchivoModuloRefrescar')?.addEventListener('click', () => cargarArchivoModulo());
    cargarArchivoModulo();
  }

  window.initArchivoModulo = initArchivoModulo;
  window.cargarArchivoModulo = cargarArchivoModulo;
})();
