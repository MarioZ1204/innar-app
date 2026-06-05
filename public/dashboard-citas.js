// Auditoría de citas — fuente legible (copiar a public/dashboard-citas.js)
let dashboardCitasActuales = [];
let dashboardFetchInFlight = false;
let dashboardFetchPending = false;
let dashboardFetchTimer = null;
let dashboardTipoCitaChangeHandler = null;

function scheduleBuscarCitasAuditoria(delayMs = 120) {
  if (dashboardFetchTimer) clearTimeout(dashboardFetchTimer);
  dashboardFetchTimer = setTimeout(() => {
    dashboardFetchTimer = null;
    buscarCitasAuditoria();
  }, delayMs);
}

function getDashboardMedicoIds() {
  const medicoSel = document.getElementById('dashboardMedico');
  if (!medicoSel) return [];
  const raw = typeof window.getMultiSelectValue === 'function'
    ? window.getMultiSelectValue(medicoSel)
    : (medicoSel.value || '');
  return raw ? String(raw).split(',').map((v) => v.trim()).filter(Boolean) : [];
}

/** Contexto actual de médico / especialidad para filtros dependientes */
function getDashboardFiltrosContext() {
  const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
  const medicoIds = getDashboardMedicoIds();
  const medicoId = medicoIds.length === 1 ? medicoIds[0] : (medicoIds.length > 1 ? medicoIds.join(',') : '');
  const espSel = document.getElementById('dashboardEspecialidad');
  let especialidadId = espSel?.value || '';

  if (!especialidadId && medicoIds.length === 1) {
    const medicoSel = document.getElementById('dashboardMedico');
    const opt = medicoSel?.options[medicoSel.selectedIndex];
    especialidadId = opt?.dataset?.especialidadId || '';
  }
  if (!especialidadId && medicoIds.length > 1) {
    const medicoSel = document.getElementById('dashboardMedico');
    const espSet = new Set();
    medicoIds.forEach((id) => {
      const opt = medicoSel?.querySelector(`option[value="${CSS.escape(id)}"]`);
      if (opt?.dataset?.especialidadId) espSet.add(opt.dataset.especialidadId);
    });
    if (espSet.size === 1) especialidadId = [...espSet][0];
  }

  return { tipoCita, medicoId, medicoIds, especialidadId };
}

function recargarFiltrosTipoDashboard() {
  const { medicoId, especialidadId } = getDashboardFiltrosContext();
  return Promise.all([
    cargarTipoConsultaFiltro(medicoId, especialidadId),
    cargarTipoEstudioFiltro()
  ]);
}

function initDashboardMedicoMultiSelect() {
  const sel = document.getElementById('dashboardMedico');
  if (!sel || typeof window.initMultiSelect !== 'function') return;

  if (!sel._ms) {
    window.initMultiSelect(sel, {
      placeholder: 'Todos los médicos',
      onChange: onDashboardMedicoChange
    });
    if (typeof window.observeSelectForMulti === 'function') window.observeSelectForMulti(sel);
  } else {
    sel._ms.refresh();
  }
}

function onDashboardMedicoChange(vals) {
  const medicoSel = document.getElementById('dashboardMedico');
  const selEsp = document.getElementById('dashboardEspecialidad');
  const ids = Array.isArray(vals) ? vals : getDashboardMedicoIds();

  if (selEsp && medicoSel && ids.length > 0) {
    const espSet = new Set();
    ids.forEach((id) => {
      const opt = medicoSel.querySelector(`option[value="${CSS.escape(String(id))}"]`);
      if (opt?.dataset?.especialidadId) espSet.add(opt.dataset.especialidadId);
    });
    if (espSet.size === 1) selEsp.value = [...espSet][0];
    else if (espSet.size > 1) selEsp.value = '';
  } else if (selEsp && ids.length === 0) {
    selEsp.value = '';
  }

  const medicoParam = ids.length > 1 ? ids.join(',') : (ids[0] || '');
  const espId = selEsp?.value || '';
  cargarTipoConsultaFiltro(medicoParam, espId);
}

