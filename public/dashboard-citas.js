// public/dashboard-citas.js
// Dashboard Auditoría de Citas - Auditoría completa por médico, especialidad, estado, etc.

// Variables globales para el dashboard
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

    // Cambio de tipo de cita → actualizar visibilidad filtros médico/especialidad y recargar tipos consulta
    const elTipoCita = document.getElementById('dashboardTipoCita');
    if (elTipoCita) {
      if (dashboardTipoCitaChangeHandler) {
        elTipoCita.removeEventListener('change', dashboardTipoCitaChangeHandler);
      }
      dashboardTipoCitaChangeHandler = function () {
        const tipo = this.value;
        actualizarVisibilidadFiltrosMedico(tipo);
        cargarTiposEstudioFiltro(tipo, '');
      };
      elTipoCita.addEventListener('change', dashboardTipoCitaChangeHandler);
    }

    // Cambio de médico → auto-seleccionar especialidad del médico
    const elMedico = document.getElementById('dashboardMedico');
    if (elMedico) {
      elMedico.addEventListener('change', function () {
        const opt = this.options[this.selectedIndex];
        const espId = opt ? opt.dataset.especialidadId : '';
        const elEsp = document.getElementById('dashboardEspecialidad');
        if (elEsp && espId) {
          elEsp.value = espId;
          cargarTiposEstudioFiltro(
            document.getElementById('dashboardTipoCita')?.value || 'AGENDA_MEDICA',
            espId
          );
        }
      });
    }

    // Cambio de especialidad → recargar tipos de consulta
    const elEspecialidad = document.getElementById('dashboardEspecialidad');
    if (elEspecialidad) {
      elEspecialidad.addEventListener('change', function () {
        cargarTiposEstudioFiltro(
          document.getElementById('dashboardTipoCita')?.value || 'AGENDA_MEDICA',
          this.value
        );
      });
    }

    // Cargar selectores auxiliares
    cargarMedicosFiltro();
    cargarEspecialidadesFiltro();
    cargarEntidadesFiltroAuditoria();
    cargarTiposEstudioFiltro(elTipoCita ? elTipoCita.value : 'TODOS', '');

    // Valores por defecto de fechas (últimos 30 días) usando tiempo LOCAL
    const ahora = new Date();
    const hace30 = new Date(ahora);
    hace30.setDate(hace30.getDate() - 30);

    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    if (elFechaDesde && !elFechaDesde.value) elFechaDesde.value = localDateStrDash(hace30);
    if (elFechaHasta && !elFechaHasta.value) elFechaHasta.value = localDateStrDash(ahora);

    // Carga inicial
    scheduleBuscarCitasAuditoria(100);

    // Escuchar cambios en tiempo real via Socket.IO
    if (window.socket) {
      const eventos = [
        'turno:creado', 'turno:eliminado',
        'cita_electro:creada', 'cita_electro:eliminada',
        'agenda:turno-creado', 'agenda:turno-eliminado',
        'electro:cita-creada', 'electro:cita-eliminada'
      ];
      eventos.forEach(ev => {
        window.socket.off(ev);
        window.socket.on(ev, () => scheduleBuscarCitasAuditoria(250));
      });
    }

  } catch (e) {
    console.error('[DASHBOARD CITAS] Error en inicialización:', e.message);
    if (typeof showToast === 'function') showToast('Error inicializando dashboard: ' + e.message, 'error');
  }
}

function actualizarVisibilidadFiltrosMedico(tipoCita) {
  const medicoCol = document.getElementById('dashboardMedicoCol');
  const espCol = document.getElementById('dashboardEspecialidadCol');
  const esElectro = tipoCita === 'ELECTRODIAGNOSTICO';
  if (medicoCol) medicoCol.style.display = esElectro ? 'none' : '';
  if (espCol) espCol.style.display = esElectro ? 'none' : '';
  if (esElectro) {
    const m = document.getElementById('dashboardMedico');
    const e = document.getElementById('dashboardEspecialidad');
    if (m) m.value = '';
    if (e) e.value = '';
  }
}

// ─── Carga de selectores auxiliares ──────────────────────────────────────────

