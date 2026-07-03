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

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
    else alert(msg);
  }

  async function cargarListaBackups() {
    const tbody = document.getElementById('backupTablaBody');
    const empty = document.getElementById('backupTablaEmpty');
    const dirEl = document.getElementById('backupDirLabel');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:#64748b">Cargando…</td></tr>';
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
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';
      tbody.innerHTML = backupListCache.map((b) => {
        const delBtn = (typeof currentUser !== 'undefined' && currentUser?.rol === 'superadmin')
          ? `<button type="button" class="btn-secondary btn-sm backup-btn-del" data-file="${escapeHtml(b.filename)}">Eliminar</button>`
          : '';
        return `<tr>
          <td><strong>${escapeHtml(b.filename)}</strong></td>
          <td>${formatFecha(b.created_at)}</td>
          <td>${escapeHtml(b.size_mb)} MB</td>
          <td><span class="backup-badge-completo">Completo</span></td>
          <td class="backup-actions">
            <button type="button" class="btn-primary btn-sm backup-btn-dl" data-file="${escapeHtml(b.filename)}">Descargar</button>
            ${delBtn}
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
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = e.message || 'Error al cargar backups';
      }
      toast(e.message || 'Error al cargar backups', 'error');
    }
  }

  async function crearBackupCompleto() {
    const btn = document.getElementById('btnCrearBackupCompleto');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generando backup… (puede tardar varios minutos)';
    }
    try {
      const res = await apiFetch('/api/backups/completo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Manual módulo Backup' })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el backup');
      toast(data.message || 'Backup generado', 'success');
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