function initDashboardCitas() {
  try {
    const btnBuscar = document.getElementById('btnBuscarCitas');
    const btnLimpiar = document.getElementById('btnLimpiarFiltrosDashboard');

    if (btnBuscar) {
      const clone = btnBuscar.cloneNode(true);
      btnBuscar.parentNode.replaceChild(clone, btnBuscar);
      document.getElementById('btnBuscarCitas').addEventListener('click', buscarCitasAuditoria);
    }
    if (btnLimpiar) {
      const clone = btnLimpiar.cloneNode(true);
      btnLimpiar.parentNode.replaceChild(clone, btnLimpiar);
      document.getElementById('btnLimpiarFiltrosDashboard').addEventListener('click', limpiarFiltrosDashboard);
    }

    const selTipoCita = document.getElementById('dashboardTipoCita');
    if (selTipoCita) {
      if (dashboardTipoCitaChangeHandler) {
        selTipoCita.removeEventListener('change', dashboardTipoCitaChangeHandler);
      }
      dashboardTipoCitaChangeHandler = function () {
        actualizarVisibilidadFiltrosMedico(this.value);
        recargarFiltrosTipoDashboard();
      };
      selTipoCita.addEventListener('change', dashboardTipoCitaChangeHandler);
    }

    const selEsp = document.getElementById('dashboardEspecialidad');
    if (selEsp) {
      selEsp.addEventListener('change', function () {
        const espId = this.value;
        const selMed = document.getElementById('dashboardMedico');
        if (selMed && window._dashboardMedicos) {
          const prevVals = selMed._ms ? selMed._ms.getValues() : (selMed.value ? [selMed.value] : []);
          selMed.innerHTML = '<option value="">Todos los médicos</option>';
          window._dashboardMedicos
            .filter((m) => !espId || String(m.especialidad_id) === espId)
            .forEach((m) => {
              const opt = document.createElement('option');
              opt.value = m.id;
              opt.textContent = m.nombre;
              if (m.especialidad_id) opt.dataset.especialidadId = m.especialidad_id;
              selMed.appendChild(opt);
            });
          if (selMed._ms) {
            const valid = prevVals.filter((id) => selMed.querySelector(`option[value="${CSS.escape(String(id))}"]`));
            selMed._ms.setValues(valid);
          }
        }
        cargarTipoConsultaFiltro(
          getDashboardMedicoIds().join(',') || '',
          espId
        );
      });
    }

    cargarMedicosFiltro().then(() => initDashboardMedicoMultiSelect());
    cargarEspecialidadesFiltro();
    cargarEntidadesFiltroAuditoria();
    recargarFiltrosTipoDashboard();

    const hoy = new Date();
    const hace30 = new Date(hoy);
    hace30.setDate(hace30.getDate() - 30);
    const inpDesde = document.getElementById('dashboardFechaDesde');
    const inpHasta = document.getElementById('dashboardFechaHasta');
    if (inpDesde && !inpDesde.value) inpDesde.value = localDateStrDash(hace30);
    if (inpHasta && !inpHasta.value) inpHasta.value = localDateStrDash(hoy);

    scheduleBuscarCitasAuditoria(100);

    if (window.socket) {
      const eventos = [
        'turno:creado', 'turno:eliminado',
        'cita_electro:creada', 'cita_electro:eliminada',
        'agenda:turno-creado', 'agenda:turno-eliminado',
        'electro:cita-creada', 'electro:cita-eliminada'
      ];
      eventos.forEach((ev) => {
        window.socket.off(ev);
        window.socket.on(ev, () => scheduleBuscarCitasAuditoria(250));
      });
      window.socket.off('tipos-consulta:actualizado');
      window.socket.on('tipos-consulta:actualizado', () => {
        const { medicoId, especialidadId } = getDashboardFiltrosContext();
        cargarTipoConsultaFiltro(medicoId, especialidadId);
      });
    }
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error en inicialización:', e.message);
    if (typeof showToast === 'function') showToast('Error inicializando dashboard: ' + e.message, 'error');
  }
}