async function cargarMedicosFiltro() {
  const el = document.getElementById('dashboardMedico');
  if (!el) return;
  try {
    const resp = await apiFetch('/api/medicos');
    if (!resp.ok) return;
    const medicos = await resp.json();
    const valorActual = el.value;
    el.innerHTML = '<option value="">Todos los médicos</option>';
    (Array.isArray(medicos) ? medicos : []).forEach(m => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.nombre;
      if (m.especialidad_id) o.dataset.especialidadId = m.especialidad_id;
      el.appendChild(o);
    });
    if (valorActual) el.value = valorActual;
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar médicos:', e.message);
  }
}

async function cargarEspecialidadesFiltro() {
  const el = document.getElementById('dashboardEspecialidad');
  if (!el) return;
  try {
    const resp = await apiFetch('/api/especialidades');
    if (!resp.ok) return;
    const data = await resp.json();
    const especialidades = Array.isArray(data) ? data : (data.registros || []);
    const valorActual = el.value;
    el.innerHTML = '<option value="">Todas las especialidades</option>';
    especialidades.filter(e => e.activo !== 0).forEach(e => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.nombre;
      el.appendChild(o);
    });
    if (valorActual) el.value = valorActual;
  } catch (e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar especialidades:', e.message);
  }
}

/**
 * Buscar citas según los filtros
 */
async function buscarCitasAuditoria() {
  if (dashboardFetchInFlight) {
    dashboardFetchPending = true;
    return;
  }
  dashboardFetchInFlight = true;
  const btnBuscar = document.getElementById('btnBuscarCitas');
  if (btnBuscar) { btnBuscar.disabled = true; btnBuscar.textContent = 'Buscando…'; }

  try {
    const tipoCita = document.getElementById('dashboardTipoCita')?.value || 'TODOS';
    const fechaDesde = document.getElementById('dashboardFechaDesde')?.value || '';
    const fechaHasta = document.getElementById('dashboardFechaHasta')?.value || '';
    const programadoPor = (document.getElementById('dashboardAgendadoPor')?.value || '').trim();
    const doctorId = document.getElementById('dashboardMedico')?.value || '';
    const especialidadId = document.getElementById('dashboardEspecialidad')?.value || '';
    const estado = document.getElementById('dashboardEstado')?.value || '';
    const entidad = document.getElementById('dashboardEntidad')?.value || '';
    const tipoEstudio = document.getElementById('dashboardTipoEstudio')?.value || '';

    const params = new URLSearchParams();
    if (tipoCita !== 'TODOS') params.append('tipo_cita', tipoCita);
    if (fechaDesde) params.append('fecha_desde', fechaDesde);
    if (fechaHasta) params.append('fecha_hasta', fechaHasta);
    if (programadoPor) params.append('programado_por', programadoPor);
    if (doctorId) params.append('doctor_id', doctorId);
    if (especialidadId) params.append('especialidad_id', especialidadId);
    if (estado) params.append('estado', estado);
    if (entidad) params.append('entidad', entidad);
    if (tipoEstudio) params.append('tipo_estudio', tipoEstudio);

    const response = await apiFetch(`/api/dashboard/citas-auditoria?${params.toString()}`);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { goToMenu(); return; }
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();
    dashboardCitasActuales = data.data || [];

    if (data.resumen) actualizarResumenDashboard(data.resumen);
    renderizarTablaCitasAuditoria(dashboardCitasActuales);

    if (dashboardCitasActuales.length === 0) {
      if (typeof showToast === 'function') showToast('No se encontraron citas con los filtros especificados', 'warning');
    }
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error cargando auditoría:', e.message);
    if (typeof showToast === 'function') showToast('Error al cargar citas: ' + e.message, 'error');
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (tbody) {
      const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => s);
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Error: ${esc(e.message)}</td></tr>`;
    }
  } finally {
    dashboardFetchInFlight = false;
    if (btnBuscar) {
      btnBuscar.disabled = false;
      btnBuscar.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Buscar`;
    }
    if (dashboardFetchPending) {
      dashboardFetchPending = false;
      scheduleBuscarCitasAuditoria(200);
    }
  }
}

/**
 * Actualizar números resumen en el dashboard
 */
function actualizarResumenDashboard(resumen) {
  try {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; };
    set('dashboardTotalCitas', resumen.total_citas);
    set('dashboardCitasMedicas', resumen.citas_medicas);
    set('dashboardCitasElectro', resumen.citas_electrodiagnostico);
    set('dashboardAtendidos', resumen.atendidos);
    set('dashboardNoAsistieron', resumen.no_asistieron);
    set('dashboardCancelados', resumen.cancelados);
    set('dashboardReprogramados', resumen.reprogramados);
    set('dashboardPendientes', resumen.pendientes);
    set('dashboardAgendadores', resumen.agendadores?.length ?? 0);
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error actualizando resumen:', e.message);
  }
}

