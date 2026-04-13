// public/dashboard-citas.js
// Dashboard Auditoría de Citas - Quién agendó qué

// Variables globales para el dashboard
let dashboardCitasActuales = [];

/**
 * Inicializar el módulo de dashboard de citas
 */
function initDashboardCitas() {
  try {
    const btnBuscar = document.getElementById('btnBuscarCitas');
    const btnLimpiar = document.getElementById('btnLimpiarFiltros');

    if (btnBuscar) {
      btnBuscar.removeEventListener('click', buscarCitasAuditoria);
      btnBuscar.addEventListener('click', buscarCitasAuditoria);
    }

    if (btnLimpiar) {
      btnLimpiar.removeEventListener('click', limpiarFiltrosDashboard);
      btnLimpiar.addEventListener('click', limpiarFiltrosDashboard);
    }

    // Cambio de tipo de cita → recargar tipos de estudio dinámicamente
    const elTipoCita = document.getElementById('dashboardTipoCita');
    if (elTipoCita) {
      elTipoCita.addEventListener('change', function () {
        cargarTiposEstudioFiltro(this.value);
      });
    }

    // Cargar tipos de estudio para el valor inicial
    cargarTiposEstudioFiltro(elTipoCita ? elTipoCita.value : 'TODOS');

    // Configurar valores por defecto
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    if (elFechaDesde) elFechaDesde.value = hace30;
    if (elFechaHasta) elFechaHasta.value = hoy;

    // Cargar datos iniciales
    buscarCitasAuditoria();

    // Escuchar cambios en tiempo real via Socket.IO
    if (window.socket) {
      window.socket.off('turno:creado');
      window.socket.off('turno:eliminado');
      window.socket.off('cita_electro:creada');
      window.socket.off('cita_electro:eliminada');

      window.socket.on('turno:creado', buscarCitasAuditoria);
      window.socket.on('turno:eliminado', buscarCitasAuditoria);
      window.socket.on('cita_electro:creada', buscarCitasAuditoria);
      window.socket.on('cita_electro:eliminada', buscarCitasAuditoria);
    }

  } catch (e) {
    console.error('[DASHBOARD CITAS] Error en inicialización:', e.message);
    if (typeof showToast === 'function') showToast('Error inicializando dashboard: ' + e.message, 'error');
  }
}

/**
 * Buscar citas según los filtros
 */
async function buscarCitasAuditoria() {
  try {
    const elTipoCita = document.getElementById('dashboardTipoCita');
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    const elProgramadoPor = document.getElementById('dashboardAgendadoPor');
    const elTipoEstudio = document.getElementById('dashboardTipoEstudio');

    const tipoCita = elTipoCita ? elTipoCita.value : 'TODOS';
    const fechaDesde = elFechaDesde ? elFechaDesde.value : '';
    const fechaHasta = elFechaHasta ? elFechaHasta.value : '';
    const programadoPor = elProgramadoPor ? elProgramadoPor.value.trim() : '';
    const tipoEstudio = elTipoEstudio ? elTipoEstudio.value.trim() : '';

    const params = new URLSearchParams();
    if (tipoCita !== 'TODOS') params.append('tipo_cita', tipoCita);
    if (fechaDesde) params.append('fecha_desde', fechaDesde);
    if (fechaHasta) params.append('fecha_hasta', fechaHasta);
    if (programadoPor) params.append('programado_por', programadoPor);
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
      tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#dc2626">Error: ${typeof escapeHtml === 'function' ? escapeHtml(e.message) : e.message}</td></tr>`;
    }
  }
}

/**
 * Actualizar números resumen en el dashboard
 */
function actualizarResumenDashboard(resumen) {
  try {
    const elTotal = document.getElementById('dashboardTotalCitas');
    const elMedicas = document.getElementById('dashboardCitasMedicas');
    const elElectro = document.getElementById('dashboardCitasElectro');
    const elAgendadores = document.getElementById('dashboardAgendadores');
    if (elTotal) elTotal.textContent = resumen?.total_citas ?? 0;
    if (elMedicas) elMedicas.textContent = resumen?.citas_medicas ?? 0;
    if (elElectro) elElectro.textContent = resumen?.citas_electrodiagnostico ?? 0;
    if (elAgendadores) elAgendadores.textContent = resumen?.agendadores?.length ?? 0;
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
      tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">No hay citas que coincidan con los filtros</td></tr>';
      return;
    }
    setupPagination('citasAuditoria', citas, renderCitaAuditoriaRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'bodyTablaAuditoria',
      containerSelector: '#tablaCitasAuditoriaControls'
    });
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error renderizando tabla:', e.message);
    const tbody = document.getElementById('bodyTablaAuditoria');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#dc2626">Error al renderizar tabla: ${typeof escapeHtml === 'function' ? escapeHtml(e.message) : e.message}</td></tr>`;
    }
  }
}

/**
 * Renderiza una fila de cita auditoría en la tabla
 */