function actualizarVisibilidadFiltrosMedico(tipoCita) {
  const colMed = document.getElementById('dashboardMedicoCol');
  const colEsp = document.getElementById('dashboardEspecialidadCol');
  const colConsulta = document.getElementById('dashboardTipoConsultaCol');
  const colEstudio = document.getElementById('dashboardTipoEstudioCol');
  const selConsulta = document.getElementById('dashboardTipoConsulta');
  const selEstudio = document.getElementById('dashboardTipoEstudio');
  const esElectro = tipoCita === 'ELECTRODIAGNOSTICO';
  const esMedica = tipoCita === 'AGENDA_MEDICA';

  if (colMed) colMed.style.display = esElectro ? 'none' : '';
  if (colEsp) colEsp.style.display = esElectro ? 'none' : '';
  if (colConsulta) colConsulta.style.display = esElectro ? 'none' : '';
  if (colEstudio) colEstudio.style.display = esMedica ? 'none' : '';

  if (esElectro) {
    const selMed = document.getElementById('dashboardMedico');
    const selEsp = document.getElementById('dashboardEspecialidad');
    if (selMed && window.clearMultiSelect) window.clearMultiSelect(selMed);
    if (selEsp) selEsp.value = '';
    if (selConsulta && window.clearMultiSelect) window.clearMultiSelect(selConsulta);
  }
  if (esMedica && selEstudio && window.clearMultiSelect) {
    window.clearMultiSelect(selEstudio);
  }
}

async function cargarMedicosFiltro() {
  const sel = document.getElementById('dashboardMedico');
  if (!sel) return;
  try {
    const res = await apiFetch('/api/medicos');
    if (!res.ok) return;
    const data = await res.json();
    const prevVals = sel._ms ? sel._ms.getValues() : (sel.value ? [sel.value] : []);
    window._dashboardMedicos = Array.isArray(data) ? data : [];
    sel.innerHTML = '<option value="">Todos los médicos</option>';
    window._dashboardMedicos.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nombre;
      if (m.especialidad_id) opt.dataset.especialidadId = m.especialidad_id;
      sel.appendChild(opt);
    });
    if (sel._ms) {
      const valid = prevVals.filter((id) => sel.querySelector(`option[value="${CSS.escape(String(id))}"]`));
      sel._ms.setValues(valid);
      sel._ms.refresh();
    }
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar médicos:', e.message);
  }
}