/**
 * Renderizar tabla de citas auditoría
 */
function renderizarTablaCitasAuditoria(citas) {
  try {
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (!tbody) return;
    if (citas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">No hay citas que coincidan con los filtros</td></tr>';
      const ctrl = document.getElementById('tablaCitasAuditoriaControls');
      if (ctrl) ctrl.innerHTML = '';
      return;
    }
    setupPagination('citasAuditoria', citas, renderCitaAuditoriaRow, {
      itemsPerPageDefault: 25,
      tbodyId: 'bodyTablaAuditoria',
      containerSelector: '#tablaCitasAuditoriaControls'
    });
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error renderizando tabla:', e.message);
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (tbody) {
      const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => s);
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Error al renderizar tabla: ${esc(e.message)}</td></tr>`;
    }
  }
}

/**
 * Renderiza una fila de cita auditoría en la tabla
 */
function renderCitaAuditoriaRow(tbody, cita) {
  try {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => String(s || ''));
    const tr = document.createElement('tr');

    const fecha = formatearFechaAuditoria(cita.fecha);
    const hora = (cita.hora || '').substring(0, 5) || '-';
    const medico = cita.medico_nombre || (cita.tipo_cita === 'ELECTRODIAGNOSTICO' ? '—' : '-');
    const paciente = esc(cita.paciente_nombre || '-') + ` <span style="color:#888;font-size:11px">(${esc(cita.paciente_documento || '-')})</span>`;
    const especialidad = cita.especialidad_nombre || '-';
    const tipoConsulta = cita.tipo_consulta || '-';
    const entidad = cita.entidad || '-';
    const tipoCita = cita.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro';
    const agendadoPor = cita.programado_por || '-';
    const estado = cita.estado || '-';
    const { color: estadoColor, bg: estadoBg } = getEstadoStyle(estado);

    tr.innerHTML = `
      <td>${esc(fecha)}</td>
      <td style="white-space:nowrap">${esc(hora)}</td>
      <td style="font-weight:600;color:#374151">${esc(medico)}</td>
      <td>${paciente}</td>
      <td style="font-size:12px;color:#6b7280">${esc(especialidad)}</td>
      <td>${esc(tipoConsulta)}</td>
      <td>${esc(entidad)}</td>
      <td><span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#e0f2fe;color:#0369a1;font-weight:600">${esc(tipoCita)}</span></td>
      <td style="font-weight:600;color:#374151">${esc(agendadoPor)}</td>
      <td><span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${estadoBg};color:${estadoColor};font-weight:600;white-space:nowrap">${esc(estado)}</span></td>
    `;
    tbody.appendChild(tr);
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error renderizando fila:', e.message);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="10" style="padding:8px;text-align:center;color:#dc2626">Error en fila</td>`;
    tbody.appendChild(tr);
  }
}

function getEstadoStyle(estado) {
  const e = (estado || '').toLowerCase().trim();
  if (e === 'atendido' || e === 'completado')                           return { color: '#065f46', bg: '#d1fae5' };
  if (e === 'no_asistio' || e === 'no asistió')                        return { color: '#7f1d1d', bg: '#fee2e2' };
  if (e === 'cancelado' || e === 'cancelada')                          return { color: '#4b5563', bg: '#f3f4f6' };
  if (e === 'reprogramado' || e === 'reprogramada')                    return { color: '#78350f', bg: '#fef3c7' };
  if (e === 'pendiente' || e === 'programado')                         return { color: '#1e40af', bg: '#dbeafe' };
  if (e === 'en_sala' || e === 'en sala')                              return { color: '#4c1d95', bg: '#ede9fe' };
  if (e === 'en_atencion' || e === 'en atención' || e === 'en estudio') return { color: '#0c4a6e', bg: '#e0f2fe' };
  if (e === 'confirmado')                                               return { color: '#14532d', bg: '#dcfce7' };
  return { color: '#374151', bg: '#f9fafb' };
}

function formatearFechaAuditoria(fecha) {
  if (!fecha) return '-';
  try {
    const str = typeof fecha === 'string' ? fecha : String(fecha);
    const parts = str.substring(0, 10).split('-');
    if (parts.length === 3 && parts[0].length === 4) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return str;
  } catch (e) {
    return String(fecha);
  }
}