function renderCitaAuditoriaRow(tbody, cita) {
  try {
    const tr = document.createElement('tr');
    
    const fecha = formatearFecha(cita.fecha);
    const hora = cita.hora ? cita.hora.substring(0, 5) : '-';
    const documento = cita.paciente_documento || '-';
    const tipoConsulta = cita.tipo_consulta || '-';
    const tipoCita = cita.tipo_cita === 'AGENDA_MEDICA' ? 'Médica' : 'Electro';
    const agendadoPor = cita.programado_por || '-';
    const estado = cita.estado || '-';
    
    const estadoColor = getEstadoColor(estado);
    
    tr.innerHTML = `
      <td>${escapeHtml(fecha)}</td>
      <td>${escapeHtml(hora)}</td>
      <td>${escapeHtml(cita.paciente_nombre || '-')} (${escapeHtml(documento)})</td>
      <td>${escapeHtml(tipoConsulta)}</td>
      <td>${escapeHtml(tipoCita)}</td>
      <td style="font-weight:600">${escapeHtml(agendadoPor)}</td>
      <td style="color:${estadoColor};font-weight:600">${escapeHtml(estado)}</td>
    `;
    
    tbody.appendChild(tr);
    
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error renderizando fila:', e.message);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" style="padding:8px;text-align:center;color:#dc2626">Error en fila</td>`;
    tbody.appendChild(tr);
  }
}

/**
 * Limpiar filtros
 */
function limpiarFiltrosDashboard() {
  try {
    const elTipoCita = document.getElementById('dashboardTipoCita');
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    const elAgendadoPor = document.getElementById('dashboardAgendadoPor');

    if (elTipoCita) elTipoCita.value = 'TODOS';
    if (elAgendadoPor) elAgendadoPor.value = '';

    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (elFechaDesde) elFechaDesde.value = hace30;
    if (elFechaHasta) elFechaHasta.value = hoy;

    cargarTiposEstudioFiltro('TODOS');
    setTimeout(buscarCitasAuditoria, 100);
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error limpiando filtros:', e.message);
    if (typeof showToast === 'function') showToast('Error limpiando filtros: ' + e.message, 'error');
  }
}

/**
 * Obtener color para estado
 */
function getEstadoColor(estado) {
  if (!estado) return '#6b7280';
  
  const estadoLower = (estado || '').toLowerCase().trim();
  
  if (estadoLower.includes('pendiente')) return '#f59e0b';      // Naranja
  if (estadoLower.includes('en_atencion') || estadoLower.includes('en_atención')) return '#3b82f6';  // Azul
  if (estadoLower.includes('completado') || estadoLower.includes('completada')) return '#10b981';    // Verde
  if (estadoLower.includes('cancelado') || estadoLower.includes('cancelada')) return '#ef4444';      // Rojo
  if (estadoLower.includes('en_sala')) return '#8b5cf6';        // Púrpura
  if (estadoLower.includes('en_espera') || estadoLower.includes('espera')) return '#06b6d4';        // Cyan
  if (estadoLower.includes('programado') || estadoLower.includes('programada')) return '#06b6d4';   // Cyan
  if (estadoLower.includes('no_asistio') || estadoLower.includes('no asistió')) return '#64748b';   // Gris
  
  return '#6b7280'; // Gris por defecto
}

/**
 * Formatear fecha a formato DD/MM/YYYY
 */
function formatearFecha(fecha) {
  if (!fecha) return '-';
  
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return fecha;
    
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const año = d.getFullYear();
    
    return `${dia}/${mes}/${año}`;
  } catch(e) {
    return fecha;
  }
}

/**
 * Mostrar toast notification
 */
function mostrarToast(mensaje, tipo = 'info') {  try {
    // Usar función global showToast si existe
    if (typeof showToast === 'function') {
      showToast(mensaje, tipo);
      return;
    }
    
    // Fallback: crear toast manual
    const bgColor = {
      'error': '#dc2626',
      'success': '#10b981',
      'warning': '#f59e0b',
      'info': '#3b82f6'
    }[tipo] || '#3b82f6';
    
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 16px 24px;
      background: ${bgColor};
      color: white;
      border-radius: 8px;
      z-index: 9999;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
    
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error mostrando toast:', e.message);
  }
}

/**
 * Cargar lista de tipos de estudio para el select de filtro, según el tipo de cita seleccionado.
 * @param {string} tipoCita - 'AGENDA_MEDICA', 'ELECTRODIAGNOSTICO' o 'TODOS'
 */