async function cargarEspecialidadesFiltro() {
  const sel = document.getElementById('dashboardEspecialidad');
  if (!sel) return;
  try {
    const res = await apiFetch('/api/especialidades');
    if (!res.ok) return;
    const data = await res.json();
    const lista = Array.isArray(data) ? data : (data.registros || []);
    const prev = sel.value;
    sel.innerHTML = '<option value="">Todas las especialidades</option>';
    lista.filter((e) => e.activo !== 0).forEach((esp) => {
      const opt = document.createElement('option');
      opt.value = esp.id;
      opt.textContent = esp.nombre;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar especialidades:', e.message);
  }
}

async function fetchTiposConsultaDashboard(medicoId, especialidadId) {
  if (medicoId) {
    const res = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(medicoId)}`);
    return res.ok ? res.json() : [];
  }
  if (especialidadId) {
    const res = await apiFetch(`/api/tipos-consulta?especialidad_id=${encodeURIComponent(especialidadId)}`);
    return res.ok ? res.json() : [];
  }
  return null;
}

async function fetchEstudiosDashboard() {
  const res = await apiFetch('/api/estudios/lista');
  if (!res.ok) return [];
  const data = await res.json();
  const lista = Array.isArray(data) ? data : (data.registros || data.estudios || []);
  return lista.map((e) => ({ nombre: typeof e === 'string' ? e : e?.nombre })).filter((e) => e.nombre);
}

function appendOpcionesSelect(sel, items) {
  (Array.isArray(items) ? items : []).forEach((item) => {
    const nombre = typeof item === 'string' ? item : item?.nombre;
    if (!nombre) return;
    const opt = document.createElement('option');
    opt.value = nombre;
    opt.textContent = nombre;
    sel.appendChild(opt);
  });
}

function refreshDashboardSelectMulti(sel) {
  if (!sel) return;
  if (sel._ms) sel._ms.refresh();
  else {
    window.initMultiSelect(sel);
    window.observeSelectForMulti(sel);
  }
}

/** Tipos de consulta médica (agenda), según médico(s) o especialidad */
async function cargarTipoConsultaFiltro(medicoId, especialidadId) {
  const sel = document.getElementById('dashboardTipoConsulta');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';

  try {
    const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
    if (tipoCita === 'ELECTRODIAGNOSTICO') {
      refreshDashboardSelectMulti(sel);
      return;
    }

    let tipos = await fetchTiposConsultaDashboard(medicoId, especialidadId);
    if (tipos === null) {
      if (tipoCita === 'TODOS') {
        const res = await apiFetch('/api/tipos-consulta');
        tipos = res.ok ? res.json() : [];
      } else {
        const hint = document.createElement('option');
        hint.disabled = true;
        hint.textContent = 'Seleccione médico(s) o especialidad';
        sel.appendChild(hint);
        refreshDashboardSelectMulti(sel);
        return;
      }
    }
    appendOpcionesSelect(sel, tipos);

    if (prevVal) sel.value = prevVal;
    refreshDashboardSelectMulti(sel);
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar tipos de consulta:', e.message);
  }
}

/** Tipos de estudio de electrodiagnóstico (catálogo independiente) */
async function cargarTipoEstudioFiltro() {
  const sel = document.getElementById('dashboardTipoEstudio');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';

  try {
    const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
    if (tipoCita === 'AGENDA_MEDICA') {
      refreshDashboardSelectMulti(sel);
      return;
    }

    appendOpcionesSelect(sel, await fetchEstudiosDashboard());
    if (prevVal) sel.value = prevVal;
    refreshDashboardSelectMulti(sel);
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar tipos de estudio:', e.message);
  }
}

function buildDashboardAuditoriaParams() {
  const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
  const fechaDesde = document.getElementById('dashboardFechaDesde')?.value || '';
  const fechaHasta = document.getElementById('dashboardFechaHasta')?.value || '';
  const agendadoPor = (document.getElementById('dashboardAgendadoPor')?.value || '').trim();
  const medicoIds = getDashboardMedicoIds();
  const medicoId = medicoIds.length > 0 ? medicoIds.join(',') : '';
  const especialidadId = document.getElementById('dashboardEspecialidad')?.value || '';
  const estado = document.getElementById('dashboardEstado')?.value || '';
  const entidad = window.getMultiSelectValue(document.getElementById('dashboardEntidad'));
  const tipoConsulta = window.getMultiSelectValue(document.getElementById('dashboardTipoConsulta'));
  const tipoEstudio = window.getMultiSelectValue(document.getElementById('dashboardTipoEstudio'));

  const params = new URLSearchParams();
  if (tipoCita !== 'TODOS') params.append('tipo_cita', tipoCita);
  if (fechaDesde) params.append('fecha_desde', fechaDesde);
  if (fechaHasta) params.append('fecha_hasta', fechaHasta);
  if (agendadoPor) params.append('programado_por', agendadoPor);
  if (medicoId) params.append('doctor_id', medicoId);
  if (especialidadId) params.append('especialidad_id', especialidadId);
  if (estado) params.append('estado', estado);
  if (entidad) params.append('entidad', entidad);
  if (tipoConsulta) params.append('tipo_consulta', tipoConsulta);
  if (tipoEstudio) params.append('tipo_estudio', tipoEstudio);
  return params;
}

async function fetchCitasAuditoriaExport() {
  const res = await apiFetch(`/api/dashboard/citas-auditoria/export?${buildDashboardAuditoriaParams().toString()}`);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      goToMenu();
      return null;
    }
    throw new Error(`Error HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data || [];
}

async function buscarCitasAuditoria() {
  if (dashboardFetchInFlight) {
    dashboardFetchPending = true;
    return;
  }
  dashboardFetchInFlight = true;
  const btn = document.getElementById('btnBuscarCitas');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando…';
  }

  try {
    const res = await apiFetch(`/api/dashboard/citas-auditoria?${buildDashboardAuditoriaParams().toString()}`);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        goToMenu();
        return;
      }
      throw new Error(`Error HTTP ${res.status}`);
    }

    const json = await res.json();
    dashboardCitasActuales = json.data || [];
    if (json.resumen) actualizarResumenDashboard(json.resumen);
    renderizarTablaCitasAuditoria(dashboardCitasActuales);

    if (dashboardCitasActuales.length === 0 && typeof showToast === 'function') {
      showToast('No se encontraron citas con los filtros especificados', 'warning');
    }
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error cargando auditoría:', e.message);
    if (typeof showToast === 'function') showToast('Error al cargar citas: ' + e.message, 'error');
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (tbody) {
      const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => s;
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Error: ${esc(e.message)}</td></tr>`;
    }
  } finally {
    dashboardFetchInFlight = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Buscar';
    }
    if (dashboardFetchPending) {
      dashboardFetchPending = false;
      scheduleBuscarCitasAuditoria(200);
    }
  }
}

function actualizarResumenDashboard(resumen) {
  try {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? 0;
    };
    set('dashboardTotalCitas', resumen.total_citas);
    set('dashboardCitasMedicas', resumen.citas_medicas);
    set('dashboardCitasElectro', resumen.citas_electrodiagnostico);
    set('dashboardAtendidos', resumen.atendidos);
    set('dashboardNoAsistieron', resumen.no_asistieron);
    set('dashboardCancelados', resumen.cancelados);
    set('dashboardReprogramados', resumen.reprogramados);
    set('dashboardPendientes', resumen.pendientes);
    set('dashboardAgendadores', resumen.agendadores?.length ?? 0);
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error actualizando resumen:', e.message);
  }
}

function renderizarTablaCitasAuditoria(citas) {
  try {
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (!tbody) return;
    if (citas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">No hay citas que coincidan con los filtros</td></tr>';
      const controls = document.getElementById('tablaCitasAuditoriaControls');
      if (controls) controls.innerHTML = '';
      return;
    }
    setupPagination('citasAuditoria', citas, renderCitaAuditoriaRow, {
      itemsPerPageDefault: 25,
      tbodyId: 'bodyTablaAuditoria',
      containerSelector: '#tablaCitasAuditoriaControls'
    });
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error renderizando tabla:', e.message);
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (tbody) {
      const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => s;
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Error al renderizar tabla: ${esc(e.message)}</td></tr>`;
    }
  }
}

