/**
 * Módulo Reportes anteriores — mismas carpetas PDX de Cargar reportes (meses previos).
 */
(function () {
  'use strict';

  let initDone = false;
  const state = {
    carpetas: [],
    carpetaId: null,
    carpetaActual: null,
    archivos: [],
    filtroArchivos: '',
    filtros: { texto: '', periodo: '', tema: '', orden: 'periodo_desc' }
  };

  const TEMA_ICON = {
    vtm: 'video',
    psg: 'moon',
    eeg: 'activity',
    actigrafia: 'watch',
    latencia: 'timer',
    ordenes: 'clipboard-list',
    comprobantes: 'receipt',
    comprobantes_consulta_medica: 'receipt',
    consentimientos: 'file-signature',
    ordenes_consulta_medica: 'clipboard-list',
    neutral: 'folder'
  };

  const TEMA_LABEL = {
    vtm: 'VTM',
    psg: 'PSG',
    eeg: 'EEG',
    actigrafia: 'Actigrafía',
    latencia: 'Test de latencia',
    ordenes: 'Órdenes',
    comprobantes: 'Comprobantes',
    comprobantes_consulta_medica: 'Comprobante. consultas médicas',
    ordenes_consulta_medica: 'Órdenes + HC consultas médicas',
    consentimientos: 'Consentimientos',
    neutral: 'General'
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const PDX_LOG_LABEL = {
    subida: 'Subida',
    edicion: 'Edición de metadatos',
    reemplazo: 'Reemplazo de PDF',
    resaltado: 'Resaltado en PDF',
    movimiento: 'Movido de carpeta',
    anexo_pdf: 'Páginas añadidas',
    reordenar_paginas: 'Páginas reordenadas',
    eliminar_paginas: 'Páginas eliminadas'
  };

  function fmtFechaAuditoria(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  }

  function htmlMetaAuditoria(a) {
    const parts = [];
    if (a.subido_por_nombre) {
      const cuando = fmtFechaAuditoria(a.creado_en);
      parts.push(`Subido por ${escapeHtml(a.subido_por_nombre)}${cuando ? ` · ${escapeHtml(cuando)}` : ''}`);
    }
    if (a.editado_por_nombre) {
      const cuando = fmtFechaAuditoria(a.editado_en);
      parts.push(`Editado por ${escapeHtml(a.editado_por_nombre)}${cuando ? ` · ${escapeHtml(cuando)}` : ''}`);
    }
    return parts.map((p) => `<div class="sop-pdx-meta-user">${p}</div>`).join('');
  }

  function closeRhModal(wrap) {
    if (!wrap || !wrap.isConnected) return;
    if (wrap._rhKeyHandler) {
      document.removeEventListener('keydown', wrap._rhKeyHandler);
      wrap._rhKeyHandler = null;
    }
    wrap.remove();
    const prev = wrap._rhPrevFocus;
    if (prev && typeof prev.focus === 'function') prev.focus();
  }

  function openRhModal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'sop-dialog-backdrop';
    wrap.setAttribute('role', 'presentation');
    const dialog = document.createElement('div');
    dialog.className = 'sop-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    dialog.innerHTML = html;
    wrap.appendChild(dialog);
    wrap._rhPrevFocus = document.activeElement;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeRhModal(wrap); });
    const onKey = (e) => { if (e.key === 'Escape') closeRhModal(wrap); };
    wrap._rhKeyHandler = onKey;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    sopIcons(wrap);
    const firstBtn = dialog.querySelector('button');
    requestAnimationFrame(() => { if (firstBtn) firstBtn.focus(); else dialog.focus(); });
    return wrap;
  }

  async function modalHistorialRh(archivoId, titulo) {
    const modal = openRhModal(`
      <h3><i data-lucide="history"></i> Historial</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">${escapeHtml(titulo || 'Reporte')}</p>
      <div id="rhHistBody"><div class="sop-empty" style="padding:16px"><i data-lucide="loader"></i></div></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-primary" id="rhHistClose">Cerrar</button>
      </div>`);
    modal.querySelector('#rhHistClose').onclick = () => closeRhModal(modal);
    const body = modal.querySelector('#rhHistBody');
    try {
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}/historial`);
      const data = await res.json();
      if (!res.ok) {
        body.innerHTML = `<p class="sop-empty" style="color:#dc2626">${escapeHtml(data.error || 'No se pudo cargar el historial')}</p>`;
        return;
      }
      const evs = data.eventos || [];
      if (!evs.length) {
        body.innerHTML = '<p class="sop-empty" style="padding:12px">Sin eventos registrados.</p>';
      } else {
        body.innerHTML = `<ul class="sop-hist-list">${evs.map((e) => {
          const tipo = PDX_LOG_LABEL[e.tipo] || e.tipo;
          const cuando = e.creado_en ? fmtFechaAuditoria(e.creado_en) : '';
          const quien = e.usuario_nombre ? escapeHtml(e.usuario_nombre) : 'Sistema';
          return `<li>
            <div class="sop-hist-tipo">${escapeHtml(tipo)}</div>
            <div class="sop-hist-meta">${quien} · ${escapeHtml(cuando)}${e.detalle ? ` · ${escapeHtml(e.detalle)}` : ''}</div>
          </li>`;
        }).join('')}</ul>`;
      }
      sopIcons(body);
    } catch (err) {
      body.innerHTML = `<p class="sop-empty" style="color:#dc2626">${escapeHtml(err.message)}</p>`;
    }
  }

  function sopIcons(root) {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ nodes: root ? [root] : undefined });
    }
  }

  function sopToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  async function apiFetch(path, opts) {
    const fn = typeof window.apiFetch === 'function' ? window.apiFetch : fetch;
    return fn(path, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
  }

  function abrirPdf(url, titulo) {
    if (!url) return;
    const src = String(url).trim();
    if (!src.startsWith('/api/soportes/')) {
      window.open(src, '_blank', 'noopener');
      return;
    }
    const q = new URLSearchParams();
    q.set('src', src);
    if (titulo) q.set('titulo', String(titulo).slice(0, 200));
    window.open(`/soportes/pdf-vista?${q.toString()}`, '_blank', 'noopener');
  }

  function compararTextoNatural(a, b) {
    if (typeof window.compararTextoNatural === 'function') return window.compararTextoNatural(a, b);
    return String(a || '').localeCompare(String(b || ''), 'es', { numeric: true, sensitivity: 'base' });
  }

  function carpetasFiltradas() {
    const { texto, periodo, tema, orden } = state.filtros;
    let lista = state.carpetas.slice();
    if (periodo) lista = lista.filter((c) => c.periodo === periodo);
    if (tema) lista = lista.filter((c) => (c.color_tema || 'neutral') === tema);
    if (texto) {
      const match = window.InnarBusqueda?.objectMatchesQuery;
      if (match) {
        lista = lista.filter((c) => match(c, ['nombre_display', 'periodo', 'color_tema'], texto));
      } else {
        const t = texto.toLowerCase();
        lista = lista.filter((c) => String(c.nombre_display || '').toLowerCase().includes(t));
      }
    }
    const cmpNombre = (a, b) => compararTextoNatural(a.nombre_display, b.nombre_display);
    if (orden === 'periodo_asc') {
      lista.sort((a, b) => compararTextoNatural(a.periodo, b.periodo) || cmpNombre(a, b));
    } else if (orden === 'periodo_desc') {
      lista.sort((a, b) => compararTextoNatural(b.periodo, a.periodo) || cmpNombre(a, b));
    } else if (orden === 'nombre_desc') {
      lista.sort((a, b) => cmpNombre(b, a));
    } else if (orden === 'archivos_desc') {
      lista.sort((a, b) => (b.archivos_count || 0) - (a.archivos_count || 0) || cmpNombre(a, b));
    } else {
      lista.sort(cmpNombre);
    }
    return lista;
  }

  function actualizarFiltroPeriodos() {
    const sel = $('rhFiltroPeriodo');
    if (!sel) return;
    const cur = state.filtros.periodo;
    const periodos = [...new Set(state.carpetas.map((c) => c.periodo).filter(Boolean))].sort().reverse();
    sel.innerHTML = '<option value="">Todos los periodos</option>' +
      periodos.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (cur && periodos.includes(cur)) sel.value = cur;
  }

  function renderTemaLegend() {
    const el = $('rhTemaLegend');
    if (!el) return;
    const temas = ['vtm', 'psg', 'eeg', 'actigrafia', 'latencia', 'ordenes', 'comprobantes', 'neutral'];
    el.innerHTML = `<span class="sop-tema-legend-title">Modalidades:</span>${temas.map((t) =>
      `<span class="sop-tema-legend-item" data-tema="${t}">${TEMA_LABEL[t] || t}</span>`
    ).join('')}`;
  }

  function renderBreadcrumbLista() {
    const el = $('rhBreadcrumbLista');
    if (!el) return;
    el.innerHTML = `<span class="sop-crumb sop-crumb-current">Reportes anteriores</span>`;
  }

  function renderBreadcrumbDetalle(carpeta) {
    const el = $('rhBreadcrumbDetalle');
    if (!el || !carpeta) return;
    const dest = 'Reportes anteriores';
    el.innerHTML = `
      <button type="button" class="sop-btn sop-btn-nav-atras" id="btnRhVolverLista" title="Volver a ${dest}" aria-label="Volver a ${dest}">
        <i data-lucide="arrow-left" aria-hidden="true"></i>
        <span class="sop-nav-atras-label">Atrás</span>
        <span class="sop-nav-atras-dest">${dest}</span>
      </button>
      <span class="sop-breadcrumbs" style="margin:0;flex:1">
        <button type="button" class="sop-crumb is-link" data-rh-volver-lista>Reportes anteriores</button>
        <span class="sop-crumb-sep" aria-hidden="true">›</span>
        <span class="sop-crumb is-current">${escapeHtml(carpeta.nombre_display)}</span>
      </span>`;
    el.querySelector('#btnRhVolverLista')?.addEventListener('click', volverLista);
    el.querySelector('[data-rh-volver-lista]')?.addEventListener('click', volverLista);
    sopIcons(el);
  }

  function showSkeletonGrid(container, count) {
    if (!container) return;
    container.innerHTML = `<div class="sop-grid sop-skeleton-grid">${Array.from({ length: count || 6 }, () =>
      '<div class="sop-skeleton-block sop-skeleton-folder-card"></div>'
    ).join('')}</div>`;
  }

  function bindCarpetaEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-rh-carpeta]').forEach((card) => {
      const open = () => abrirCarpeta(parseInt(card.dataset.rhCarpeta, 10));
      card.addEventListener('click', open);
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
  }

  function renderLista() {
    renderBreadcrumbLista();
    renderTemaLegend();
    const el = $('rhLista');
    if (!el) return;
    const lista = carpetasFiltradas();
    const chip = $('rhChipResumen');
    if (chip) {
      chip.innerHTML = `<span class="sop-stat-chip"><i data-lucide="folder-clock"></i> <strong>${state.carpetas.length}</strong> carpetas de meses anteriores</span>`;
      sopIcons(chip);
    }
    if (!state.carpetas.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="folder-clock" class="sop-empty-icon"></i>Aún no hay carpetas de meses anteriores.<br><span style="font-size:.85rem">Aparecen aquí al cerrar el mes (5 días de gracia) o al moverlas desde Cargar reportes — mismos archivos, sin copiar.</span></div>`;
      sopIcons(el);
      return;
    }
    if (!lista.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="filter-x" class="sop-empty-icon"></i>Ninguna carpeta coincide con los filtros.</div>`;
      sopIcons(el);
      return;
    }
    el.innerHTML = `<div class="sop-grid">${lista.map((c) => {
      const tema = c.color_tema || 'neutral';
      const icon = TEMA_ICON[tema] || 'folder';
      return `<article class="sop-folder-card" data-tema="${escapeHtml(tema)}" data-rh-carpeta="${c.id}" tabindex="0">
        <div class="sop-folder-icon"><i data-lucide="${icon}"></i></div>
        <div class="sop-folder-title">${escapeHtml(c.nombre_display)}</div>
        <div class="sop-folder-meta">${escapeHtml(c.periodo)} · ${c.archivos_count || 0} archivo(s)</div>
        <span class="sop-badge sop-badge-archivo"><i data-lucide="folder-clock" style="width:12px;height:12px"></i> Mes anterior</span>
      </article>`;
    }).join('')}</div>`;
    bindCarpetaEvents(el);
    sopIcons(el);
  }

  async function cargarCarpetas() {
    showSkeletonGrid($('rhLista'), 6);
    const res = await apiFetch('/api/soportes/pdx/carpetas-archivadas');
    const data = await res.json();
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(data.error || 'Error al cargar carpetas archivadas');
    state.carpetas = data.carpetas || [];
    actualizarFiltroPeriodos();
    return data;
  }

  function volverLista() {
    state.carpetaId = null;
    state.carpetaActual = null;
    state.archivos = [];
    $('rhVistaLista')?.classList.remove('hidden');
    $('rhVistaDetalle')?.classList.add('hidden');
    renderLista();
  }

  function archivosRhFiltrados() {
    const q = (state.filtroArchivos || '').trim();
    if (!q) return state.archivos;
    const match = window.InnarBusqueda?.objectMatchesQuery;
    if (!match) {
      const t = q.toLowerCase();
      return state.archivos.filter((a) =>
        String(a.paciente_nombre || '').toLowerCase().includes(t) ||
        String(a.paciente_documento || '').includes(t) ||
        String(a.estudio_texto || '').toLowerCase().includes(t) ||
        String(a.subido_por_nombre || '').toLowerCase().includes(t) ||
        String(a.editado_por_nombre || '').toLowerCase().includes(t)
      );
    }
    return state.archivos.filter((a) => match(a, [
      'paciente_nombre', 'paciente_documento', 'estudio_texto',
      'nombre_archivo_original', 'nombre_archivo_display', 'nombre_descarga', 'fecha_estudio',
      'subido_por_nombre', 'editado_por_nombre'
    ], q));
  }

  function renderArchivosRh() {
    const tbody = $('rhArchivosBody');
    if (!tbody) return;
    if (!state.archivos.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="sop-empty" style="padding:24px">Sin archivos en esta carpeta</td></tr>';
      return;
    }
    const lista = archivosRhFiltrados();
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="sop-empty" style="padding:24px">Ningún archivo coincide con el filtro</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((a) => {
      const nomArch = a.nombre_descarga || a.nombre_archivo_display || a.nombre_archivo_original || '';
      const doc = a.paciente_documento ? `<div class="sop-pdx-meta-user">Doc. ${escapeHtml(a.paciente_documento)}</div>` : '';
      const tema = String(state.carpetaActual?.color_tema || '').toLowerCase();
      const esCons = tema.includes('consulta_medica');
      const estLabel = esCons && (a.marca_tiempo || a.tipo_consulta)
        ? `${a.estudio_texto || '—'} · ${a.marca_tiempo || a.tipo_consulta}`
        : (a.estudio_texto || '—');
      return `<tr>
        <td>
          <strong>${escapeHtml(a.paciente_nombre)}</strong>
          ${doc}
          ${htmlMetaAuditoria(a)}
        </td>
        <td>${escapeHtml(a.fecha_estudio || '—')}</td>
        <td>${escapeHtml(estLabel)}</td>
        <td>
          <div class="sop-actions-row">
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-ver="${a.id}" title="Ver PDF"><i data-lucide="eye"></i></button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-dl="${a.id}" title="Descargar"><i data-lucide="download"></i></button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-hist="${a.id}" title="Historial"><i data-lucide="history"></i></button>
          </div>
          <div class="sop-pdx-archivo-nombre" title="${escapeHtml(nomArch)}">${escapeHtml(nomArch)}</div>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-rh-ver]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = state.archivos.find((x) => x.id === parseInt(b.dataset.rhVer, 10));
        const titulo = row?.nombre_descarga || row?.paciente_nombre || 'Reporte';
        abrirPdf(`/api/soportes/pdx/archivos/${parseInt(b.dataset.rhVer, 10)}/ver`, titulo);
      });
    });
    tbody.querySelectorAll('[data-rh-dl]').forEach((b) => {
      b.addEventListener('click', () => {
        window.location.href = `/api/soportes/pdx/archivos/${parseInt(b.dataset.rhDl, 10)}/descargar`;
      });
    });
    tbody.querySelectorAll('[data-rh-hist]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = state.archivos.find((x) => x.id === parseInt(b.dataset.rhHist, 10));
        modalHistorialRh(parseInt(b.dataset.rhHist, 10), row?.paciente_nombre || 'Reporte');
      });
    });
    sopIcons(tbody);
  }

  async function abrirCarpeta(id) {
    state.carpetaId = id;
    state.filtroArchivos = '';
    const filtroInp = $('rhFiltroArchivos');
    if (filtroInp) filtroInp.value = '';
    $('rhVistaLista')?.classList.add('hidden');
    $('rhVistaDetalle')?.classList.remove('hidden');
    const tbody = $('rhArchivosBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="sop-empty" style="padding:24px">Cargando…</td></tr>';
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${id}/archivos`);
    const data = await res.json();
    if (!res.ok) {
      sopToast(data.error || 'No se pudo abrir la carpeta', 'error');
      volverLista();
      return;
    }
    state.archivos = (data.archivos || []).slice().sort((a, b) => {
      const fa = a.fecha_estudio || '';
      const fb = b.fecha_estudio || '';
      return fb.localeCompare(fa);
    });
    const c = data.carpeta;
    state.carpetaActual = c;
    $('rhDetalleTitulo').textContent = c.nombre_display;
    $('rhDetalleMeta').innerHTML = `${escapeHtml(c.periodo)} · <span class="sop-badge sop-badge-archivo">Mes anterior</span>`;
    sopIcons($('rhDetalleMeta'));
    const colEst = $('rhColEstudio');
    if (colEst) {
      const tema = String(c.color_tema || '').toLowerCase();
      const nom = String(c.nombre_display || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const esCons = tema.includes('consulta_medica')
        || (nom.includes('consulta') && nom.includes('medica'));
      colEst.textContent = esCons ? 'Especialidad / Tipo de consulta' : 'Tipo de estudio';
    }
    renderBreadcrumbDetalle(c);
    renderArchivosRh();
  }

  function cerrarBusqueda() {
    const el = $('rhResultados');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
  }

  async function buscarPaciente() {
    const q = $('rhBuscar')?.value?.trim();
    const el = $('rhResultados');
    if (!el) return;
    if (!q || q.length < 2) {
      cerrarBusqueda();
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-search-results-head"><h4>Resultados</h4><span class="sop-search-results-meta">Buscando…</span></div>
      <div class="sop-search-results-body"><div class="sop-empty" style="padding:24px"><i data-lucide="loader" class="sop-empty-icon"></i></div></div>`;
    sopIcons(el);
    const res = await apiFetch(`/api/soportes/pdx/buscar-archivadas?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) {
      sopToast(data.error || 'Error en la búsqueda', 'error');
      cerrarBusqueda();
      return;
    }
    const list = data.resultados || [];
    if (!list.length) {
      el.innerHTML = `<div class="sop-search-results-head">
          <h4>Resultados</h4>
          <span class="sop-search-results-meta">Sin coincidencias</span>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-close-search><i data-lucide="x"></i> Cerrar</button>
        </div>
        <div class="sop-search-results-body">        <div class="sop-empty" style="padding:20px">No se encontraron reportes para «${escapeHtml(q)}»</div></div>`;
      el.querySelector('[data-rh-close-search]')?.addEventListener('click', cerrarBusqueda);
      sopIcons(el);
      return;
    }
    el.innerHTML = `<div class="sop-search-results-head">
        <h4>Resultados</h4>
        <span class="sop-search-results-meta">${list.length} encontrado${list.length !== 1 ? 's' : ''}</span>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-close-search><i data-lucide="x"></i> Cerrar</button>
      </div>
      <div class="sop-search-results-body">
        <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
          <th>Paciente</th><th>Doc.</th><th>Estudio</th><th>Fecha</th><th>Carpeta</th><th></th></tr></thead><tbody>
          ${list.map((r) => `<tr>
            <td><strong>${escapeHtml(r.paciente_nombre)}</strong>
              ${r.nombre_descarga || r.nombre_archivo_display ? `<div class="sop-search-results-meta">${escapeHtml(r.nombre_descarga || r.nombre_archivo_display)}</div>` : ''}
              ${htmlMetaAuditoria(r)}</td>
            <td>${escapeHtml(r.paciente_documento || '—')}</td>
            <td>${escapeHtml(r.estudio_texto || '—')}</td>
            <td>${escapeHtml(r.fecha_estudio || '—')}</td>
            <td>${escapeHtml(r.carpeta_nombre)} <span class="sop-search-results-meta">(${escapeHtml(r.periodo)})</span></td>
            <td style="white-space:nowrap">
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-open-archivo="${r.archivo_id}" title="Ver PDF"><i data-lucide="external-link"></i></button>
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-hist="${r.archivo_id}" title="Historial"><i data-lucide="history"></i></button>
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-rh-open-carpeta="${r.carpeta_id}" title="Abrir carpeta"><i data-lucide="folder-open"></i></button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>`;
    el.querySelector('[data-rh-close-search]')?.addEventListener('click', cerrarBusqueda);
    el.querySelectorAll('[data-rh-open-archivo]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.rhOpenArchivo, 10);
        const row = list.find((x) => x.archivo_id === id);
        const titulo = row?.nombre_descarga || row?.paciente_nombre || 'Reporte';
        abrirPdf(`/api/soportes/pdx/archivos/${id}/ver`, titulo);
      });
    });
    el.querySelectorAll('[data-rh-hist]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.rhHist, 10);
        const row = list.find((x) => x.archivo_id === id);
        modalHistorialRh(id, row?.paciente_nombre || 'Reporte');
      });
    });
    el.querySelectorAll('[data-rh-open-carpeta]').forEach((b) => {
      b.addEventListener('click', () => abrirCarpeta(parseInt(b.dataset.rhOpenCarpeta, 10)));
    });
    sopIcons(el);
  }

  let debounceTimer;
  function buscarPredictivo() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => buscarPaciente(), 320);
  }

  function setupFiltros() {
    const sync = () => {
      state.filtros.texto = $('rhFiltroTexto')?.value || '';
      state.filtros.periodo = $('rhFiltroPeriodo')?.value || '';
      state.filtros.tema = $('rhFiltroTema')?.value || '';
      state.filtros.orden = $('rhFiltroOrden')?.value || 'periodo_desc';
      renderLista();
    };
    $('rhFiltroTexto')?.addEventListener('input', sync);
    $('rhFiltroPeriodo')?.addEventListener('change', sync);
    $('rhFiltroTema')?.addEventListener('change', sync);
    $('rhFiltroOrden')?.addEventListener('change', sync);
    const ordenSel = $('rhFiltroOrden');
    if (ordenSel) ordenSel.value = state.filtros.orden;
  }

  async function refrescar() {
    const data = await cargarCarpetas();
    if (!data) return;
    if (state.carpetaId) await abrirCarpeta(state.carpetaId);
    else renderLista();
  }

  function initReportesHistorico() {
    sopIcons($('view-reportes-historico'));
    if (initDone) {
      refrescar().catch((e) => sopToast(e.message, 'error'));
      return;
    }
    initDone = true;
    $('btnVolverReportesHistorico')?.addEventListener('click', () => {
      if (typeof window.goToMenu === 'function') window.goToMenu();
    });
    $('btnRhRefrescar')?.addEventListener('click', () => refrescar().catch((e) => sopToast(e.message, 'error')));
    $('btnRhBuscar')?.addEventListener('click', buscarPaciente);
    $('rhBuscar')?.addEventListener('input', buscarPredictivo);
    $('rhBuscar')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); buscarPaciente(); }
      if (e.key === 'Escape') cerrarBusqueda();
    });
    let filtroArchTimer;
    $('rhFiltroArchivos')?.addEventListener('input', () => {
      clearTimeout(filtroArchTimer);
      filtroArchTimer = setTimeout(() => {
        state.filtroArchivos = ($('rhFiltroArchivos')?.value || '').trim();
        renderArchivosRh();
      }, 180);
    });
    setupFiltros();
    renderTemaLegend();
    cargarCarpetas().then(renderLista).catch((e) => sopToast(e.message, 'error'));
  }

  window.initReportesHistorico = initReportesHistorico;
  window.refreshReportesHistorico = refrescar;
})();