async function cargarTiposEstudioFiltro(tipoCita) {
  const el = document.getElementById('dashboardTipoEstudio');
  if (!el) return;
  const valorActual = el.value;
  el.innerHTML = '<option value="">Todos los estudios</option>';

  try {
    if (!tipoCita || tipoCita === 'TODOS') {
      // Cargar ambos tipos
      const [resElectro, resMedica] = await Promise.all([
        apiFetch('/api/estudios/lista'),
        apiFetch('/api/tipos-consulta')
      ]);
      if (resElectro.ok) {
        const dataElectro = await resElectro.json();
        const estudios = dataElectro.registros || [];
        if (estudios.length) {
          const grp = document.createElement('optgroup');
          grp.label = 'Electrodiagnóstico';
          estudios.forEach(e => { const o = document.createElement('option'); o.value = e.nombre; o.textContent = e.nombre; grp.appendChild(o); });
          el.appendChild(grp);
        }
      }
      if (resMedica.ok) {
        const dataMedica = await resMedica.json();
        const tipos = Array.isArray(dataMedica) ? dataMedica : (dataMedica.registros || []);
        if (tipos.length) {
          const grp = document.createElement('optgroup');
          grp.label = 'Agenda Médica';
          tipos.forEach(t => { const o = document.createElement('option'); o.value = t.nombre; o.textContent = t.nombre; grp.appendChild(o); });
          el.appendChild(grp);
        }
      }
    } else if (tipoCita === 'ELECTRODIAGNOSTICO') {
      const resp = await apiFetch('/api/estudios/lista');
      if (resp.ok) {
        const data = await resp.json();
        (data.registros || []).forEach(e => { const o = document.createElement('option'); o.value = e.nombre; o.textContent = e.nombre; el.appendChild(o); });
      }
    } else if (tipoCita === 'AGENDA_MEDICA') {
      const resp = await apiFetch('/api/tipos-consulta');
      if (resp.ok) {
        const data = await resp.json();
        const tipos = Array.isArray(data) ? data : (data.registros || []);
        tipos.forEach(t => { const o = document.createElement('option'); o.value = t.nombre; o.textContent = t.nombre; el.appendChild(o); });
      }
    }
    // Restaurar selección si sigue siendo válida
    if (valorActual) {
      const opt = el.querySelector(`option[value="${valorActual}"]`);
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
      'Fecha': formatearFecha(c.fecha),
      'Hora': c.hora ? c.hora.substring(0, 5) : '-',
      'Paciente': c.paciente_nombre || '-',
      'Documento': c.paciente_documento || '-',
      'Tipo Consulta / Estudio': c.tipo_consulta || '-',
      'Tipo Cita': c.tipo_cita === 'AGENDA_MEDICA' ? 'Medica' : 'Electro',
      'Agendado por': c.programado_por || '-',
      'Estado': c.estado || '-'
    }));
    const ws = window.XLSX.utils.json_to_sheet(filas);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    const fechaHoy = new Date().toISOString().split('T')[0];
    window.XLSX.writeFile(wb, 'auditoria-citas-' + fechaHoy + '.xlsx');
    if (typeof showToast === 'function') showToast('Exportacion Excel completada', 'success');
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
      if (typeof showToast === 'function') showToast('No hay datos para exportar. Realiza una busqueda primero.', 'warning');
      return;
    }
    var _esc = function(s) {
      if (!s) return '-';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };
    const filas = dashboardCitasActuales.map(function(c) {
      return '<tr><td>' + formatearFecha(c.fecha) + '</td>' +
        '<td>' + (c.hora ? c.hora.substring(0,5) : '-') + '</td>' +
        '<td>' + _esc(c.paciente_nombre) + '</td>' +
        '<td>' + _esc(c.paciente_documento) + '</td>' +
        '<td>' + _esc(c.tipo_consulta) + '</td>' +
        '<td>' + (c.tipo_cita === 'AGENDA_MEDICA' ? 'Medica' : 'Electro') + '</td>' +
        '<td>' + _esc(c.programado_por) + '</td>' +
        '<td>' + _esc(c.estado) + '</td></tr>';
    }).join('');
    var fechaGen = new Date().toLocaleDateString('es-CO');
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Auditoria de Citas</title>' +
      '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}' +
      'h2{color:#627371}table{width:100%;border-collapse:collapse;margin-top:16px}' +
      'th{background:#627371;color:white;padding:8px;text-align:left}' +
      'td{padding:6px 8px;border-bottom:1px solid #e5e7eb}' +
      'tr:nth-child(even){background:#f9fafb}' +
      '.meta{color:#666;font-size:11px;margin-bottom:8px}</style></head><body>' +
      '<h2>Auditoria de Citas</h2>' +
      '<p class="meta">Generado el ' + fechaGen + ' &mdash; Total: ' + dashboardCitasActuales.length + ' registros</p>' +
      '<table><thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Documento</th>' +
      '<th>Tipo Estudio</th><th>Tipo Cita</th><th>Agendado por</th><th>Estado</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>' +
      '<script>window.onload=function(){window.print();}<\/script></body></html>';
    var ventana = window.open('', '_blank', 'width=900,height=700');
    if (ventana) {
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
    } else {
      if (typeof showToast === 'function') showToast('El navegador bloqueo la ventana emergente. Permite pop-ups para este sitio.', 'warning');
    }
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error exportando PDF:', e.message);
    if (typeof showToast === 'function') showToast('Error al exportar PDF: ' + e.message, 'error');
  }
}