function renderCitaAuditoriaRow(tbody, cita) {
  try {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s || '');
    const tr = document.createElement('tr');
    const fecha = formatearFechaAuditoria(cita.fecha);
    const hora = (cita.hora || '').substring(0, 5) || '-';
    const medico = cita.medico_nombre || (cita.tipo_cita === 'ELECTRODIAGNOSTICO' ? '—' : '-');
    const paciente = esc(cita.paciente_nombre || '-') + ` <span style="color:#888;font-size:11px">(${esc(cita.paciente_documento || '-')})</span>`;
    const especialidad = cita.especialidad_nombre || '-';
    const tipo = cita.tipo_consulta || '-';
    const entidad = cita.entidad || '-';
    const tipoCitaLabel = cita.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro';
    const agendado = cita.programado_por || '-';
    const estado = cita.estado || '-';
    const { color, bg } = getEstadoStyle(estado);

    tr.innerHTML = `
      <td>${esc(fecha)}</td>
      <td style="white-space:nowrap">${esc(hora)}</td>
      <td style="font-weight:600;color:#374151">${esc(medico)}</td>
      <td>${paciente}</td>
      <td style="font-size:12px;color:#6b7280">${esc(especialidad)}</td>
      <td>${esc(tipo)}</td>
      <td>${esc(entidad)}</td>
      <td><span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#e0f2fe;color:#0369a1;font-weight:600">${esc(tipoCitaLabel)}</span></td>
      <td style="font-weight:600;color:#374151">${esc(agendado)}</td>
      <td><span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${bg};color:${color};font-weight:600;white-space:nowrap">${esc(estado)}</span></td>
    `;
    tbody.appendChild(tr);
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error renderizando fila:', e.message);
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="10" style="padding:8px;text-align:center;color:#dc2626">Error en fila</td>';
    tbody.appendChild(tr);
  }
}