function localDateStrDash(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Limpiar filtros
 */
function limpiarFiltrosDashboard() {
  try {
    ['dashboardMedico', 'dashboardEspecialidad', 'dashboardEstado',
      'dashboardEntidad', 'dashboardAgendadoPor', 'dashboardTipoEstudio'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    const elTipoCita = document.getElementById('dashboardTipoCita');
    if (elTipoCita) { elTipoCita.value = 'TODOS'; actualizarVisibilidadFiltrosMedico('TODOS'); }

    const ahora = new Date();
    const hace30 = new Date(ahora);
    hace30.setDate(hace30.getDate() - 30);
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    if (elFechaDesde) elFechaDesde.value = localDateStrDash(hace30);
    if (elFechaHasta) elFechaHasta.value = localDateStrDash(ahora);

    cargarTiposEstudioFiltro('TODOS', '');
    setTimeout(buscarCitasAuditoria, 150);
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error limpiando filtros:', e.message);
    if (typeof showToast === 'function') showToast('Error limpiando filtros: ' + e.message, 'error');
  }
}

/**
 * Cargar entidades disponibles para el filtro de auditoría
 */
async function cargarEntidadesFiltroAuditoria() {
  const el = document.getElementById('dashboardEntidad');
  if (!el) return;
  const valorActual = el.value;
  el.innerHTML = '<option value="">Todas</option>';
  try {
    const resp = await apiFetch('/api/entidades');
    if (resp.ok) {
      const data = await resp.json();
      const entidades = Array.isArray(data) ? data : (data.registros || []);
      entidades.forEach(e => {
        const o = document.createElement('option');
        o.value = e.nombre;
        o.textContent = e.nombre;
        el.appendChild(o);
      });
    }
    if (valorActual) {
      const opt = el.querySelector(`option[value="${CSS.escape(valorActual)}"]`);
      if (opt) el.value = valorActual;
    }
  } catch(e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar entidades:', e.message);
  }
}

/**
 * Cargar lista de tipos de estudio/consulta para el select de filtro
 * @param {string} tipoCita - 'AGENDA_MEDICA', 'ELECTRODIAGNOSTICO' o 'TODOS'
 * @param {string|number} especialidadId - id de especialidad (solo para AGENDA_MEDICA)
 */
async function cargarTiposEstudioFiltro(tipoCita, especialidadId) {
  const el = document.getElementById('dashboardTipoEstudio');
  if (!el) return;
  const label = document.getElementById('dashboardTipoEstudioLabel');
  const valorActual = el.value;
  el.innerHTML = '<option value="">Todos</option>';

  try {
    if (!tipoCita || tipoCita === 'TODOS') {
      if (label) label.textContent = 'Tipo de Consulta / Estudio';
      const [resE, resM] = await Promise.all([
        apiFetch('/api/estudios/lista'),
        apiFetch('/api/tipos-consulta')
      ]);
      if (resE.ok) {
        const d = await resE.json();
        const estudios = d.registros || [];
        if (estudios.length) {
          const grp = document.createElement('optgroup');
          grp.label = 'Electrodiagnóstico';
          estudios.forEach(e => { const o = document.createElement('option'); o.value = e.nombre; o.textContent = e.nombre; grp.appendChild(o); });
          el.appendChild(grp);
        }
      }
      if (resM.ok) {
        const d = await resM.json();
        const tipos = Array.isArray(d) ? d : (d.registros || []);
        if (tipos.length) {
          const grp = document.createElement('optgroup');
          grp.label = 'Agenda Médica';
          tipos.forEach(t => { const o = document.createElement('option'); o.value = t.nombre; o.textContent = t.nombre; grp.appendChild(o); });
          el.appendChild(grp);
        }
      }
    } else if (tipoCita === 'ELECTRODIAGNOSTICO') {
      if (label) label.textContent = 'Tipo de Estudio';
      const resp = await apiFetch('/api/estudios/lista');
      if (resp.ok) {
        const d = await resp.json();
        (d.registros || []).forEach(e => { const o = document.createElement('option'); o.value = e.nombre; o.textContent = e.nombre; el.appendChild(o); });
      }
    } else {
      if (label) label.textContent = 'Tipo de Consulta';
      let url = '/api/tipos-consulta';
      if (especialidadId) url += `?especialidad_id=${encodeURIComponent(especialidadId)}`;
      const resp = await apiFetch(url);
      if (resp.ok) {
        const d = await resp.json();
        const tipos = Array.isArray(d) ? d : (d.registros || []);
        tipos.forEach(t => { const o = document.createElement('option'); o.value = t.nombre; o.textContent = t.nombre; el.appendChild(o); });
      }
    }
    // Restaurar selección previa si sigue siendo válida
    if (valorActual) {
      const opt = el.querySelector(`option[value="${CSS.escape(valorActual)}"]`);
      if (opt) el.value = valorActual;
    }
  } catch(e) {
    console.warn('[DASHBOARD CITAS] No se pudieron cargar tipos de estudio:', e.message);
  }
}

/**
 * Exportar auditoría de citas a Excel (xlsx)
 */
function exportarAuditoriaCitasExcel() {
  try {
    if (!dashboardCitasActuales || dashboardCitasActuales.length === 0) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar. Realiza una búsqueda primero.', 'warning');
      return;
    }
    if (!window.XLSX) {
      if (typeof showToast === 'function') showToast('Librería XLSX no disponible', 'error');
      return;
    }
    const filas = dashboardCitasActuales.map(c => ({
      'Fecha': formatearFechaAuditoria(c.fecha),
      'Hora': (c.hora || '').substring(0, 5) || '-',
      'Médico': c.medico_nombre || '-',
      'Paciente': c.paciente_nombre || '-',
      'Documento': c.paciente_documento || '-',
      'Especialidad': c.especialidad_nombre || '-',
      'Tipo Consulta / Estudio': c.tipo_consulta || '-',
      'Entidad': c.entidad || '-',
      'Tipo Cita': c.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro',
      'Agendado por': c.programado_por || '-',
      'Estado': c.estado || '-'
    }));
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 28 }, { wch: 14 },
      { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 14 }
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    const ahora = new Date();
    const fechaHoy = localDateStrDash(ahora);
    window.XLSX.writeFile(wb, `auditoria-citas-${fechaHoy}.xlsx`);
    if (typeof showToast === 'function') showToast('Exportación Excel completada', 'success');
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error exportando Excel:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar: ' + e.message, 'error');
  }
}

