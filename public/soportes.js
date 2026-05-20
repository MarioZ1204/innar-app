/**
 * Módulos Reportes PDX y Armado de soportes — UI moderna (Lucide + design system sop-*)
 */
(function () {
  'use strict';

  let initPdxDone = false;
  let initArmadoDone = false;
  let pdxState = { carpetas: [], carpetaId: null, archivos: [], periodoActual: null };
  let armState = { periodos: [], periodoId: null, dias: [], diaId: null, expedienteId: null };

  const TEMA_ICON = {
    vtm: 'video',
    psg: 'moon',
    eeg: 'activity',
    actigrafia: 'watch',
    neutral: 'folder'
  };

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

  function openSopModal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'sop-dialog-backdrop';
    wrap.innerHTML = `<div class="sop-dialog" role="dialog">${html}</div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    sopIcons(wrap);
    return wrap;
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
      for (const f of e.dataTransfer.files) {
        if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          try { await subirArchivoPdx(f, pdxState.carpetaId); } catch (err) { sopToast(err.message, 'error'); }
        }
      }
      abrirCarpetaPdx(pdxState.carpetaId);
    });
  }

  // ─── Reportes PDX ─────────────────────────────────────────────────────────

  async function cargarCarpetasPdx(incluirArchivo) {
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
    return data;
  }

  function renderListaCarpetasPdx() {
    const el = $('sopPdxLista');
    if (!el) return;
    if (!pdxState.carpetas.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="folder-open" class="sop-empty-icon"></i>No hay carpetas.<br><span style="font-size:.85rem">Use «Nueva carpeta» para comenzar.</span></div>`;
      sopIcons(el);
      return;
    }
    el.innerHTML = `<div class="sop-grid">${pdxState.carpetas.map((c) => {
      const tema = c.color_tema || 'neutral';
      const icon = TEMA_ICON[tema] || 'folder';
      return `<article class="sop-folder-card" data-tema="${escapeHtml(tema)}" data-pdx-carpeta="${c.id}">
        <div class="sop-folder-icon"><i data-lucide="${icon}"></i></div>
        <div class="sop-folder-title">${escapeHtml(c.nombre_display)}</div>
        <div class="sop-folder-meta">${escapeHtml(c.periodo)} · ${c.archivos_count || 0} archivo(s)</div>
        ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}
      </article>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-pdx-carpeta]').forEach((card) => {
      card.addEventListener('click', () => abrirCarpetaPdx(parseInt(card.dataset.pdxCarpeta, 10)));
    });
    sopIcons(el);
  }

  async function abrirCarpetaPdx(id) {
    pdxState.carpetaId = id;
    $('sopPdxVistaLista')?.classList.add('hidden');
    $('sopPdxVistaDetalle')?.classList.remove('hidden');
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${id}/archivos`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    pdxState.archivos = data.archivos || [];
    const c = data.carpeta;
    $('sopPdxDetalleTitulo').textContent = c.nombre_display;
    $('sopPdxDetalleMeta').innerHTML = `${escapeHtml(c.periodo)} ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}`;
    sopIcons($('sopPdxDetalleMeta'));
    const tbody = $('sopPdxArchivosBody');
    if (!pdxState.archivos.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="sop-empty" style="padding:24px">Sin archivos en esta carpeta</td></tr>';
      return;
    }
    tbody.innerHTML = pdxState.archivos.map((a) => `<tr>
      <td><strong>${escapeHtml(a.paciente_nombre)}</strong></td>
      <td>${escapeHtml(a.fecha_estudio || '—')}</td>
      <td>${escapeHtml(a.estudio_texto || '—')}</td>
      <td style="white-space:nowrap">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-dl="${a.id}"><i data-lucide="download"></i></button>
        ${sopPerm('soportes.armado.importar_pdx') ? `<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" data-pdx-link="${a.id}" title="Vincular FE"><i data-lucide="link-2"></i></button>` : ''}
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('[data-pdx-dl]').forEach((b) => {
      b.addEventListener('click', () => window.open(`/api/soportes/pdx/archivos/${b.dataset.pdxDl}/descargar`, '_blank'));
    });
    tbody.querySelectorAll('[data-pdx-link]').forEach((b) => {
      b.addEventListener('click', () => modalVincularPdx(parseInt(b.dataset.pdxLink, 10)));
    });
    sopIcons($('sopPdxVistaDetalle'));
  }

  function volverListaPdx() {
    pdxState.carpetaId = null;
    $('sopPdxVistaDetalle')?.classList.add('hidden');
    $('sopPdxVistaLista')?.classList.remove('hidden');
    cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked).then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
    sopIcons($('view-reportes-pdx'));
  }

  function modalNuevaCarpetaPdx() {
    const per = periodoActual();
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus" style="vertical-align:-3px;width:22px"></i> Nueva carpeta PDX</h3>
      <div class="sop-field"><label>Periodo</label><input type="month" id="sopPdxNewPeriodo" value="${per}"></div>
      <div class="sop-field"><label>Nombre de carpeta</label>
        <input type="text" id="sopPdxNewNombre" placeholder="REPORTES MES MARZO VTM"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxNewCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxNewOk">Crear carpeta</button>
      </div>`);
    modal.querySelector('#sopPdxNewCancel').onclick = () => modal.remove();
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
      modal.remove();
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
    if (!res.ok) {
      if (data.requiere_confirmacion) return modalConfirmarNombrePdx(file, carpetaId);
      throw new Error(data.error || 'Error al subir');
    }
    if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
    return data;
  }

  function modalConfirmarNombrePdx(file, carpetaId) {
    const modal = openSopModal(`
      <h3>Confirmar datos del archivo</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 16px">No se pudo leer el nombre automáticamente.</p>
      <div class="sop-field"><label>Apellidos</label><input id="sopPdxConfApe"></div>
      <div class="sop-field"><label>Nombres</label><input id="sopPdxConfNom"></div>
      <div class="sop-field"><label>Fecha estudio</label><input type="date" id="sopPdxConfFecha"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxConfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxConfOk">Subir</button>
      </div>`);
    modal.querySelector('#sopPdxConfCancel').onclick = () => modal.remove();
    modal.querySelector('#sopPdxConfOk').onclick = async () => {
      try {
        await subirArchivoPdx(file, carpetaId, {
          apellidos: $('sopPdxConfApe').value.trim(),
          nombres: $('sopPdxConfNom').value.trim(),
          fecha_estudio: $('sopPdxConfFecha').value
        });
        modal.remove();
        sopToast('Archivo subido', 'success');
        abrirCarpetaPdx(carpetaId);
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  async function buscarPdx() {
    const q = $('sopPdxBuscar')?.value?.trim();
    if (!q || q.length < 2) { sopToast('Escriba al menos 2 caracteres', 'warning'); return; }
    const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const el = $('sopPdxResultados');
    if (!data.resultados?.length) {
      el.innerHTML = '<div class="sop-empty" style="padding:20px">Sin resultados</div>';
      el.classList.remove('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-table-wrap"><table class="sop-table"><thead><tr>
      <th>Paciente</th><th>Fecha</th><th>Carpeta</th><th></th></tr></thead><tbody>
      ${data.resultados.map((r) => `<tr>
        <td>${escapeHtml(r.paciente_nombre)}</td>
        <td>${escapeHtml(r.fecha_estudio || '')}</td>
        <td>${escapeHtml(r.carpeta_nombre)} <span style="color:#94a3b8">(${escapeHtml(r.periodo)})</span></td>
        <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-open-carpeta="${r.carpeta_id}"><i data-lucide="folder-open"></i> Abrir</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
    el.querySelectorAll('[data-open-carpeta]').forEach((b) => {
      b.addEventListener('click', () => { el.classList.add('hidden'); abrirCarpetaPdx(parseInt(b.dataset.openCarpeta, 10)); });
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
    modal.querySelector('#sopLinkCancel').onclick = () => modal.remove();
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
      modal.remove();
      sopToast('PDX vinculado al expediente', 'success');
    };
  }

  window.initReportesPdx = function initReportesPdx() {
    sopIcons($('view-reportes-pdx'));
    if (initPdxDone) {
      cargarCarpetasPdx($('sopPdxIncluirArchivo')?.checked).then(renderListaCarpetasPdx).catch(console.error);
      return;
    }
    initPdxDone = true;
    $('btnVolverReportesPdx')?.addEventListener('click', goToMenu);
    $('btnSopPdxNuevaCarpeta')?.addEventListener('click', modalNuevaCarpetaPdx);
    $('btnSopPdxVolver')?.addEventListener('click', volverListaPdx);
    $('btnSopPdxBuscar')?.addEventListener('click', buscarPdx);
    $('sopPdxBuscar')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarPdx(); });
    $('sopPdxIncluirArchivo')?.addEventListener('change', () => {
      cargarCarpetasPdx($('sopPdxIncluirArchivo').checked).then(renderListaCarpetasPdx);
    });
    $('sopPdxUploadInput')?.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files?.length || !pdxState.carpetaId) return;
      for (const f of files) {
        try { await subirArchivoPdx(f, pdxState.carpetaId); } catch (err) { sopToast(err.message, 'error'); }
      }
      e.target.value = '';
      abrirCarpetaPdx(pdxState.carpetaId);
    });
    setupDropzone();
    cargarCarpetasPdx(false).then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
  };

  // ─── Armado de soportes ───────────────────────────────────────────────────

  async function cargarPeriodosArmado() {
    const res = await apiFetch('/api/soportes/armado/periodos');
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
    armState.expedienteId = null;
    renderPeriodosArmado();
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
    renderArmadoPlaceholder('Seleccione un día del mes');
  }

  function renderArmadoPlaceholder(msg) {
    $('sopArmExpedientePanel').innerHTML = `<div class="sop-panel-body"><div class="sop-empty">
      <i data-lucide="layers" class="sop-empty-icon"></i>${escapeHtml(msg)}</div></div>`;
    sopIcons($('sopArmExpedientePanel'));
  }

  async function seleccionarDiaArmado(id) {
    armState.diaId = id;
    armState.expedienteId = null;
    document.querySelectorAll('#sopArmDias .sop-nav-item').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.diaId, 10) === id);
    });
    const res = await apiFetch(`/api/soportes/armado/dias/${id}/expedientes`);
    const data = await res.json();
    const list = data.expedientes || [];
    const panel = $('sopArmExpedientePanel');
    panel.innerHTML = `
      <div class="sop-panel-head">
        <h3><i data-lucide="file-stack"></i> Expedientes del día</h3>
        ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-teal" id="btnSopArmNuevoFe"><i data-lucide="plus"></i> Añadir FE</button>` : ''}
      </div>
      <div class="sop-panel-body">
        <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
          <th>FE</th><th>Paciente</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>${list.length ? list.map((e) => `<tr>
            <td><strong>${escapeHtml(e.codigo)}</strong></td>
            <td>${escapeHtml(e.paciente_nombre)}</td>
            <td><span class="sop-badge sop-badge-archivo" style="margin:0">${escapeHtml(e.tipo_servicio)}</span></td>
            <td>${e.listo_radicacion ? '<span style="color:#16a34a">Listo</span>' : '<span style="color:#94a3b8">Pendiente</span>'}</td>
            <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-id="${e.id}"><i data-lucide="folder-open"></i> Abrir</button></td>
          </tr>`).join('') : '<tr><td colspan="5" class="sop-empty" style="padding:20px">Sin expedientes — cree el primero FE</td></tr>'}
        </tbody></table></div>
      </div>`;
    panel.querySelector('#btnSopArmNuevoFe')?.addEventListener('click', modalNuevoExpediente);
    panel.querySelectorAll('[data-exp-id]').forEach((b) => {
      b.addEventListener('click', () => abrirExpedienteArmado(parseInt(b.dataset.expId, 10)));
    });
    sopIcons(panel);
  }

  async function abrirExpedienteArmado(id) {
    armState.expedienteId = id;
    const res = await apiFetch(`/api/soportes/armado/expedientes/${id}`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error, 'error'); return; }
    const e = data.expediente;
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
        <div class="sop-flags">
          <label class="sop-toggle"><input type="checkbox" id="sopFevCheck" ${e.fev_externa_verificada ? 'checked' : ''}> FEV verificada (externo)</label>
          <label class="sop-toggle"><input type="checkbox" id="sopListoCheck" ${e.listo_radicacion ? 'checked' : ''}> Listo para radicación</label>
        </div>
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
  }

  function modalImportPdxEnExpediente(expId) {
    const modal = openSopModal(`
      <h3>Importar desde depósito PDX</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">ID del archivo (visible en Reportes PDX → carpeta → acción vincular)</p>
      <div class="sop-field"><label>ID archivo PDX</label><input type="number" id="sopPdxIdImport" min="1" placeholder="ej. 12"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopImpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopImpOk">Importar</button>
      </div>`);
    modal.querySelector('#sopImpCancel').onclick = () => modal.remove();
    modal.querySelector('#sopImpOk').onclick = async () => {
      const pdxId = parseInt($('sopPdxIdImport').value, 10);
      if (!pdxId) return sopToast('Ingrese el ID', 'warning');
      const r = await apiFetch(`/api/soportes/armado/expedientes/${expId}/importar-pdx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdx_archivo_id: pdxId })
      });
      const d = await r.json();
      if (!r.ok) { sopToast(d.error, 'error'); return; }
      if (d.warnings?.length) sopToast(d.warnings.join(' · '), 'warning');
      modal.remove();
      sopToast('PDX importado', 'success');
      abrirExpedienteArmado(expId);
    };
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
    modal.querySelector('#sopFeCancel').onclick = () => modal.remove();
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
      modal.remove();
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
    modal.querySelector('#sopArmPerCancel').onclick = () => modal.remove();
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
      modal.remove();
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
    modal.querySelector('#sopArmDiaCancel').onclick = () => modal.remove();
    modal.querySelector('#sopArmDiaOk').onclick = async () => {
      const dia = parseInt($('sopArmDiaNum').value, 10);
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dia })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      modal.remove();
      sopToast('Día añadido', 'success');
      seleccionarPeriodoArmado(armState.periodoId);
    };
  }

  window.initArmadoSoportes = function initArmadoSoportes() {
    sopIcons($('view-armado-soportes'));
    if (initArmadoDone) {
      cargarPeriodosArmado().then(renderPeriodosArmado).catch(console.error);
      return;
    }
    initArmadoDone = true;
    $('btnVolverArmadoSoportes')?.addEventListener('click', goToMenu);
    $('btnSopArmNuevoPeriodo')?.addEventListener('click', modalNuevoPeriodoArmado);
    $('btnSopArmNuevoDia')?.addEventListener('click', modalNuevoDiaArmado);
    $('sopArmIncluirArchivo')?.addEventListener('change', () => {
      cargarPeriodosArmado().then(renderPeriodosArmado);
    });
    cargarPeriodosArmado().then(renderPeriodosArmado).catch((e) => sopToast(e.message, 'error'));
  };
})();