function getEstadoStyle(estado) {
  const e = (estado || '').toLowerCase().trim();
  if (e === 'atendido' || e === 'completado') return { color: '#065f46', bg: '#d1fae5' };
  if (e === 'no_asistio' || e === 'no asistió') return { color: '#7f1d1d', bg: '#fee2e2' };
  if (e === 'cancelado' || e === 'cancelada') return { color: '#4b5563', bg: '#f3f4f6' };
  if (e === 'reprogramado' || e === 'reprogramada') return { color: '#78350f', bg: '#fef3c7' };
  if (e === 'pendiente' || e === 'programado') return { color: '#1e40af', bg: '#dbeafe' };
  if (e === 'en_sala' || e === 'en sala') return { color: '#4c1d95', bg: '#ede9fe' };
  if (e === 'en_atencion' || e === 'en atención' || e === 'en estudio') return { color: '#0c4a6e', bg: '#e0f2fe' };
  if (e === 'confirmado') return { color: '#14532d', bg: '#dcfce7' };
  return { color: '#374151', bg: '#f9fafb' };
}

function formatearFechaAuditoria(fecha) {
  if (!fecha) return '-';
  try {
    const str = typeof fecha === 'string' ? fecha : String(fecha);
    const partes = str.substring(0, 10).split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return str;
  } catch (_) {
    return String(fecha);
  }
}

function localDateStrDash(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function limpiarFiltrosDashboard() {
  try {
    ['dashboardEspecialidad', 'dashboardEstado', 'dashboardAgendadoPor'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    const selMed = document.getElementById('dashboardMedico');
    if (selMed && window.clearMultiSelect) window.clearMultiSelect(selMed);

    if (window._dashboardMedicos && selMed) {
      selMed.innerHTML = '<option value="">Todos los médicos</option>';
      window._dashboardMedicos.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre;
        if (m.especialidad_id) opt.dataset.especialidadId = m.especialidad_id;
        selMed.appendChild(opt);
      });
      if (selMed._ms) selMed._ms.refresh();
    }

    window.clearMultiSelect(document.getElementById('dashboardEntidad'));
    window.clearMultiSelect(document.getElementById('dashboardTipoConsulta'));
    window.clearMultiSelect(document.getElementById('dashboardTipoEstudio'));

    const selTipo = document.getElementById('dashboardTipoCita');
    if (selTipo) {
      selTipo.value = 'TODOS';
      actualizarVisibilidadFiltrosMedico('TODOS');
    }

    const hoy = new Date();
    const hace30 = new Date(hoy);
    hace30.setDate(hace30.getDate() - 30);
    const inpDesde = document.getElementById('dashboardFechaDesde');
    const inpHasta = document.getElementById('dashboardFechaHasta');
    if (inpDesde) inpDesde.value = localDateStrDash(hace30);
    if (inpHasta) inpHasta.value = localDateStrDash(hoy);

    recargarFiltrosTipoDashboard();
    setTimeout(buscarCitasAuditoria, 150);
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error limpiando filtros:', e.message);
    if (typeof showToast === 'function') showToast('Error limpiando filtros: ' + e.message, 'error');
  }
}

async function cargarEntidadesFiltroAuditoria({ force = false } = {}) {
  const sel = document.getElementById('dashboardEntidad');
  if (!sel) return;
  try {
    if (typeof cargarEntidadesEnSelect === 'function') {
      await cargarEntidadesEnSelect('dashboardEntidad', { placeholder: 'Todas', force: !!force });
    } else if (typeof fetchEntidadesDesdeBd === 'function') {
      const entidades = await fetchEntidadesDesdeBd({ force: !!force });
      sel.innerHTML = '<option value="">Todas</option>';
      (entidades || []).forEach((nombre) => {
        const opt = document.createElement('option');
        opt.value = nombre;
        opt.textContent = nombre;
        sel.appendChild(opt);
      });
    } else if (typeof fetchCatalogoEntidadesOpciones === 'function') {
      const { entidades } = await fetchCatalogoEntidadesOpciones({ force: !!force });
      sel.innerHTML = '<option value="">Todas</option>';
      (entidades || []).forEach((nombre) => {
        const opt = document.createElement('option');
        opt.value = nombre;
        opt.textContent = nombre;
        sel.appendChild(opt);
      });
    }
    if (sel._ms) sel._ms.refresh();
    else {
      window.initMultiSelect(sel);
      window.observeSelectForMulti(sel);
    }
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar entidades:', e.message);
  }
}

function valorReciboNumerico(c) {
  if (c.recibo_valor === '' || c.recibo_valor == null) return null;
  const n = Number(c.recibo_valor);
  return Number.isFinite(n) ? n : null;
}