/**
 * Exportar auditoría de citas a PDF (ventana de impresión)
 */
function exportarAuditoriaCitasPDF() {
  try {
    if (!dashboardCitasActuales || dashboardCitasActuales.length === 0) {
      if (typeof showToast === 'function') showToast('No hay datos para exportar. Realiza una búsqueda primero.', 'warning');
      return;
    }
    const _esc = s => String(s || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const filas = dashboardCitasActuales.map(c =>
      `<tr>
        <td>${formatearFechaAuditoria(c.fecha)}</td>
        <td>${_esc((c.hora || '').substring(0, 5))}</td>
        <td>${_esc(c.medico_nombre)}</td>
        <td>${_esc(c.paciente_nombre)}</td>
        <td>${_esc(c.paciente_documento)}</td>
        <td>${_esc(c.especialidad_nombre)}</td>
        <td>${_esc(c.tipo_consulta)}</td>
        <td>${_esc(c.entidad)}</td>
        <td>${c.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro'}</td>
        <td>${_esc(c.programado_por)}</td>
        <td>${_esc(c.estado)}</td>
      </tr>`
    ).join('');

    const fechaGen = new Date().toLocaleDateString('es-CO');
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
<p class="meta">Generado el ${fechaGen} &mdash; Total: ${dashboardCitasActuales.length} registros</p>
<table><thead><tr>
  <th>Fecha</th><th>Hora</th><th>Médico</th><th>Paciente</th><th>Documento</th>
  <th>Especialidad</th><th>Tipo Consulta</th><th>Entidad</th><th>Tipo</th><th>Agendado por</th><th>Estado</th>
</tr></thead><tbody>${filas}</tbody></table>
<script>window.onload=function(){window.print();}<\/script></body></html>`;

    const ventana = window.open('', '_blank', 'width=1100,height=700');
    if (ventana) {
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
    } else {
      if (typeof showToast === 'function') showToast('El navegador bloqueó la ventana emergente. Permite pop-ups para este sitio.', 'warning');
    }
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error exportando PDF:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar PDF: ' + e.message, 'error');
  }
}
