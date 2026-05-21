/**
 * Módulos Cargar reportes (PDX) y Armado de soportes — UI (Lucide + design system sop-*)
 */
(function () {
  'use strict';

  let initPdxDone = false;
  let initArmadoDone = false;
  let pdxState = {
    carpetas: [],
    carpetaId: null,
    carpetaActual: null,
    archivos: [],
    periodoActual: null,
    filtros: { texto: '', periodo: '', tema: '', orden: 'periodo_desc' }
  };

  const PDX_LOG_LABEL = {
    subida: 'Subida',
    edicion: 'Edición de metadatos',
    reemplazo: 'Reemplazo de PDF',
    movimiento: 'Movido de carpeta'
  };

  const RE_PDX_CLIENT = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;

  function parseNombrePdxCliente(originalName) {
    const base = String(originalName || '').trim();
    const m = base.match(RE_PDX_CLIENT);
    if (!m) return { ok: false, original: base };
    const apellidos = m[1].trim();
    const nombres = m[2].trim();
    const fecha = m[3];
    const marcaTiempo = m[4].trim();
    const sufijo = m[5].trim();
    const estudio = m[6].trim();
    return {
      ok: true,
      original: base,
      apellidos,
      nombres,
      paciente_nombre: `${apellidos}, ${nombres}`,
      fecha_estudio: fecha,
      marca_tiempo: marcaTiempo,
      sufijo_numero: sufijo,
      estudio_texto: estudio
    };
  }

  function fechaEnPeriodoCliente(fechaStr, periodoYYYYMM) {
    if (!fechaStr || !periodoYYYYMM) return true;
    return String(fechaStr).slice(0, 7) === periodoYYYYMM;
  }

  function htmlEstudioBadge(texto, tema) {
    const t = tema || 'neutral';
    const colors = { vtm: '#2563eb', psg: '#7c3aed', eeg: '#ca8a04', actigrafia: '#0891b2', neutral: '#64748b' };
    return `<span class="sop-estudio-badge" style="--sop-estudio-color:${colors[t] || colors.neutral}">${escapeHtml(texto || '—')}</span>`;
  }

  function pdxUploadWarnings(parsed, carpeta) {
    const w = [];
    if (carpeta && parsed.fecha_estudio && !fechaEnPeriodoCliente(parsed.fecha_estudio, carpeta.periodo)) {
      w.push(`La fecha del estudio (${parsed.fecha_estudio}) no corresponde al mes de la carpeta (${carpeta.periodo}).`);
    }
    return w;
  }
  let armState = {
    periodos: [],
    periodoId: null,
    periodoLabel: null,
    dias: [],
    diaId: null,
    diaNum: null,
    expedienteId: null,
    expedienteCodigo: null,
    vista: 'empty'
  };

  function renderSopBreadcrumbs(containerEl, crumbs) {
    if (!containerEl || !crumbs?.length) return;
    containerEl.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span class="sop-crumb-sep" aria-hidden="true">›</span>' : '';
      if (c.current) {
        return `${sep}<span class="sop-crumb is-current">${escapeHtml(c.label)}</span>`;
      }
      if (c.onClick) {
        return `${sep}<button type="button" class="sop-crumb is-link" data-crumb-idx="${i}">${escapeHtml(c.label)}</button>`;
      }
      return `${sep}<span class="sop-crumb">${escapeHtml(c.label)}</span>`;
    }).join('');
    containerEl.querySelectorAll('[data-crumb-idx]').forEach((btn) => {
      const idx = parseInt(btn.dataset.crumbIdx, 10);
      const crumb = crumbs[idx];
      if (crumb?.onClick) btn.addEventListener('click', crumb.onClick);
    });
  }

  function calcExpedienteProgress(expediente, slots) {
    const ordered = ['OPF', 'CRC', 'FEV'];
    if (slots.PDX && slots.PDX.habilitado !== false) ordered.push('PDX');
    else if (slots.HEV && slots.HEV.habilitado !== false) ordered.push('HEV');
    const items = ordered.map((key) => {
      let done = false;
      if (key === 'FEV') done = !!(expediente.fev_externa_verificada || slots.FEV?.completo);
      else done = !!slots[key]?.completo;
      return { key, done };
    });
    const done = items.filter((i) => i.done).length;
    const total = items.length || 1;
    return { items, done, total, pct: Math.round((done / total) * 100) };
  }

  function htmlExpedienteProgress(expediente, slots) {
    const p = calcExpedienteProgress(expediente, slots);
    const complete = p.done >= p.total;
    return `<div class="sop-exp-progress" role="status" aria-label="Progreso del expediente">
      <div class="sop-exp-progress-head">
        <span>Documentos del expediente</span>
        <strong>${p.done} de ${p.total} completos</strong>
      </div>
      <div class="sop-exp-progress-track">
        <div class="sop-exp-progress-fill${complete ? ' is-complete' : ''}" style="width:${p.pct}%"></div>
      </div>
      <div class="sop-exp-progress-slots">
        ${p.items.map((i) => `<span class="sop-exp-progress-slot${i.done ? ' done' : ''}">${i.key}</span>`).join('')}
      </div>
    </div>`;
  }

  function renderArmadoContextBar() {
    const el = $('sopArmContextBar');
    if (!el) return;
    if (!armState.periodoId) {
      el.innerHTML = '<span class="sop-context-label">Navegación</span><span>Seleccione un periodo en el panel izquierdo</span>';
      return;
    }
    const crumbs = [{
      label: armState.periodoLabel || 'Periodo',
      current: armState.vista === 'period',
      onClick: armState.vista !== 'period' ? () => seleccionarPeriodoArmado(armState.periodoId) : null
    }];
    if (armState.diaId != null) {
      crumbs.push({
        label: `Día ${armState.diaNum ?? '—'}`,
        current: armState.vista === 'day',
        onClick: armState.vista === 'expediente' ? () => seleccionarDiaArmado(armState.diaId) : null
      });
    }
    if (armState.vista === 'expediente' && armState.expedienteCodigo) {
      crumbs.push({ label: armState.expedienteCodigo, current: true });
    } else if (armState.diaId) {
      crumbs.push({ label: 'Expedientes FE', current: true });
    } else {
      crumbs.push({ label: 'Seleccione un día', current: true });
    }
    el.innerHTML = '<span class="sop-context-label">Ubicación</span>';
    const trail = document.createElement('span');
    trail.className = 'sop-breadcrumbs';
    trail.style.margin = '0';
    trail.style.flex = '1';
    renderSopBreadcrumbs(trail, crumbs);
    el.appendChild(trail);
  }

  function renderPdxBreadcrumbLista() {
    renderSopBreadcrumbs($('sopPdxBreadcrumbLista'), [
      { label: 'Cargar reportes', current: true }
    ]);
  }

  function renderPdxBreadcrumbDetalle(carpeta) {
    if (!carpeta) return;
    renderSopBreadcrumbs($('sopPdxBreadcrumbDetalle'), [
      { label: 'Cargar reportes', onClick: volverListaPdx },
      { label: carpeta.nombre_display || 'Carpeta', current: true }
    ]);
  }

  function renderPdxDetalleAcciones(carpeta) {
    const wrap = $('sopPdxDetalleAcciones');
    if (!wrap || !carpeta) return;
    const enArchivo = carpeta.estado_visibilidad === 'archivo';
    wrap.innerHTML = `
      ${sopPerm('soportes.pdx.subir') && !enArchivo ? '<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopPdxEditCarpeta"><i data-lucide="pencil"></i> Editar carpeta</button>' : ''}
      ${sopPerm('soportes.pdx.eliminar') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopPdxDelCarpeta" style="color:#dc2626"><i data-lucide="trash-2"></i> Eliminar carpeta</button>` : ''}`;
    wrap.querySelector('#btnSopPdxEditCarpeta')?.addEventListener('click', () => modalEditarCarpetaPdx(carpeta));
    wrap.querySelector('#btnSopPdxDelCarpeta')?.addEventListener('click', () => eliminarCarpetaPdx(carpeta));
    sopIcons(wrap);
  }

  const TEMA_ICON = {
    vtm: 'video',
    psg: 'moon',
    eeg: 'activity',
    actigrafia: 'watch',
    neutral: 'folder'
  };

  const TEMA_LABEL = {
    vtm: 'VTM',
    psg: 'PSG',
    eeg: 'EEG',
    actigrafia: 'Actigrafía',
    neutral: 'General'
  };

  function renderPdxTemaLegend() {
    const el = $('sopPdxTemaLegend');
    if (!el) return;
    const temas = ['vtm', 'psg', 'eeg', 'actigrafia', 'neutral'];
    el.innerHTML = `<span class="sop-tema-legend-title">Modalidades:</span>${temas.map((t) =>
      `<span class="sop-tema-legend-item" data-tema="${t}">${TEMA_LABEL[t]}</span>`
    ).join('')}`;
  }

  function htmlArmadoSummaryChips({ total = 0, listos = 0, pendientes = 0, extra = '' } = {}) {
    const pend = pendientes != null ? pendientes : Math.max(0, total - listos);
    return `<div class="sop-summary-row">
      ${extra}
      <span class="sop-summary-chip"><i data-lucide="file-stack"></i> <strong>${total}</strong> FE</span>
      <span class="sop-summary-chip ok"><i data-lucide="circle-check"></i> <strong>${listos}</strong> listos</span>
      <span class="sop-summary-chip warn"><i data-lucide="clock"></i> <strong>${pend}</strong> pendientes</span>
    </div>`;
  }

  function badgeEstadoFe(listo) {
    return listo
      ? '<span class="sop-badge sop-badge-listo"><i data-lucide="circle-check" style="width:12px;height:12px"></i> Listo</span>'
      : '<span class="sop-badge sop-badge-pendiente"><i data-lucide="clock" style="width:12px;height:12px"></i> Pendiente</span>';
  }

  function showSkeletonFolderGrid(container, count = 6) {
    if (!container) return;
    container.innerHTML = `<div class="sop-grid sop-skeleton-grid">${Array.from({ length: count }, () =>
      '<div class="sop-skeleton-block sop-skeleton-folder-card"></div>'
    ).join('')}</div>`;
  }

  function showSkeletonNavList(container, count = 5) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () =>
      '<div class="sop-skeleton-block sop-skeleton-nav-item"></div>'
    ).join('');
  }

  function showSkeletonTableRows(tbody, cols, rows = 5) {
    if (!tbody) return;
    tbody.innerHTML = Array.from({ length: rows }, () =>
      `<tr class="sop-skeleton-table-row">${Array.from({ length: cols }, () =>
        '<td><div class="sop-skeleton-block"></div></td>'
      ).join('')}</tr>`
    ).join('');
  }

  function cerrarResultadosPdx() {
    const el = $('sopPdxResultados');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
    const inp = $('sopPdxBuscar');
    if (inp) inp.value = '';
  }

  function renderArmadoPeriodoSummary() {
    const el = $('sopArmPeriodoSummary');
    if (!el) return;
    if (!armState.periodoId) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    const totalDias = armState.dias.length;
    const totalFe = armState.dias.reduce((s, d) => s + (d.expedientes_count || 0), 0);
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-summary-row" style="margin-bottom:12px">
      <span class="sop-summary-chip"><i data-lucide="calendar-range"></i> <strong>${totalDias}</strong> días</span>
      <span class="sop-summary-chip"><i data-lucide="file-stack"></i> <strong>${totalFe}</strong> FE en el mes</span>
    </div>`;
    sopIcons(el);
  }

  function $(id) { return document.getElementById(id); }

  function sopIcons(root) {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      const opts = { attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' };
      if (root) opts.root = root;
      try { lucide.createIcons(opts); } catch (_) { lucide.createIcons(); }
    }
  }

  function sopPerm(key) {
    return typeof window.tienePermiso === 'function' && window.tienePermiso(key);
  }

  function periodoActual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function badgeVis(estado, dias) {
    const labels = { activa: 'Activo', gracia: `Gracia ${dias || 0}d`, archivo: 'Archivo' };
    const icon = estado === 'activa' ? 'circle-check' : estado === 'gracia' ? 'clock' : 'archive';
    return `<span class="sop-badge sop-badge-${estado}"><i data-lucide="${icon}" style="width:12px;height:12px"></i> ${escapeHtml(labels[estado] || estado)}</span>`;
  }

  function closeSopModal(wrap) {
    if (!wrap || !wrap.isConnected) return;
    if (wrap._sopKeyHandler) {
      document.removeEventListener('keydown', wrap._sopKeyHandler);
      wrap._sopKeyHandler = null;
    }
    const finish = () => {
      if (wrap.isConnected) wrap.remove();
      const prev = wrap._sopPrevFocus;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
    if (typeof window.innarCloseConfirm === 'function') {
      window.innarCloseConfirm(wrap, finish);
    } else {
      finish();
    }
  }

  function openSopModal(html) {
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
    wrap._sopPrevFocus = document.activeElement;
    wrap._sopClose = () => closeSopModal(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSopModal(wrap); });
    const onKey = (e) => {
      if (e.key === 'Escape') closeSopModal(wrap);
    };
    wrap._sopKeyHandler = onKey;
    document.addEventListener('keydown', onKey);
    const focusables = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !focusables.length) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(wrap);
    sopIcons(wrap);
    requestAnimationFrame(() => { if (first) first.focus(); else dialog.focus(); });
    return wrap;
  }

  function sopAnimateModuleIn(viewId) {
    const el = $(viewId);
    if (el && typeof window.innarAnimateViewIn === 'function') {
      requestAnimationFrame(() => window.innarAnimateViewIn(el));
    }
  }

  function sopArmNavOpen(open) {
    const layout = $('sopArmLayout');
    const backdrop = $('sopArmNavBackdrop');
    const btn = $('btnSopArmToggleNav');
    if (!layout) return;
    if (open) {
      layout.classList.add('sop-nav-open');
      backdrop?.classList.remove('hidden');
      backdrop?.setAttribute('aria-hidden', 'false');
      btn?.setAttribute('aria-expanded', 'true');
    } else {
      layout.classList.remove('sop-nav-open');
      backdrop?.classList.add('hidden');
      backdrop?.setAttribute('aria-hidden', 'true');
      btn?.setAttribute('aria-expanded', 'false');
    }
  }

  function sopToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
    else alert(msg);
  }

  function setupDropzone() {
    const zone = $('sopPdxDropzone');
    const input = $('sopPdxUploadInput');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('sop-dropzone-active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('sop-dropzone-active'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('sop-dropzone-active');
      if (!pdxState.carpetaId || !e.dataTransfer?.files?.length) return;
      await procesarArchivosPdx([...e.dataTransfer.files], pdxState.carpetaId);
    });
  }

  // ─── Reportes PDX ─────────────────────────────────────────────────────────

  function pdxCarpetasFiltradas() {
    let list = [...pdxState.carpetas];
    const { texto, periodo, tema, orden } = pdxState.filtros;
    const t = (texto || '').trim().toLowerCase();
    if (t) {
      list = list.filter((c) =>
        (c.nombre_display || '').toLowerCase().includes(t) ||
        (c.periodo || '').includes(t)
      );
    }
    if (periodo) list = list.filter((c) => c.periodo === periodo);
    if (tema) list = list.filter((c) => (c.color_tema || 'neutral') === tema);
    const cmpStr = (a, b) => String(a).localeCompare(String(b), 'es');
    switch (orden) {
      case 'periodo_asc':
        list.sort((a, b) => cmpStr(a.periodo, b.periodo));
        break;
      case 'nombre_asc':
        list.sort((a, b) => cmpStr(a.nombre_display, b.nombre_display));
        break;
      case 'nombre_desc':
        list.sort((a, b) => cmpStr(b.nombre_display, a.nombre_display));
        break;
      case 'archivos_desc':
        list.sort((a, b) => (b.archivos_count || 0) - (a.archivos_count || 0));
        break;
      default:
        list.sort((a, b) => cmpStr(b.periodo, a.periodo));
    }
    return list;
  }

  function actualizarFiltroPeriodosPdx() {
    const sel = $('sopPdxFiltroPeriodo');
    if (!sel) return;
    const cur = pdxState.filtros.periodo;
    const periodos = [...new Set(pdxState.carpetas.map((c) => c.periodo).filter(Boolean))].sort().reverse();
    sel.innerHTML = '<option value="">Todos los periodos</option>' +
      periodos.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (cur && periodos.includes(cur)) sel.value = cur;
  }

  function setupPdxFiltros() {
    const sync = () => {
      pdxState.filtros.texto = $('sopPdxFiltroTexto')?.value || '';
      pdxState.filtros.periodo = $('sopPdxFiltroPeriodo')?.value || '';
      pdxState.filtros.tema = $('sopPdxFiltroTema')?.value || '';
      pdxState.filtros.orden = $('sopPdxFiltroOrden')?.value || 'periodo_desc';
      renderListaCarpetasPdx();
    };
    $('sopPdxFiltroTexto')?.addEventListener('input', sync);
    $('sopPdxFiltroPeriodo')?.addEventListener('change', sync);
    $('sopPdxFiltroTema')?.addEventListener('change', sync);
    $('sopPdxFiltroOrden')?.addEventListener('change', sync);
    const ordenSel = $('sopPdxFiltroOrden');
    if (ordenSel) ordenSel.value = pdxState.filtros.orden;
  }

  async function cargarCarpetasPdx(incluirArchivo) {
    showSkeletonFolderGrid($('sopPdxLista'), 6);
    const q = incluirArchivo ? '?archivo=1' : '';
    const res = await apiFetch(`/api/soportes/pdx/carpetas${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar carpetas');
    pdxState.carpetas = data.carpetas || [];
    pdxState.periodoActual = data.periodo_actual || periodoActual();
    const chip = $('sopPdxChipPeriodo');
    if (chip) {
      chip.innerHTML = `<span class="sop-stat-chip"><i data-lucide="calendar"></i> Periodo en curso: <strong>${escapeHtml(pdxState.periodoActual)}</strong></span>
        <span class="sop-stat-chip"><i data-lucide="folder"></i> <strong>${pdxState.carpetas.length}</strong> carpetas</span>`;
      sopIcons(chip);
    }
    actualizarFiltroPeriodosPdx();
    return data;
  }

  function renderListaCarpetasPdx() {
    renderPdxBreadcrumbLista();
    renderPdxTemaLegend();
    const el = $('sopPdxLista');
    if (!el) return;
    const lista = pdxCarpetasFiltradas();
    if (!pdxState.carpetas.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="folder-open" class="sop-empty-icon"></i>No hay carpetas.<br><span style="font-size:.85rem">Use «Nueva carpeta» para comenzar.</span></div>`;
      sopIcons(el);
      return;
    }
    if (!lista.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="filter-x" class="sop-empty-icon"></i>Ninguna carpeta coincide con los filtros.</div>`;
      sopIcons(el);
      return;
    }
    const canEdit = sopPerm('soportes.pdx.subir');
    const canDel = sopPerm('soportes.pdx.eliminar');
    el.innerHTML = `<div class="sop-grid">${lista.map((c) => {
      const tema = c.color_tema || 'neutral';
      const icon = TEMA_ICON[tema] || 'folder';
      const enArchivo = c.estado_visibilidad === 'archivo';
      return `<article class="sop-folder-card" data-tema="${escapeHtml(tema)}" data-pdx-carpeta="${c.id}">
        <div class="sop-folder-icon"><i data-lucide="${icon}"></i></div>
        <div class="sop-folder-title">${escapeHtml(c.nombre_display)}</div>
        <div class="sop-folder-meta">${escapeHtml(c.periodo)} · ${c.archivos_count || 0} archivo(s)</div>
        ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}
        ${(canEdit || canDel) ? `<div class="sop-folder-actions">
          ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit="${c.id}"><i data-lucide="pencil"></i></button>` : ''}
          ${canDel ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del-carpeta="${c.id}" title="Eliminar carpeta" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
        </div>` : ''}
      </article>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-pdx-carpeta]').forEach((card) => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-actions')) return;
        abrirCarpetaPdx(parseInt(card.dataset.pdxCarpeta, 10));
      });
    });
    el.querySelectorAll('[data-pdx-edit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxEdit, 10));
        if (c) modalEditarCarpetaPdx(c);
      });
    });
    el.querySelectorAll('[data-pdx-del-carpeta]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxDelCarpeta, 10));
        if (c) eliminarCarpetaPdx(c);
      });
    });
    sopIcons(el);
  }

  async function eliminarArchivoPdx(archivoId, nombre) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const label = nombre || `archivo #${archivoId}`;
    if (!window.confirm(`¿Eliminar "${label}"? Esta acción no se puede deshacer.`)) return;
    const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { sopToast(data.error || 'No se pudo eliminar', 'error'); return; }
    sopToast('Archivo eliminado', 'success');
    if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
  }

  async function abrirCarpetaPdx(id) {
    pdxState.carpetaId = id;
    $('sopPdxVistaLista')?.classList.add('hidden');
    $('sopPdxVistaDetalle')?.classList.remove('hidden');
    showSkeletonTableRows($('sopPdxArchivosBody'), 4, 4);
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${id}/archivos`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    pdxState.archivos = data.archivos || [];
    const c = data.carpeta;
    pdxState.carpetaActual = c;
    renderPdxBreadcrumbDetalle(c);
    renderPdxDetalleAcciones(c);
    $('sopPdxDetalleTitulo').textContent = c.nombre_display;
    $('sopPdxDetalleMeta').innerHTML = `${escapeHtml(c.periodo)} ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}`;
    sopIcons($('sopPdxDetalleMeta'));
    const tbody = $('sopPdxArchivosBody');
    if (!pdxState.archivos.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="sop-empty" style="padding:24px">Sin archivos en esta carpeta</td></tr>';
      return;
    }
    const canDelete = sopPerm('soportes.pdx.eliminar');
    const canEdit = sopPerm('soportes.pdx.subir');
    const enArchivo = c.estado_visibilidad === 'archivo';
    const temaCarpeta = c.color_tema || 'neutral';
    tbody.innerHTML = pdxState.archivos.map((a) => {
      const metaUser = a.editado_por_nombre
        ? `Editado por ${escapeHtml(a.editado_por_nombre)}`
        : (a.subido_por_nombre ? `Subido por ${escapeHtml(a.subido_por_nombre)}` : '');
      const nomArch = a.nombre_archivo_display || a.nombre_archivo_original || '';
      return `<tr>
      <td>
        <strong>${escapeHtml(a.paciente_nombre)}</strong>
        ${metaUser ? `<div class="sop-pdx-meta-user">${metaUser}</div>` : ''}
      </td>
      <td>${escapeHtml(a.fecha_estudio || '—')}</td>
      <td>${htmlEstudioBadge(a.estudio_texto, temaCarpeta)}</td>
      <td><span class="sop-pdx-archivo-nombre" title="${escapeHtml(nomArch)}">${escapeHtml(nomArch)}</span></td>
      <td><div class="sop-actions-row">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-ver="${a.id}" title="Vista previa"><i data-lucide="eye"></i></button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-dl="${a.id}" title="Descargar"><i data-lucide="download"></i></button>
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit-arch="${a.id}" title="Editar datos"><i data-lucide="pencil"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-replace="${a.id}" title="Reemplazar PDF"><i data-lucide="file-up"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-move="${a.id}" title="Mover a otra carpeta"><i data-lucide="folder-input"></i></button>` : ''}
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-hist="${a.id}" title="Historial"><i data-lucide="history"></i></button>
        ${sopPerm('soportes.armado.importar_pdx') ? `<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" data-pdx-link="${a.id}" title="Vincular FE"><i data-lucide="link-2"></i></button>` : ''}
        ${canDelete ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del="${a.id}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
      </div></td>
    </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-pdx-ver]').forEach((b) => {
      b.addEventListener('click', () => modalVerPdfPdx(parseInt(b.dataset.pdxVer, 10)));
    });
    tbody.querySelectorAll('[data-pdx-dl]').forEach((b) => {
      b.addEventListener('click', () => window.open(`/api/soportes/pdx/archivos/${b.dataset.pdxDl}/descargar`, '_blank'));
    });
    tbody.querySelectorAll('[data-pdx-link]').forEach((b) => {
      b.addEventListener('click', () => modalVincularPdx(parseInt(b.dataset.pdxLink, 10)));
    });
    tbody.querySelectorAll('[data-pdx-edit-arch]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxEditArch, 10));
        if (row) modalEditarArchivoPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-replace]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxReplace, 10));
        if (row) modalReemplazarPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-move]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxMove, 10));
        if (row) modalMoverCarpetaPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-hist]').forEach((b) => {
      b.addEventListener('click', () => modalHistorialPdx(parseInt(b.dataset.pdxHist, 10)));
    });
    tbody.querySelectorAll('[data-pdx-del]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const aid = parseInt(b.dataset.pdxDel, 10);
        const row = pdxState.archivos.find((x) => x.id === aid);
        eliminarArchivoPdx(aid, row?.paciente_nombre);
      });
    });
    const zone = $('sopPdxDropzone');
    const inputUp = $('sopPdxUploadInput');
    if (zone) zone.classList.toggle('sop-dropzone-disabled', enArchivo);
    if (inputUp) inputUp.disabled = enArchivo;
    sopIcons($('sopPdxVistaDetalle'));
  }

  async function eliminarCarpetaPdx(carpeta) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const n = carpeta.archivos_count || 0;
    const msg = n > 0
      ? `¿Eliminar la carpeta «${carpeta.nombre_display}» y sus ${n} archivo(s)? No se puede deshacer.`
      : `¿Eliminar la carpeta vacía «${carpeta.nombre_display}»?`;
    if (!window.confirm(msg)) return;
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpeta.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      sopToast(data.error || 'No se puede eliminar (archivos vinculados a FE)', 'error');
      return;
    }
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    sopToast('Carpeta eliminada', 'success');
    if (pdxState.carpetaId === carpeta.id) volverListaPdx();
    else {
      await cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked);
      renderListaCarpetasPdx();
    }
  }

  function modalEditarCarpetaPdx(carpeta) {
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar carpeta</h3>
      <div class="sop-field"><label>Periodo (mes)</label><input type="month" id="sopPdxEditPer" value="${escapeHtml(carpeta.periodo)}"></div>
      <div class="sop-field"><label>Nombre visible</label><input type="text" id="sopPdxEditNom" value="${escapeHtml(carpeta.nombre_display)}"></div>
      <p style="font-size:.8rem;color:#64748b;margin:0">El tema de color (VTM, PSG, etc.) se detecta del nombre.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEditCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEditOk">Guardar</button>
      </div>`);
    modal.querySelector('#sopPdxEditCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxEditOk').onclick = async () => {
      const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpeta.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo: $('sopPdxEditPer').value,
          nombre_display: $('sopPdxEditNom').value.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta actualizada', 'success');
      await cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked);
      if (pdxState.carpetaId === carpeta.id) abrirCarpetaPdx(carpeta.id);
      else renderListaCarpetasPdx();
    };
  }

  function modalVerPdfPdx(archivoId) {
    const url = `/api/soportes/pdx/archivos/${archivoId}/ver`;
    const modal = openSopModal(`
      <h3><i data-lucide="eye"></i> Vista previa del PDF</h3>
      <iframe class="sop-pdf-frame" src="${url}" title="Vista previa PDF"></iframe>
      <div class="sop-dialog-actions" style="margin-top:12px">
        <a href="${url}" target="_blank" rel="noopener" class="sop-btn sop-btn-ghost">Abrir en pestaña</a>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxPdfClose">Cerrar</button>
      </div>`);
    modal.querySelector('#sopPdxPdfClose').onclick = () => closeSopModal(modal);
    const dlg = modal.querySelector('.sop-dialog');
    if (dlg) dlg.classList.add('sop-dialog-pdf');
  }

  async function modalHistorialPdx(archivoId) {
    const row = pdxState.archivos.find((x) => x.id === archivoId);
    const modal = openSopModal(`
      <h3><i data-lucide="history"></i> Historial</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">${escapeHtml(row?.paciente_nombre || 'Reporte')}</p>
      <div id="sopPdxHistBody"><div class="sop-empty" style="padding:16px"><i data-lucide="loader"></i></div></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxHistClose">Cerrar</button>
      </div>`);
    modal.querySelector('#sopPdxHistClose').onclick = () => closeSopModal(modal);
    const body = modal.querySelector('#sopPdxHistBody');
    try {
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}/historial`);
      const data = await res.json();
      const evs = data.eventos || [];
      if (!evs.length) {
        body.innerHTML = '<p class="sop-empty" style="padding:12px">Sin eventos registrados.</p>';
      } else {
        body.innerHTML = `<ul class="sop-hist-list">${evs.map((e) => {
          const tipo = PDX_LOG_LABEL[e.tipo] || e.tipo;
          const cuando = e.creado_en ? new Date(e.creado_en).toLocaleString('es-CO') : '';
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

  function modalReemplazarPdx(archivo) {
    const modal = openSopModal(`
      <h3><i data-lucide="file-up"></i> Reemplazar PDF</h3>
      <p style="font-size:.85rem;color:#64748b">Se actualiza el mismo registro (${escapeHtml(archivo.paciente_nombre)}). El PDF anterior se elimina del disco.</p>
      <div class="sop-field"><label>Nuevo archivo PDF</label><input type="file" id="sopPdxRepFile" accept=".pdf"></div>
      <div id="sopPdxRepManual" class="hidden">
        <p style="font-size:.8rem;color:#64748b">El nombre no tiene formato estándar; indique metadatos:</p>
        <div class="sop-field"><label>Apellidos</label><input type="text" id="sopPdxRepApe" value="${escapeHtml(archivo.apellidos || '')}"></div>
        <div class="sop-field"><label>Nombres</label><input type="text" id="sopPdxRepNom" value="${escapeHtml(archivo.nombres || '')}"></div>
        <div class="sop-field"><label>Fecha estudio</label><input type="date" id="sopPdxRepFecha" value="${escapeHtml(archivo.fecha_estudio || '')}"></div>
        <div class="sop-field"><label>Estudio</label><input type="text" id="sopPdxRepEstMan" value="${escapeHtml(archivo.estudio_texto || '')}"></div>
      </div>
      <label class="sop-toggle sop-pdx-rep-opt" style="margin:8px 0"><input type="checkbox" id="sopPdxRepCorregir"> Corregir nombre del estudio</label>
      <div class="sop-field hidden sop-pdx-rep-opt" id="sopPdxRepEstWrap"><input type="text" id="sopPdxRepEst" value="${escapeHtml(archivo.estudio_texto || '')}" placeholder="PSG BASAL…"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxRepCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxRepOk">Reemplazar</button>
      </div>`);
    const manualWrap = modal.querySelector('#sopPdxRepManual');
    const repFile = modal.querySelector('#sopPdxRepFile');
    const syncRepUi = () => {
      const file = repFile?.files?.[0];
      const parsed = file ? parseNombrePdxCliente(file.name) : null;
      const manual = file && !parsed?.ok;
      manualWrap?.classList.toggle('hidden', !manual);
      modal.querySelectorAll('.sop-pdx-rep-opt').forEach((el) => {
        el.classList.toggle('hidden', manual);
      });
    };
    repFile?.addEventListener('change', syncRepUi);
    modal.querySelector('#sopPdxRepCorregir')?.addEventListener('change', (e) => {
      modal.querySelector('#sopPdxRepEstWrap')?.classList.toggle('hidden', !e.target.checked);
    });
    modal.querySelector('#sopPdxRepCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxRepOk').onclick = async () => {
      const file = repFile?.files?.[0];
      if (!file) return sopToast('Seleccione un PDF', 'warning');
      const fd = new FormData();
      fd.append('file', file);
      const parsed = parseNombrePdxCliente(file.name);
      if (!parsed.ok) {
        const body = {
          apellidos: modal.querySelector('#sopPdxRepApe')?.value?.trim(),
          nombres: modal.querySelector('#sopPdxRepNom')?.value?.trim(),
          fecha_estudio: modal.querySelector('#sopPdxRepFecha')?.value,
          estudio_texto: modal.querySelector('#sopPdxRepEstMan')?.value?.trim()
        };
        if (!body.apellidos || !body.nombres || !body.fecha_estudio || !body.estudio_texto) {
          return sopToast('Complete apellidos, nombres, fecha y estudio', 'warning');
        }
        Object.keys(body).forEach((k) => fd.append(k, body[k]));
      } else if (modal.querySelector('#sopPdxRepCorregir')?.checked) {
        const est = modal.querySelector('#sopPdxRepEst')?.value?.trim();
        if (est) fd.append('estudio_texto', est);
      }
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}/reemplazar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('PDF reemplazado', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  async function modalMoverCarpetaPdx(archivo) {
    if (!pdxState.carpetas.length) {
      await cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked);
    }
    const opts = pdxState.carpetas
      .filter((c) => c.id !== archivo.carpeta_id && c.estado_visibilidad !== 'archivo')
      .map((c) => `<option value="${c.id}">${escapeHtml(c.nombre_display)} (${escapeHtml(c.periodo)})</option>`)
      .join('');
    if (!opts) return sopToast('No hay otra carpeta abierta disponible', 'warning');
    const modal = openSopModal(`
      <h3><i data-lucide="folder-input"></i> Mover a otra carpeta</h3>
      <p style="font-size:.85rem;color:#64748b">${escapeHtml(archivo.paciente_nombre)}</p>
      <div class="sop-field"><label>Carpeta destino</label>
        <select id="sopPdxMoveDest"><option value="">— Seleccione —</option>${opts}</select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxMoveCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxMoveOk">Mover</button>
      </div>`);
    modal.querySelector('#sopPdxMoveCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxMoveOk').onclick = async () => {
      const dest = parseInt(modal.querySelector('#sopPdxMoveDest')?.value, 10);
      if (!dest) return sopToast('Seleccione carpeta destino', 'warning');
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carpeta_id: dest })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('Archivo movido', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  function modalEditarArchivoPdx(archivo) {
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar datos del reporte</h3>
      <div class="sop-field"><label>Apellidos</label><input type="text" id="sopPdxEdApe" value="${escapeHtml(archivo.apellidos || '')}"></div>
      <div class="sop-field"><label>Nombres</label><input type="text" id="sopPdxEdNom" value="${escapeHtml(archivo.nombres || '')}"></div>
      <div class="sop-field"><label>Fecha del estudio</label><input type="date" id="sopPdxEdFecha" value="${escapeHtml(archivo.fecha_estudio || '')}"></div>
      <div class="sop-field"><label>Nombre del estudio</label><input type="text" id="sopPdxEdEst" value="${escapeHtml(archivo.estudio_texto || '')}" placeholder="PSG BASAL, EEG, VTM…"></div>
      <div class="sop-field"><label>Documento (opcional)</label><input type="text" id="sopPdxEdDoc" value="${escapeHtml(archivo.paciente_documento || '')}"></div>
      <p style="margin:8px 0 0"><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdxEdHist"><i data-lucide="history"></i> Ver historial</button></p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEdCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEdOk">Guardar</button>
      </div>`);
    modal.querySelector('#sopPdxEdHist')?.addEventListener('click', () => {
      closeSopModal(modal);
      modalHistorialPdx(archivo.id);
    });
    modal.querySelector('#sopPdxEdCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxEdOk').onclick = async () => {
      const body = {
        apellidos: $('sopPdxEdApe').value.trim(),
        nombres: $('sopPdxEdNom').value.trim(),
        fecha_estudio: $('sopPdxEdFecha').value,
        estudio_texto: $('sopPdxEdEst').value.trim(),
        paciente_documento: $('sopPdxEdDoc').value.trim() || null
      };
      if (!body.apellidos || !body.nombres || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Complete todos los campos obligatorios', 'warning');
      }
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('Reporte actualizado', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  function volverListaPdx() {
    pdxState.carpetaId = null;
    pdxState.carpetaActual = null;
    $('sopPdxVistaDetalle')?.classList.add('hidden');
    $('sopPdxVistaLista')?.classList.remove('hidden');
    cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked).then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
    sopIcons($('view-reportes-pdx'));
  }

  function modalNuevaCarpetaPdx() {
    const per = periodoActual();
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus" style="vertical-align:-3px;width:22px"></i> Nueva carpeta de reportes</h3>
      <div class="sop-field"><label>Periodo</label><input type="month" id="sopPdxNewPeriodo" value="${per}"></div>
      <div class="sop-field"><label>Nombre de carpeta</label>
        <input type="text" id="sopPdxNewNombre" placeholder="REPORTES MES MARZO VTM"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxNewCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxNewOk">Crear carpeta</button>
      </div>`);
    modal.querySelector('#sopPdxNewCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxNewOk').onclick = async () => {
      const periodo = $('sopPdxNewPeriodo').value;
      const nombre_display = $('sopPdxNewNombre').value.trim();
      const res = await apiFetch('/api/soportes/pdx/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, nombre_display })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta creada', 'success');
      await cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked);
      renderListaCarpetasPdx();
    };
  }

  async function subirArchivoPdx(file, carpetaId, extra) {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpetaId}/archivos`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir');
    if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
    return data;
  }

  function flujoSubidaPdx(file, carpetaId) {
    return new Promise((resolve, reject) => {
      const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
      const parsed = parseNombrePdxCliente(file.name);
      if (parsed.ok) modalSubidaPdxNombreCompleto(file, carpetaId, carpeta, parsed, resolve, reject);
      else modalSubidaPdxManual(file, carpetaId, carpeta, resolve, reject);
    });
  }

  function modalSubidaPdxNombreCompleto(file, carpetaId, carpeta, parsed, resolve, reject) {
    const warns = pdxUploadWarnings(parsed, carpeta);
    const modal = openSopModal(`
      <h3><i data-lucide="file-check"></i> Confirmar carga</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">El nombre del archivo tiene el formato completo. Revise los datos detectados:</p>
      <dl class="sop-upload-preview">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
        <dt>Paciente</dt><dd>${escapeHtml(parsed.paciente_nombre)}</dd>
        <dt>Fecha estudio</dt><dd>${escapeHtml(parsed.fecha_estudio)}</dd>
        <dt>Estudio</dt><dd><strong>${escapeHtml(parsed.estudio_texto)}</strong></dd>
      </dl>
      ${warns.length ? `<div class="sop-upload-warn">${escapeHtml(warns.join(' '))}</div>` : '<div class="sop-upload-ok">Los datos se leyeron del nombre del archivo.</div>'}
      <label class="sop-toggle" style="margin:12px 0 8px"><input type="checkbox" id="sopPdxCorregirEst"> Corregir nombre del estudio</label>
      <div class="sop-field hidden" id="sopPdxEstWrap"><label>Nombre del estudio</label>
        <input type="text" id="sopPdxEstCorregido" value="${escapeHtml(parsed.estudio_texto)}"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxUpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxUpOk">Subir PDF</button>
      </div>`);
    const chk = modal.querySelector('#sopPdxCorregirEst');
    const wrap = modal.querySelector('#sopPdxEstWrap');
    chk?.addEventListener('change', () => wrap?.classList.toggle('hidden', !chk.checked));
    modal.querySelector('#sopPdxUpCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxUpOk').onclick = async () => {
      const extra = {};
      if (chk?.checked) {
        const est = $('sopPdxEstCorregido')?.value?.trim();
        if (!est) return sopToast('Indique el nombre del estudio', 'warning');
        extra.estudio_texto = est;
      }
      try {
        await subirArchivoPdx(file, carpetaId, Object.keys(extra).length ? extra : undefined);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  function modalSubidaPdxManual(file, carpetaId, carpeta, resolve, reject) {
    const modal = openSopModal(`
      <h3><i data-lucide="file-warning"></i> Datos del reporte</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">El archivo <strong>${escapeHtml(file.name)}</strong> no coincide con el formato estándar. Complete los datos:</p>
      <div class="sop-pdx-format-help" style="margin-bottom:14px;padding:10px 12px">
        <p class="sop-pdx-format-pattern" style="margin:0"><code>Apellido, Nombre &nbsp; YYYY-MM-DD &nbsp; HH-mm-ss &nbsp; N. &nbsp; TIPO ESTUDIO.pdf</code></p>
      </div>
      <div class="sop-field"><label>Apellidos *</label><input type="text" id="sopPdxConfApe"></div>
      <div class="sop-field"><label>Nombres *</label><input type="text" id="sopPdxConfNom"></div>
      <div class="sop-field"><label>Fecha del estudio *</label><input type="date" id="sopPdxConfFecha"></div>
      <div class="sop-field"><label>Nombre del estudio *</label><input type="text" id="sopPdxConfEst" placeholder="Ej: PSG BASAL, EEG ROUTINE, VTM"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxConfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxConfOk">Subir PDF</button>
      </div>`);
    modal.querySelector('#sopPdxConfCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxConfOk').onclick = async () => {
      const body = {
        apellidos: $('sopPdxConfApe').value.trim(),
        nombres: $('sopPdxConfNom').value.trim(),
        fecha_estudio: $('sopPdxConfFecha').value,
        estudio_texto: $('sopPdxConfEst').value.trim()
      };
      if (!body.apellidos || !body.nombres || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Apellidos, nombres, fecha y estudio son obligatorios', 'warning');
      }
      const pre = { ...body, fecha_estudio: body.fecha_estudio };
      const warns = pdxUploadWarnings(pre, carpeta);
      if (warns.length) sopToast(warns[0], 'warning');
      try {
        await subirArchivoPdx(file, carpetaId, body);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  function modalSubidaLotePdx(files, carpetaId) {
    const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
    const items = files.map((file, idx) => {
      const parsed = parseNombrePdxCliente(file.name);
      return { idx, file, parsed, manual: !parsed.ok };
    });
    const filas = items.map((it) => {
      if (!it.manual) {
        const w = pdxUploadWarnings(it.parsed, carpeta);
        return `<tr data-lote-idx="${it.idx}">
          <td>${escapeHtml(it.file.name)}</td>
          <td>${escapeHtml(it.parsed.paciente_nombre)}</td>
          <td>${escapeHtml(it.parsed.fecha_estudio)}</td>
          <td>${escapeHtml(it.parsed.estudio_texto)}</td>
          <td>${w.length ? '<span style="color:#b45309">Revisar</span>' : '<span style="color:#059669">OK</span>'}</td>
        </tr>`;
      }
      return `<tr class="sop-lote-manual" data-lote-idx="${it.idx}">
        <td colspan="5">
          <strong>${escapeHtml(it.file.name)}</strong> — complete datos:
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
            <input type="text" data-lote-ape="${it.idx}" placeholder="Apellidos *">
            <input type="text" data-lote-nom="${it.idx}" placeholder="Nombres *">
            <input type="date" data-lote-fecha="${it.idx}">
            <input type="text" data-lote-est="${it.idx}" placeholder="Estudio *">
          </div>
        </td>
      </tr>`;
    }).join('');

    return new Promise((resolve, reject) => {
      const modal = openSopModal(`
        <h3><i data-lucide="files"></i> Confirmar carga (${items.length} PDF)</h3>
        <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Carpeta: <strong>${escapeHtml(carpeta?.nombre_display || '')}</strong> — una sola confirmación para todos.</p>
        <div style="max-height:50vh;overflow:auto">
          <table class="sop-lote-table">
            <thead><tr><th>Archivo</th><th>Paciente</th><th>Fecha</th><th>Estudio</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
        <div class="sop-dialog-actions" style="margin-top:14px">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxLoteCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-primary" id="sopPdxLoteOk">Subir ${items.length} archivo(s)</button>
        </div>`);
      modal.querySelector('#sopPdxLoteCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
      modal.querySelector('#sopPdxLoteOk').onclick = async () => {
        const extras = [];
        for (const it of items) {
          if (!it.manual) {
            extras.push({ file: it.file, extra: undefined });
            continue;
          }
          const ape = modal.querySelector(`[data-lote-ape="${it.idx}"]`)?.value?.trim();
          const nom = modal.querySelector(`[data-lote-nom="${it.idx}"]`)?.value?.trim();
          const fecha = modal.querySelector(`[data-lote-fecha="${it.idx}"]`)?.value;
          const est = modal.querySelector(`[data-lote-est="${it.idx}"]`)?.value?.trim();
          if (!ape || !nom || !fecha || !est) {
            return sopToast(`Complete datos de «${it.file.name}»`, 'warning');
          }
          extras.push({
            file: it.file,
            extra: { apellidos: ape, nombres: nom, fecha_estudio: fecha, estudio_texto: est }
          });
        }
        const btn = modal.querySelector('#sopPdxLoteOk');
        btn.disabled = true;
        let ok = 0;
        let fail = 0;
        for (const { file, extra } of extras) {
          try {
            await subirArchivoPdx(file, carpetaId, extra);
            ok++;
          } catch (e) {
            fail++;
            sopToast(`${file.name}: ${e.message}`, 'error');
          }
        }
        closeSopModal(modal);
        if (ok) sopToast(`${ok} archivo(s) subido(s)${fail ? `, ${fail} con error` : ''}`, fail ? 'warning' : 'success');
        resolve();
      };
    });
  }

  async function procesarArchivosPdx(files, carpetaId) {
    if (!files?.length || !carpetaId) return;
    const pdfs = [...files].filter((f) => {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        sopToast(`${f.name}: solo PDF`, 'warning');
        return false;
      }
      return true;
    });
    if (!pdfs.length) return;
    try {
      if (pdfs.length === 1) {
        await flujoSubidaPdx(pdfs[0], carpetaId);
      } else {
        await modalSubidaLotePdx(pdfs, carpetaId);
      }
    } catch (e) {
      if (e.message !== 'cancelado') sopToast(e.message, 'error');
      return;
    }
    abrirCarpetaPdx(carpetaId);
  }

  async function buscarPdx() {
    const q = $('sopPdxBuscar')?.value?.trim();
    if (!q || q.length < 2) { sopToast('Escriba al menos 2 caracteres', 'warning'); return; }
    const el = $('sopPdxResultados');
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-search-results-head"><h4>Resultados de búsqueda</h4><span class="sop-search-results-meta">Buscando…</span></div>
      <div class="sop-search-results-body"><div class="sop-empty" style="padding:24px"><i data-lucide="loader" class="sop-empty-icon"></i></div></div>`;
    sopIcons(el);
    const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const list = data.resultados || [];
    if (!list.length) {
      el.innerHTML = `<div class="sop-search-results-head">
          <h4>Resultados de búsqueda</h4>
          <span class="sop-search-results-meta">Sin coincidencias</span>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-pdx-search><i data-lucide="x"></i> Cerrar</button>
        </div>
        <div class="sop-search-results-body"><div class="sop-empty" style="padding:20px">No se encontraron archivos para «${escapeHtml(q)}»</div></div>`;
      el.querySelector('[data-close-pdx-search]')?.addEventListener('click', cerrarResultadosPdx);
      sopIcons(el);
      return;
    }
    el.innerHTML = `<div class="sop-search-results-head">
        <h4>Resultados de búsqueda</h4>
        <span class="sop-search-results-meta">${list.length} encontrado${list.length !== 1 ? 's' : ''}</span>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-pdx-search><i data-lucide="x"></i> Cerrar</button>
      </div>
      <div class="sop-search-results-body">
        <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
          <th>Paciente</th><th>Fecha</th><th>Carpeta</th><th></th></tr></thead><tbody>
          ${list.map((r) => `<tr>
            <td>${escapeHtml(r.paciente_nombre)}</td>
            <td>${escapeHtml(r.fecha_estudio || '—')}</td>
            <td>${escapeHtml(r.carpeta_nombre)} <span class="sop-search-results-meta">(${escapeHtml(r.periodo)})</span></td>
            <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-open-carpeta="${r.carpeta_id}"><i data-lucide="folder-open"></i> Abrir</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>`;
    el.querySelector('[data-close-pdx-search]')?.addEventListener('click', cerrarResultadosPdx);
    el.querySelectorAll('[data-open-carpeta]').forEach((b) => {
      b.addEventListener('click', () => { cerrarResultadosPdx(); abrirCarpetaPdx(parseInt(b.dataset.openCarpeta, 10)); });
    });
    sopIcons(el);
  }

  async function modalVincularPdx(pdxArchivoId) {
    const res = await apiFetch('/api/soportes/armado/expedientes-select');
    const data = await res.json();
    const opts = (data.expedientes || []).map((e) =>
      `<option value="${e.id}">${escapeHtml(e.codigo)} — ${escapeHtml(e.paciente_nombre)} (${e.periodo} · día ${e.dia})</option>`
    ).join('');
    const modal = openSopModal(`
      <h3><i data-lucide="link-2" style="vertical-align:-3px;width:20px"></i> Vincular a expediente FE</h3>
      <div class="sop-field"><label>Expediente</label>
        <select id="sopLinkExp"><option value="">— Seleccione —</option>${opts}</select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopLinkCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopLinkOk">Importar PDX</button>
      </div>`);
    modal.querySelector('#sopLinkCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopLinkOk').onclick = async () => {
      const expId = parseInt($('sopLinkExp').value, 10);
      if (!expId) return sopToast('Seleccione un expediente', 'warning');
      const r2 = await apiFetch(`/api/soportes/armado/expedientes/${expId}/importar-pdx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdx_archivo_id: pdxArchivoId })
      });
      const d2 = await r2.json();
      if (!r2.ok) { sopToast(d2.error || 'Error', 'error'); return; }
      if (d2.warnings?.length) sopToast(d2.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('PDX vinculado al expediente', 'success');
    };
  }

  window.initReportesPdx = function initReportesPdx() {
    sopIcons($('view-reportes-pdx'));
    sopAnimateModuleIn('view-reportes-pdx');
    if (initPdxDone) {
      cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked).then(renderListaCarpetasPdx).catch(console.error);
      return;
    }
    initPdxDone = true;
    setupPdxFiltros();
    sopIcons($('sopPdxFiltrosBar'));
    $('btnVolverReportesPdx')?.addEventListener('click', goToMenu);
    $('btnSopPdxNuevaCarpeta')?.addEventListener('click', modalNuevaCarpetaPdx);
    $('btnSopPdxBuscar')?.addEventListener('click', buscarPdx);
    $('sopPdxBuscar')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarPdx(); });
    $('sopPdxIncluirArchivo')?.addEventListener('change', () => {
      cerrarResultadosPdx();
      cargarCarpetasPdx($('sopPdxIncluirArchivo').checked).then(renderListaCarpetasPdx);
    });
    renderPdxTemaLegend();
    $('sopPdxUploadInput')?.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files?.length || !pdxState.carpetaId) return;
      await procesarArchivosPdx([...files], pdxState.carpetaId);
      e.target.value = '';
    });
    setupDropzone();
    cargarCarpetasPdx(false).then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
  };

  // ─── Armado de soportes ───────────────────────────────────────────────────

  async function cargarPeriodosArmado() {
    showSkeletonNavList($('sopArmPeriodos'), 5);
    const incluir = $('sopArmIncluirArchivo')?.checked ? '?archivo=1' : '';
    const res = await apiFetch(`/api/soportes/armado/periodos${incluir}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    armState.periodos = data.periodos || [];
    return data;
  }

  function renderPeriodosArmado() {
    const el = $('sopArmPeriodos');
    if (!armState.periodos.length) {
      el.innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Sin periodos</div>';
      return;
    }
    el.innerHTML = armState.periodos.map((p) =>
      `<div class="sop-nav-item${armState.periodoId === p.id ? ' active' : ''}" data-periodo-id="${p.id}">
        <span>${escapeHtml(p.etiqueta || p.periodo)}</span>
        ${badgeVis(p.estado_visibilidad, p.dias_restantes_gracia)}
      </div>`
    ).join('');
    el.querySelectorAll('[data-periodo-id]').forEach((item) => {
      item.addEventListener('click', () => seleccionarPeriodoArmado(parseInt(item.dataset.periodoId, 10)));
    });
    sopIcons(el);
  }

  async function seleccionarPeriodoArmado(id) {
    armState.periodoId = id;
    armState.diaId = null;
    armState.diaNum = null;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'period';
    const per = armState.periodos.find((p) => p.id === id);
    armState.periodoLabel = per?.etiqueta || per?.periodo || 'Periodo';
    renderPeriodosArmado();
    showSkeletonNavList($('sopArmDias'), 4);
    const res = await apiFetch(`/api/soportes/armado/periodos/${id}/dias`);
    const data = await res.json();
    armState.dias = data.dias || [];
    const diasEl = $('sopArmDias');
    if (!armState.dias.length) {
      diasEl.innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Sin días — use «Día»</div>';
    } else {
      diasEl.innerHTML = armState.dias.map((d) =>
        `<div class="sop-nav-item${armState.diaId === d.id ? ' active' : ''}" data-dia-id="${d.id}">
          <span><i data-lucide="calendar-days" style="width:14px;height:14px;vertical-align:-2px"></i> Día ${d.dia}</span>
          <span style="font-size:.75rem;color:#94a3b8">${d.expedientes_count || 0} FE</span>
        </div>`
      ).join('');
      diasEl.querySelectorAll('[data-dia-id]').forEach((item) => {
        item.addEventListener('click', () => seleccionarDiaArmado(parseInt(item.dataset.diaId, 10)));
      });
    }
    sopIcons(diasEl);
    renderArmadoPeriodoSummary();
    renderArmadoPlaceholder('Seleccione un día del mes');
    renderArmadoContextBar();
    sopArmNavOpen(false);
  }

  function renderArmadoPlaceholder(msg) {
    armState.vista = armState.periodoId ? (armState.diaId ? 'day' : 'period') : 'empty';
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    if (!armState.periodoId) {
      const sum = $('sopArmPeriodoSummary');
      if (sum) { sum.classList.add('hidden'); sum.innerHTML = ''; }
    }
    $('sopArmExpedientePanel').innerHTML = `<div class="sop-panel-body"><div class="sop-empty">
      <i data-lucide="layers" class="sop-empty-icon"></i>${escapeHtml(msg)}</div></div>`;
    sopIcons($('sopArmExpedientePanel'));
    renderArmadoContextBar();
  }

  async function seleccionarDiaArmado(id) {
    armState.diaId = id;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'day';
    const diaRow = armState.dias.find((d) => d.id === id);
    armState.diaNum = diaRow?.dia ?? null;
    document.querySelectorAll('#sopArmDias .sop-nav-item').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.diaId, 10) === id);
    });
    const panel = $('sopArmExpedientePanel');
    panel.innerHTML = `<div class="sop-panel-head">
        <h3><i data-lucide="file-stack"></i> Expedientes del día ${armState.diaNum ?? ''}</h3>
        ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-teal" id="btnSopArmNuevoFe"><i data-lucide="plus"></i> Añadir FE</button>` : ''}
      </div>
      <div class="sop-panel-body">
        <div id="sopArmDiaSummaryWrap"></div>
        <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
          <th>FE</th><th>Paciente</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody id="sopArmExpedientesBody"></tbody>
        </table></div>
      </div>`;
    showSkeletonTableRows($('sopArmExpedientesBody'), 5, 4);
    const res = await apiFetch(`/api/soportes/armado/dias/${id}/expedientes`);
    const data = await res.json();
    const list = data.expedientes || [];
    const listos = list.filter((e) => e.listo_radicacion).length;
    const summaryWrap = panel.querySelector('#sopArmDiaSummaryWrap');
    if (summaryWrap) {
      summaryWrap.innerHTML = htmlArmadoSummaryChips({
        total: list.length,
        listos,
        pendientes: list.length - listos
      });
      sopIcons(summaryWrap);
    }
    const tbody = $('sopArmExpedientesBody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="sop-empty" style="padding:20px">Sin expedientes — cree el primero FE</td></tr>';
    } else {
      tbody.innerHTML = list.map((e) => `<tr>
            <td><strong>${escapeHtml(e.codigo)}</strong></td>
            <td>${escapeHtml(e.paciente_nombre)}</td>
            <td><span class="sop-badge sop-badge-archivo" style="margin:0">${escapeHtml(e.tipo_servicio)}</span></td>
            <td>${badgeEstadoFe(e.listo_radicacion)}</td>
            <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-id="${e.id}"><i data-lucide="folder-open"></i> Abrir</button></td>
          </tr>`).join('');
    }
    panel.querySelector('#btnSopArmNuevoFe')?.addEventListener('click', modalNuevoExpediente);
    panel.querySelectorAll('[data-exp-id]').forEach((b) => {
      b.addEventListener('click', () => abrirExpedienteArmado(parseInt(b.dataset.expId, 10)));
    });
    sopIcons(panel);
    renderArmadoContextBar();
  }

  async function abrirExpedienteArmado(id) {
    armState.expedienteId = id;
    armState.vista = 'expediente';
    const res = await apiFetch(`/api/soportes/armado/expedientes/${id}`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error, 'error'); return; }
    const e = data.expediente;
    armState.expedienteCodigo = e.codigo || `FE-${id}`;
    const slots = e.slots || {};
    const slotHtml = (key, slot) => {
      const ok = slot.completo;
      const dis = slot.habilitado === false;
      const slotIcon = { OPF: 'file-text', CRC: 'clipboard-list', FEV: 'external-link', PDX: 'file-output', HEV: 'stethoscope' }[key] || 'file';
      return `<div class="sop-slot-card ${ok ? 'ok' : ''} ${dis ? 'disabled' : ''}" data-slot="${key}">
        <div class="sop-slot-head">
          <span class="sop-slot-label"><i data-lucide="${slotIcon}" style="width:16px;height:16px;vertical-align:-2px"></i> ${key}</span>
          <span class="sop-slot-status" title="${ok ? 'Completo' : 'Pendiente'}"></span>
        </div>
        <div class="sop-slot-file">${ok ? escapeHtml(slot.nombre_archivo || (key === 'FEV' ? 'Verificada externa' : 'Cargado')) : 'Pendiente de carga'}</div>
        ${!dis && key !== 'FEV' && sopPerm('soportes.armado.subir') ? `<label class="sop-btn sop-btn-ghost sop-btn-sm" style="margin-top:auto;cursor:pointer"><i data-lucide="upload"></i> Subir<input type="file" data-upload-slot="${key}" class="sop-file-input-hidden" accept=".pdf"></label>` : ''}
        ${key === 'PDX' && !dis && sopPerm('soportes.armado.importar_pdx') ? '<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="btnSopImportPdx"><i data-lucide="link-2"></i> PDX</button>' : ''}
      </div>`;
    };
    const panel = $('sopArmExpedientePanel');
    panel.innerHTML = `
      <div class="sop-panel-head">
        <div>
          <h3 style="margin:0">${escapeHtml(e.codigo)}</h3>
          <div style="font-size:.85rem;color:#64748b;margin-top:4px">${escapeHtml(e.paciente_nombre)}</div>
        </div>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverDia"><i data-lucide="arrow-left"></i> Día</button>
        ${sopPerm('soportes.descargar_zip') ? `<a class="sop-btn sop-btn-teal sop-btn-sm" href="/api/soportes/armado/expedientes/${id}/zip" target="_blank"><i data-lucide="archive"></i> ZIP</a>` : ''}
      </div>
      <div class="sop-panel-body">
        ${htmlExpedienteProgress(e, slots)}
        <div class="sop-flags">
          <label class="sop-toggle"><input type="checkbox" id="sopFevCheck" ${e.fev_externa_verificada ? 'checked' : ''}> FEV verificada (externo)</label>
          <label class="sop-toggle"><input type="checkbox" id="sopListoCheck" ${e.listo_radicacion ? 'checked' : ''}> Listo para radicación</label>
        </div>
        <p class="sop-slot-flow-hint" style="font-size:.78rem;color:#94a3b8;margin:0 0 8px">Orden sugerido: OPF → CRC → FEV → PDX o HEV</p>
        <div class="sop-slots">
          ${slotHtml('OPF', slots.OPF)}
          ${slotHtml('CRC', slots.CRC)}
          ${slotHtml('FEV', slots.FEV)}
          ${slotHtml('PDX', slots.PDX)}
          ${slotHtml('HEV', slots.HEV)}
        </div>
      </div>`;
    panel.querySelector('#btnSopArmVolverDia')?.addEventListener('click', () => seleccionarDiaArmado(armState.diaId));
    const saveFlags = async () => {
      await apiFetch(`/api/soportes/armado/expedientes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fev_externa_verificada: $('sopFevCheck').checked,
          listo_radicacion: $('sopListoCheck').checked
        })
      });
      abrirExpedienteArmado(id);
    };
    $('sopFevCheck')?.addEventListener('change', saveFlags);
    $('sopListoCheck')?.addEventListener('change', saveFlags);
    panel.querySelectorAll('[data-upload-slot]').forEach((inp) => {
      inp.addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        const tipo = ev.target.dataset.uploadSlot;
        const fd = new FormData();
        fd.append('file', f);
        const r = await apiFetch(`/api/soportes/armado/expedientes/${id}/archivos/${tipo}`, { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok) sopToast(d.error || 'Error', 'error');
        else { sopToast(`${tipo} cargado`, 'success'); abrirExpedienteArmado(id); }
        ev.target.value = '';
      });
    });
    $('btnSopImportPdx')?.addEventListener('click', () => modalImportPdxEnExpediente(id));
    sopIcons(panel);
    renderArmadoContextBar();
  }

  function modalImportPdxEnExpediente(expId) {
    let selectedId = null;
    let searchTimer = null;
    const modal = openSopModal(`
      <h3><i data-lucide="file-output" style="vertical-align:-3px;width:22px"></i> Importar desde depósito PDX</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Busque al paciente y seleccione el reporte a copiar al slot PDX.</p>
      <div class="sop-field">
        <label>Paciente</label>
        <div class="sop-search-wrap" style="max-width:none">
          <i data-lucide="search"></i>
          <input type="search" id="sopImpPdxBuscar" class="sop-search" placeholder="Mínimo 2 caracteres…" autocomplete="off">
        </div>
      </div>
      <div id="sopImpPdxResults" class="sop-import-results">
        <div class="sop-empty" style="padding:20px;font-size:.85rem">Escriba para buscar en el depósito PDX</div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopImpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopImpOk" disabled>Importar seleccionado</button>
      </div>`);
    const resultsEl = modal.querySelector('#sopImpPdxResults');
    const btnOk = modal.querySelector('#sopImpOk');
    const input = modal.querySelector('#sopImpPdxBuscar');

    function renderImportResults(list) {
      if (!list?.length) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px;font-size:.85rem">Sin resultados</div>';
        selectedId = null;
        btnOk.disabled = true;
        return;
      }
      resultsEl.innerHTML = list.map((r) => `
        <div class="sop-import-item${selectedId === r.archivo_id ? ' selected' : ''}" data-pdx-archivo="${r.archivo_id}">
          <div>
            <strong>${escapeHtml(r.paciente_nombre)}</strong>
            <div class="sop-import-item-meta">${escapeHtml(r.fecha_estudio || '—')} · ${escapeHtml(r.estudio_texto || '—')}</div>
            <div class="sop-import-item-meta">${escapeHtml(r.carpeta_nombre)} (${escapeHtml(r.periodo)})</div>
          </div>
          <i data-lucide="file-text" style="width:18px;height:18px;color:#94a3b8;flex-shrink:0"></i>
        </div>`).join('');
      resultsEl.querySelectorAll('.sop-import-item').forEach((row) => {
        row.addEventListener('click', () => {
          selectedId = parseInt(row.dataset.pdxArchivo, 10);
          resultsEl.querySelectorAll('.sop-import-item').forEach((el) => el.classList.toggle('selected', parseInt(el.dataset.pdxArchivo, 10) === selectedId));
          btnOk.disabled = !selectedId;
        });
      });
      sopIcons(resultsEl);
    }

    async function runImportSearch() {
      const q = input.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px;font-size:.85rem">Escriba al menos 2 caracteres</div>';
        selectedId = null;
        btnOk.disabled = true;
        return;
      }
      resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px"><i data-lucide="loader" class="sop-empty-icon"></i> Buscando…</div>';
      sopIcons(resultsEl);
      try {
        const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderImportResults(data.resultados || []);
      } catch (e) {
        resultsEl.innerHTML = `<div class="sop-empty" style="padding:20px;color:#dc2626">${escapeHtml(e.message)}</div>`;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runImportSearch, 320);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runImportSearch(); } });

    modal.querySelector('#sopImpCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      if (!selectedId) return sopToast('Seleccione un archivo PDX', 'warning');
      btnOk.disabled = true;
      const r = await apiFetch(`/api/soportes/armado/expedientes/${expId}/importar-pdx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdx_archivo_id: selectedId })
      });
      const d = await r.json();
      btnOk.disabled = false;
      if (!r.ok) { sopToast(d.error, 'error'); return; }
      if (d.warnings?.length) sopToast(d.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('PDX importado', 'success');
      abrirExpedienteArmado(expId);
    };
    input.focus();
  }

  function modalNuevoExpediente() {
    if (!armState.diaId) return;
    const modal = openSopModal(`
      <h3><i data-lucide="file-plus"></i> Nuevo expediente FE</h3>
      <div class="sop-field"><label>Paciente</label><input id="sopFePac" placeholder="Apellidos, Nombres"></div>
      <div class="sop-field"><label>Documento</label><input id="sopFeDoc"></div>
      <div class="sop-field"><label>Tipo de servicio</label>
        <select id="sopFeTipo"><option value="electro">Electrodiagnóstico</option><option value="consulta">Consulta</option></select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopFeCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopFeSiguiente">Crear (siguiente FE)</button>
      </div>`);
    modal.querySelector('#sopFeCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopFeSiguiente').onclick = async () => {
      const body = {
        paciente_nombre: $('sopFePac').value.trim(),
        paciente_documento: $('sopFeDoc').value.trim() || null,
        tipo_servicio: $('sopFeTipo').value
      };
      if (!body.paciente_nombre) return sopToast('Nombre del paciente requerido', 'warning');
      const res = await apiFetch(`/api/soportes/armado/dias/${armState.diaId}/expedientes/siguiente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast(`Expediente ${data.expediente.codigo} creado`, 'success');
      seleccionarDiaArmado(armState.diaId);
      abrirExpedienteArmado(data.expediente.id);
    };
  }

  function modalNuevoPeriodoArmado() {
    const per = periodoActual();
    const modal = openSopModal(`
      <h3>Nuevo periodo de armado</h3>
      <div class="sop-field"><label>Periodo</label><input type="month" id="sopArmNewPer" value="${per}"></div>
      <div class="sop-field"><label>Etiqueta visible</label><input id="sopArmNewEti" placeholder="MARZO 2026"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmPerCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmPerOk">Crear</button>
      </div>`);
    modal.querySelector('#sopArmPerCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmPerOk').onclick = async () => {
      const periodo = $('sopArmNewPer').value;
      const etiqueta = $('sopArmNewEti').value.trim() || periodo;
      const res = await apiFetch('/api/soportes/armado/periodos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, etiqueta })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Periodo creado', 'success');
      await cargarPeriodosArmado();
      renderPeriodosArmado();
      if (data.periodo?.id) seleccionarPeriodoArmado(data.periodo.id);
    };
  }

  function modalNuevoDiaArmado() {
    if (!armState.periodoId) return sopToast('Seleccione un periodo primero', 'warning');
    const modal = openSopModal(`
      <h3>Añadir día al periodo</h3>
      <div class="sop-field"><label>Día del mes (1–31)</label><input type="number" min="1" max="31" id="sopArmDiaNum"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmDiaCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmDiaOk">Añadir</button>
      </div>`);
    modal.querySelector('#sopArmDiaCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmDiaOk').onclick = async () => {
      const dia = parseInt($('sopArmDiaNum').value, 10);
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dia })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Día añadido', 'success');
      seleccionarPeriodoArmado(armState.periodoId);
    };
  }

  window.initArmadoSoportes = function initArmadoSoportes() {
    sopIcons($('view-armado-soportes'));
    sopAnimateModuleIn('view-armado-soportes');
    if (initArmadoDone) {
      cargarPeriodosArmado().then(renderPeriodosArmado).catch(console.error);
      return;
    }
    initArmadoDone = true;
    $('btnVolverArmadoSoportes')?.addEventListener('click', () => {
      sopArmNavOpen(false);
      goToMenu();
    });
    $('btnSopArmToggleNav')?.addEventListener('click', () => {
      const layout = $('sopArmLayout');
      sopArmNavOpen(!layout?.classList.contains('sop-nav-open'));
    });
    $('sopArmNavBackdrop')?.addEventListener('click', () => sopArmNavOpen(false));
    $('btnSopArmNuevoPeriodo')?.addEventListener('click', modalNuevoPeriodoArmado);
    $('btnSopArmNuevoDia')?.addEventListener('click', modalNuevoDiaArmado);
    $('sopArmIncluirArchivo')?.addEventListener('change', () => {
      armState.periodoId = null;
      armState.diaId = null;
      $('sopArmDias').innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Seleccione un periodo</div>';
      renderArmadoPlaceholder('Seleccione un periodo y un día');
      cargarPeriodosArmado().then(renderPeriodosArmado);
    });
    renderArmadoContextBar();
    cargarPeriodosArmado().then(renderPeriodosArmado).catch((e) => sopToast(e.message, 'error'));
  };
})();