function valorReciboAnuladoNumerico(c) {
  if (c.recibo_valor_anulado === '' || c.recibo_valor_anulado == null) return null;
  const n = Number(c.recibo_valor_anulado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function valoresReciboSeparados(c) {
  const anulado = valorReciboAnuladoNumerico(c);
  const activo = valorReciboNumerico(c);

  if (c.recibo_valor_anulado !== undefined) {
    return { activo, anulado };
  }

  if (activo == null) return { activo: null, anulado: null };
  if (c.recibo_estado === 'ANULADO') return { activo: null, anulado: activo };
  return { activo, anulado: null };
}

function mapFilaReporteAuditoria(c) {
  const { activo, anulado } = valoresReciboSeparados(c);
  return {
    Fecha: formatearFechaAuditoria(c.fecha),
    Hora: (c.hora || '').substring(0, 5) || '-',
    'Médico': c.medico_nombre || '-',
    Paciente: c.paciente_nombre || '-',
    Documento: c.paciente_documento || '-',
    Especialidad: c.especialidad_nombre || '-',
    'Tipo Consulta / Estudio': c.tipo_consulta || '-',
    Entidad: c.entidad || '-',
    'Tipo Cita': c.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro',
    'Agendado por': c.programado_por || '-',
    Estado: c.estado || '-',
    'Nº Recibo': c.recibo_numero || '',
    'Valor recibo': activo,
    'Valor anulado': anulado,
    'Estado recibo': c.recibo_estado || '',
    Observaciones: c.recibo_observaciones || ''
  };
}

/** M=Valor recibo (12), N=Valor anulado (13) — totales separados */
function aplicarFormatoYTotalExcelAuditoria(sheet, dataRowCount) {
  const VALOR_COL = 12;
  const VALOR_ANULADO_COL = 13;
  const ESTADO_CITA_COL = 10;
  const firstDataRowExcel = 2;
  const lastDataRowExcel = dataRowCount + 1;
  const totalRow0 = dataRowCount + 1;

  [VALOR_COL, VALOR_ANULADO_COL].forEach((col) => {
    for (let r = 1; r <= dataRowCount; r++) {
      const addr = window.XLSX.utils.encode_cell({ r, c: col });
      const cell = sheet[addr];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = '#,##0.00';
      }
    }
  });

  const labelAddr = window.XLSX.utils.encode_cell({ r: totalRow0, c: ESTADO_CITA_COL });
  const totalActivoAddr = window.XLSX.utils.encode_cell({ r: totalRow0, c: VALOR_COL });
  const totalAnuladoAddr = window.XLSX.utils.encode_cell({ r: totalRow0, c: VALOR_ANULADO_COL });
  const valorColLetter = window.XLSX.utils.encode_col(VALOR_COL);
  const valorAnuladoColLetter = window.XLSX.utils.encode_col(VALOR_ANULADO_COL);

  sheet[labelAddr] = { v: 'TOTAL', t: 's' };
  sheet[totalActivoAddr] = {
    f: `SUM(${valorColLetter}${firstDataRowExcel}:${valorColLetter}${lastDataRowExcel})`,
    t: 'n',
    z: '#,##0.00'
  };
  sheet[totalAnuladoAddr] = {
    f: `SUM(${valorAnuladoColLetter}${firstDataRowExcel}:${valorAnuladoColLetter}${lastDataRowExcel})`,
    t: 'n',
    z: '#,##0.00'
  };

  const range = window.XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  range.e.r = Math.max(range.e.r, totalRow0);
  sheet['!ref'] = window.XLSX.utils.encode_range(range);
}

async function exportarAuditoriaCitasExcel() {
  const btn = document.querySelector('#view-dashboard-citas #btnExportarExcel');
  try {
    if (!window.XLSX) {
      if (typeof showToast === 'function') showToast('Librería XLSX no disponible', 'error');
      return;
    }
    if (btn) btn.disabled = true;
    const citas = await fetchCitasAuditoriaExport();
    if (!citas) return;
    if (!citas.length) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar con los filtros actuales.', 'warning');
      return;
    }
    const rows = citas.map(mapFilaReporteAuditoria);
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    aplicarFormatoYTotalExcelAuditoria(sheet, rows.length);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 20 },
      { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 14 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 36 }
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, sheet, 'Auditoria');
    window.XLSX.writeFile(wb, `auditoria-citas-${localDateStrDash(new Date())}.xlsx`);
    if (typeof showToast === 'function') showToast('Exportación Excel completada', 'success');
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error exportando Excel:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function exportarAuditoriaCitasPDF() {
  const btn = document.querySelector('#view-dashboard-citas #btnExportarPDF');
  try {
    if (btn) btn.disabled = true;
    const citas = await fetchCitasAuditoriaExport();
    if (!citas) return;
    if (!citas.length) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar con los filtros actuales.', 'warning');
      return;
    }
    const esc = (s) => String(s || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtNum = (n) => {
      if (n == null || n === '') return '-';
      return '$ ' + Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    let totalActivo = 0;
    let totalAnulado = 0;
    const filas = citas.map((c) => {
      const { activo, anulado } = valoresReciboSeparados(c);
      if (activo != null) totalActivo += activo;
      if (anulado != null) totalAnulado += anulado;
      const estRec = c.recibo_estado || '-';
      const estStyle = estRec === 'ANULADO'
        ? 'color:#991b1b;font-weight:600'
        : estRec === 'PENDIENTE'
          ? 'color:#c2410c;font-weight:600'
          : estRec === 'PAGADO'
            ? 'color:#059669;font-weight:600'
            : '';
      return `<tr>
        <td>${formatearFechaAuditoria(c.fecha)}</td>
        <td>${esc((c.hora || '').substring(0, 5))}</td>
        <td>${esc(c.medico_nombre)}</td>
        <td>${esc(c.paciente_nombre)}</td>
        <td>${esc(c.paciente_documento)}</td>
        <td>${esc(c.especialidad_nombre)}</td>
        <td>${esc(c.tipo_consulta)}</td>
        <td>${esc(c.entidad)}</td>
        <td>${c.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro'}</td>
        <td>${esc(c.programado_por)}</td>
        <td>${esc(c.estado)}</td>
        <td>${esc(c.recibo_numero)}</td>
        <td style="text-align:right">${fmtNum(activo)}</td>
        <td style="text-align:right;color:#991b1b">${fmtNum(anulado)}</td>
        <td style="${estStyle}">${esc(estRec)}</td>
        <td>${esc(c.recibo_observaciones)}</td>
      </tr>`;
    }).join('');

    const filaTotales = `<tr style="font-weight:700;background:#f0f9f7;border-top:2px solid #627371">
      <td colspan="11" style="text-align:right;padding-right:8px">TOTAL</td>
      <td></td>
      <td style="text-align:right">${fmtNum(totalActivo)}</td>
      <td style="text-align:right;color:#991b1b">${fmtNum(totalAnulado || null)}</td>
      <td colspan="2"></td>
    </tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Auditoría de Citas</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 9px; margin: 20px; }
  h2 { color: #627371; margin-bottom: 4px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #627371; color: #fff; padding: 6px 4px; text-align: left; font-size: 8px; }
  td { padding: 4px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) { background: #f9fafb; }
  @media print { body { margin: 10px; } }
</style></head><body>
<h2>Auditoría de Citas</h2>
<p class="meta">Generado el ${new Date().toLocaleDateString('es-CO')} &mdash; Total: ${citas.length} registros (incluye valor y estado de recibo)</p>
<table><thead><tr>
  <th>Fecha</th><th>Hora</th><th>Médico</th><th>Paciente</th><th>Documento</th>
  <th>Especialidad</th><th>Tipo Consulta</th><th>Entidad</th><th>Tipo</th><th>Agendado por</th><th>Estado</th>
  <th>Nº Recibo</th><th>Valor recibo</th><th>Valor anulado</th><th>Estado recibo</th><th>Observaciones</th>
</tr></thead><tbody>${filas}${filaTotales}</tbody></table>
<script>window.onload=function(){window.print();}<\/script></body></html>`;

    const win = window.open('', '_blank', 'width=1200,height=700');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } else if (typeof showToast === 'function') {
      showToast('El navegador bloqueó la ventana emergente. Permite pop-ups para este sitio.', 'warning');
    }
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error exportando PDF:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar PDF: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
