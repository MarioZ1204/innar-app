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

/** Contexto actual de médico / especialidad para filtros dependientes */
function getDashboardFiltrosContext() {
  const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
  const medicoSel = document.getElementById('dashboardMedico');
  const medicoId = medicoSel?.value || '';
  const espSel = document.getElementById('dashboardEspecialidad');
  let especialidadId = espSel?.value || '';
  if (!especialidadId && medicoSel && medicoId) {
    const opt = medicoSel.options[medicoSel.selectedIndex];
    especialidadId = opt?.dataset?.especialidadId || '';
  }
  return { tipoCita, medicoId, especialidadId };
}

function recargarFiltrosTipoDashboard() {
  const { medicoId, especialidadId } = getDashboardFiltrosContext();
  return Promise.all([
    cargarTipoConsultaFiltro(medicoId, especialidadId),
    cargarTipoEstudioFiltro()
  ]);
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

    const selMedico = document.getElementById('dashboardMedico');
    if (selMedico) {
      selMedico.addEventListener('change', function () {
        const opt = this.options[this.selectedIndex];
        const espId = opt?.dataset?.especialidadId || '';
        const selEsp = document.getElementById('dashboardEspecialidad');
        if (selEsp && espId) selEsp.value = espId;
        cargarTipoConsultaFiltro(this.value || '', espId);
      });
    }

    const selEsp = document.getElementById('dashboardEspecialidad');
    if (selEsp) {
      selEsp.addEventListener('change', function () {
        const espId = this.value;
        const selMed = document.getElementById('dashboardMedico');
        if (selMed && window._dashboardMedicos) {
          const prevMed = selMed.value;
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
          if (espId && !selMed.querySelector(`option[value="${prevMed}"]`)) {
            selMed.value = '';
          } else if (!espId && prevMed) {
            selMed.value = prevMed;
          }
        }
        cargarTipoConsultaFiltro(
          document.getElementById('dashboardMedico')?.value || '',
          espId
        );
      });
    }

    cargarMedicosFiltro();
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
    if (selMed) selMed.value = '';
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
    const prev = sel.value;
    window._dashboardMedicos = Array.isArray(data) ? data : [];
    sel.innerHTML = '<option value="">Todos los médicos</option>';
    window._dashboardMedicos.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nombre;
      if (m.especialidad_id) opt.dataset.especialidadId = m.especialidad_id;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
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
  if (typeof fetchCatalogoEntidadesOpciones === 'function') {
    try {
      const { estudios } = await fetchCatalogoEntidadesOpciones();
      if (estudios?.length) return estudios.map((n) => ({ nombre: typeof n === 'string' ? n : n }));
    } catch (_) { /* fallback */ }
  }
  const res = await apiFetch('/api/estudios/lista');
  if (!res.ok) return [];
  const data = await res.json();
  return data.registros || data.estudios || [];
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

/** Tipos de consulta médica (agenda), según médico o especialidad */
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
        hint.textContent = 'Seleccione médico o especialidad';
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
    const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
    const fechaDesde = document.getElementById('dashboardFechaDesde')?.value || '';
    const fechaHasta = document.getElementById('dashboardFechaHasta')?.value || '';
    const agendadoPor = (document.getElementById('dashboardAgendadoPor')?.value || '').trim();
    const medicoId = document.getElementById('dashboardMedico')?.value || '';
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

    const res = await apiFetch(`/api/dashboard/citas-auditoria?${params.toString()}`);
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
    ['dashboardMedico', 'dashboardEspecialidad', 'dashboardEstado', 'dashboardAgendadoPor'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    if (window._dashboardMedicos) {
      const selMed = document.getElementById('dashboardMedico');
      if (selMed) {
        selMed.innerHTML = '<option value="">Todos los médicos</option>';
        window._dashboardMedicos.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.nombre;
          if (m.especialidad_id) opt.dataset.especialidadId = m.especialidad_id;
          selMed.appendChild(opt);
        });
      }
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

async function cargarEntidadesFiltroAuditoria() {
  const sel = document.getElementById('dashboardEntidad');
  if (!sel) return;
  try {
    if (typeof cargarEntidadesEnSelect === 'function') {
      await cargarEntidadesEnSelect('dashboardEntidad', { placeholder: 'Todas' });
    } else if (typeof fetchCatalogoEntidadesOpciones === 'function') {
      const { entidades } = await fetchCatalogoEntidadesOpciones();
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

function exportarAuditoriaCitasExcel() {
  try {
    if (!dashboardCitasActuales?.length) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar. Realiza una búsqueda primero.', 'warning');
      return;
    }
    if (!window.XLSX) {
      if (typeof showToast === 'function') showToast('Librería XLSX no disponible', 'error');
      return;
    }
    const rows = dashboardCitasActuales.map((c) => ({
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
      Estado: c.estado || '-'
    }));
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 14 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, sheet, 'Auditoria');
    window.XLSX.writeFile(wb, `auditoria-citas-${localDateStrDash(new Date())}.xlsx`);
    if (typeof showToast === 'function') showToast('Exportación Excel completada', 'success');
  } catch (e) {
    console.error('[DASHBOARD CITAS] Error exportando Excel:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar: ' + e.message, 'error');
  }
}

function exportarAuditoriaCitasPDF() {
  try {
    if (!dashboardCitasActuales?.length) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar. Realiza una búsqueda primero.', 'warning');
      return;
    }
    const esc = (s) => String(s || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const filas = dashboardCitasActuales.map((c) => `<tr>
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
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Auditoría de Citas</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
  h2 { color: #627371; margin-bottom: 4px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #627371; color: #fff; padding: 6px 5px; text-align: left; font-size: 10px; }
  td { padding: 5px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) { background: #f9fafb; }
  @media print { body { margin: 10px; } }
</style></head><body>
<h2>Auditoría de Citas</h2>
<p class="meta">Generado el ${new Date().toLocaleDateString('es-CO')} &mdash; Total: ${dashboardCitasActuales.length} registros</p>
<table><thead><tr>
  <th>Fecha</th><th>Hora</th><th>Médico</th><th>Paciente</th><th>Documento</th>
  <th>Especialidad</th><th>Tipo Consulta</th><th>Entidad</th><th>Tipo</th><th>Agendado por</th><th>Estado</th>
</tr></thead><tbody>${filas}</tbody></table>
<script>window.onload=function(){window.print();}<\/script></body></html>`;

    const win = window.open('', '_blank', 'width=1100,height=700');
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
  }
}
