/**
 * Papelera de Cargar Reportes: lista archivos eliminados y permite recuperarlos.
 */
(function () {
  'use strict';

  let bound = false;
  let itemsCache = [];

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyHtml(title, detail) {
    if (typeof htmlListaVacia === 'function') return htmlListaVacia(title, detail);
    return `<div class="innar-empty innar-empty--compact"><p class="innar-empty-title">${escapeHtml(title)}</p></div>`;
  }

  function formatFecha(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return String(iso);
    }
  }

  function labelOrigen(origen) {
    if (origen === 'backup') return { text: 'Copia de seguridad', cls: 'papelera-badge papelera-badge--backup' };
    if (origen === 'huerfano_disco') return { text: 'En disco (huérfano)', cls: 'papelera-badge papelera-badge--disco' };
    return { text: 'Eliminado', cls: 'papelera-badge papelera-badge--elim' };
  }

  function filtroTexto() {
    return String($('papeleraPdxBuscar')?.value || '').trim().toLowerCase();
  }

  function itemsFiltrados() {
    const q = filtroTexto();
    if (!q) return itemsCache;
    return itemsCache.filter((it) => {
      const blob = [
        it.paciente_nombre, it.paciente_documento, it.carpeta_nombre,
        it.carpeta_periodo, it.estudio_texto, it.nombre_archivo_original
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }

  function setStatus(msg) {
    const el = $('papeleraPdxStatus');
    if (el) el.textContent = msg || '';
  }

  async function cargarLista() {
    const tbody = $('papeleraPdxBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7">${emptyHtml('Cargando…')}</td></tr>`;
    try {
      const res = await apiFetch('/api/soportes/pdx/papelera');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'No se pudo cargar la papelera');
      itemsCache = Array.isArray(data.items) ? data.items : [];
      renderTabla();
      setStatus(`${itemsCache.length} archivo(s) en papelera`);
    } catch (e) {
      itemsCache = [];
      tbody.innerHTML = `<tr><td colspan="7">${emptyHtml('No se pudo cargar', e.message || '')}</td></tr>`;
      toast(e.message || 'Error al cargar la papelera', 'error');
    }
  }

  function renderTabla() {
    const tbody = $('papeleraPdxBody');
    if (!tbody) return;
    const lista = itemsFiltrados();
    if (!itemsCache.length) {
      tbody.innerHTML = `<tr><td colspan="7">${emptyHtml('Papelera vacía', 'Los archivos que elimine en Cargar reportes aparecerán aquí. Use «Buscar en copias de seguridad» para recuperar eliminados antiguos.')}</td></tr>`;
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="7">${emptyHtml('Sin coincidencias', 'Ningún archivo coincide con el filtro')}</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map((it) => {
      const orig = labelOrigen(it.origen);
      const carpeta = [it.carpeta_nombre, it.carpeta_periodo].filter(Boolean).join(' · ') || '—';
      const disponible = it.archivo_disponible !== false;
      const icon = (typeof innarIconSvg === 'function') ? innarIconSvg : function () { return ''; };
      return `<tr data-pap-id="${it.id}">
        <td>
          <strong>${escapeHtml(it.paciente_nombre || '—')}</strong>
          ${it.paciente_documento ? `<div class="papelera-meta">Doc. ${escapeHtml(it.paciente_documento)}</div>` : ''}
        </td>
        <td>${escapeHtml(carpeta)}</td>
        <td>${escapeHtml(it.fecha_estudio || '—')}</td>
        <td>${escapeHtml(it.estudio_texto || it.nombre_archivo_original || '—')}</td>
        <td>${formatFecha(it.eliminado_en)}${it.eliminado_por_nombre ? `<div class="papelera-meta">${escapeHtml(it.eliminado_por_nombre)}</div>` : ''}</td>
        <td><span class="${orig.cls}">${orig.text}</span>${disponible ? '' : '<div class="papelera-meta">Sin archivo en disco</div>'}</td>
        <td>
          <div class="table-actions backup-actions">
            ${disponible ? `<button type="button" class="btn-editar papelera-btn-ver" data-id="${it.id}" title="Ver PDF">${icon('pdf')}</button>` : ''}
            <button type="button" class="btn-editar papelera-btn-rec" data-id="${it.id}" title="Recuperar">${icon('history')}</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.papelera-btn-rec').forEach((btn) => {
      btn.addEventListener('click', () => recuperar(Number(btn.dataset.id)));
    });
    tbody.querySelectorAll('.papelera-btn-ver').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open(`/api/soportes/pdx/papelera/${btn.dataset.id}/ver`, '_blank', 'noopener');
      });
    });
  }

  async function recuperar(id) {
    if (!id) return;
    const item = itemsCache.find((x) => Number(x.id) === Number(id));
    const label = item?.paciente_nombre || `archivo #${id}`;
    const run = async () => {
      try {
        const res = await apiFetch(`/api/soportes/pdx/papelera/${id}/recuperar`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo recuperar');
        toast(`Recuperado en «${data.carpeta_nombre || 'Cargar reportes'}»`, 'success');
        await cargarLista();
      } catch (e) {
        toast(e.message || 'Error al recuperar', 'error');
      }
    };
    if (typeof window.confirm === 'function') {
      if (!window.confirm(`¿Recuperar «${label}» a su carpeta de Cargar reportes?`)) return;
    }
    await run();
  }

  async function escanearBackups() {
    const btn = $('btnPapeleraPdxEscanear');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Buscando en copias…';
    }
    setStatus('Revisando copias de seguridad. Puede tardar un minuto…');
    try {
      const res = await apiFetch('/api/soportes/pdx/papelera/escanear-backups', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'No se pudo buscar en backups');
      toast(data.mensaje || 'Búsqueda terminada', data.catalogados ? 'success' : 'info');
      await cargarLista();
      if (data.pendientes) setStatus(data.mensaje);
    } catch (e) {
      toast(e.message || 'Error buscando en copias de seguridad', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Buscar en copias de seguridad';
      }
    }
  }

  function initPapeleraPdxModule() {
    if (!bound) {
      bound = true;
      $('btnPapeleraPdxRefresh')?.addEventListener('click', cargarLista);
      $('btnPapeleraPdxEscanear')?.addEventListener('click', escanearBackups);
      $('papeleraPdxBuscar')?.addEventListener('input', renderTabla);
    }
    cargarLista();
  }

  window.initPapeleraPdxModule = initPapeleraPdxModule;
})();
