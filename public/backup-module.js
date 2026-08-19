/**
 * Módulo Backup — backups completos (BD + uploads) descargables.
 */
(function () {
  'use strict';

  let backupListCache = [];

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatFecha(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
    } catch (_) {
      return iso;
    }
  }

  function setBackupEmpty(visible, title, detail) {
    const empty = document.getElementById('backupTablaEmpty');
    if (!empty) return;
    const t = document.getElementById('backupTablaEmptyTitle');
    const d = document.getElementById('backupTablaEmptyDetail');
    if (t && title != null) t.textContent = title;
    if (d && detail != null) d.textContent = detail;
    empty.style.display = visible ? 'flex' : 'none';
  }

  async function cargarListaBackups() {
    const tbody = document.getElementById('backupTablaBody');
    const dirEl = document.getElementById('backupDirLabel');
    if (!tbody) return;
    const anchor = tbody || document.getElementById('view-backup');
    const load = async () => {
    tbody.innerHTML = '<tr><td colspan="5"><div class="innar-empty innar-empty--compact"><p class="innar-empty-title">Cargando…</p></div></td></tr>';
    try {
      const res = await apiFetch('/api/backups');
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (ct.includes('text/html')) {
        throw new Error('El servidor no expone la API de backups. Reinicie la aplicación Node.');
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar la lista');
      backupListCache = data.completos || [];
      if (dirEl) dirEl.textContent = data.backup_dir || '—';

      if (!backupListCache.length) {
        tbody.innerHTML = '';
        setBackupEmpty(true, 'Sin copias de seguridad', 'Pulse «Generar backup completo ahora».');
        return;
      }
      setBackupEmpty(false);
      tbody.innerHTML = backupListCache.map((b) => {
        const icon = (typeof innarIconSvg === 'function') ? innarIconSvg : function () { return ''; };
        const delBtn = (typeof currentUser !== 'undefined' && currentUser?.rol === 'superadmin')
          ? `<button type="button" class="btn-eliminar backup-btn-del" data-file="${escapeHtml(b.filename)}" title="Eliminar">${icon('trash')}</button>`
          : '';
        return `<tr>
          <td><strong>${escapeHtml(b.filename)}</strong></td>
          <td>${formatFecha(b.created_at)}</td>
          <td>${escapeHtml(b.size_mb)} MB</td>
          <td><span class="backup-badge-completo">Completo</span></td>
          <td>
            <div class="table-actions backup-actions">
              <button type="button" class="btn-editar backup-btn-dl" data-file="${escapeHtml(b.filename)}" title="Descargar">${icon('download')}</button>
              ${delBtn}
            </div>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('.backup-btn-dl').forEach((btn) => {
        btn.addEventListener('click', () => {
          const f = btn.dataset.file;
          if (!f) return;
          window.location.href = `/api/backups/completo/${encodeURIComponent(f)}/descargar`;
        });
      });
      tbody.querySelectorAll('.backup-btn-del').forEach((btn) => {
        btn.addEventListener('click', () => eliminarBackup(btn.dataset.file));
      });
    } catch (e) {
      tbody.innerHTML = '';
      setBackupEmpty(true, e.message || 'Error al cargar backups', '');
      toast(e.message || 'Error al cargar backups', 'error');
    }
    };
    if (typeof window.innarPreserveScroll === 'function') {
      return window.innarPreserveScroll(anchor, load);
    }
    return load();
  }

  async function crearBackupCompleto() {
    const btn = document.getElementById('btnCrearBackupCompleto');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generando backup… (en segundo plano)';
    }
    try {
      const res = await apiFetch('/api/backups/completo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Manual módulo Backup' })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el backup');
      if (res.status === 202 || data.background) {
        toast(data.message || 'Backup iniciado en segundo plano. Actualice la lista en unos minutos.', 'success');
      } else {
        toast(data.message || 'Backup generado', 'success');
      }
      await cargarListaBackups();
    } catch (e) {
      toast(e.message || 'Error al generar backup', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generar backup completo ahora';
      }
    }
  }

  async function eliminarBackup(filename) {
    if (!filename) return;
    const run = async () => {
      try {
        const res = await apiFetch(`/api/backups/completo/${encodeURIComponent(filename)}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar');
        toast('Backup eliminado', 'success');
        await cargarListaBackups();
      } catch (e) {
        toast(e.message || 'Error al eliminar', 'error');
      }
    };
    if (typeof window.confirmEliminar === 'function') {
      window.confirmEliminar(`el backup «${filename}»`, run);
    } else if (window.confirm(`¿Está seguro de eliminar el backup «${filename}»?`)) {
      await run();
    }
  }

  function initBackupModule() {
    const btnCrear = document.getElementById('btnCrearBackupCompleto');
    const btnRefresh = document.getElementById('btnRefreshBackups');
    if (btnCrear && !btnCrear.dataset.bound) {
      btnCrear.dataset.bound = '1';
      btnCrear.addEventListener('click', crearBackupCompleto);
    }
    if (btnRefresh && !btnRefresh.dataset.bound) {
      btnRefresh.dataset.bound = '1';
      btnRefresh.addEventListener('click', cargarListaBackups);
    }
    cargarListaBackups();
  }

  window.initBackupModule = initBackupModule;
  window.refreshBackupModule = cargarListaBackups;
})();
