// public/dashboard-citas.js
// Dashboard Auditoría de Citas - Quién agendó qué

// Variables globales para el dashboard
let dashboardCitasActuales = [];

/**
 * Inicializar el módulo de dashboard de citas
 */
function initDashboardCitas() {
  console.log('[DASHBOARD CITAS] Inicializando módulo');
  
  try {
    // Event listeners para filtros
    const btnBuscar = document.getElementById('btnBuscarCitas');
    const btnLimpiar = document.getElementById('btnLimpiarFiltros');
    
    console.log('[DASHBOARD CITAS] Botón Buscar encontrado:', !!btnBuscar);
    console.log('[DASHBOARD CITAS] Botón Limpiar encontrado:', !!btnLimpiar);
    
    if (btnBuscar) {
      btnBuscar.removeEventListener('click', buscarCitasAuditoria);
      btnBuscar.addEventListener('click', buscarCitasAuditoria);
      console.log('[DASHBOARD CITAS] Event listener agregado a Buscar');
    }
    
    if (btnLimpiar) {
      btnLimpiar.removeEventListener('click', limpiarFiltrosDashboard);
      btnLimpiar.addEventListener('click', limpiarFiltrosDashboard);
      console.log('[DASHBOARD CITAS] Event listener agregado a Limpiar');
    }
    
    // Configurar valores por defecto
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    
    if (elFechaDesde) {
      elFechaDesde.value = hace30;
      console.log('[DASHBOARD CITAS] Fecha desde establecida:', hace30);
    }
    if (elFechaHasta) {
      elFechaHasta.value = hoy;
      console.log('[DASHBOARD CITAS] Fecha hasta establecida:', hoy);
    }
    
    // Cargar datos iniciales
    console.log('[DASHBOARD CITAS] Cargando datos iniciales');
    buscarCitasAuditoria();
    
    // Escuchar cambios en tiempo real via Socket.IO
    if (window.socket) {
      console.log('[DASHBOARD CITAS] Configurando listeners de Socket.IO');
      
      // Limpiar listeners previos
      window.socket.off('turno:creado');
      window.socket.off('turno:eliminado');
      window.socket.off('cita_electro:creada');
      window.socket.off('cita_electro:eliminada');
      
      // Nuevos listeners
      window.socket.on('turno:creado', () => {
        console.log('[DASHBOARD CITAS] Evento: Nuevo turno creado');
        buscarCitasAuditoria();
      });
      
      window.socket.on('turno:eliminado', () => {
        console.log('[DASHBOARD CITAS] Evento: Turno eliminado');
        buscarCitasAuditoria();
      });
      
      window.socket.on('cita_electro:creada', () => {
        console.log('[DASHBOARD CITAS] Evento: Nueva cita electrodiagnóstico');
        buscarCitasAuditoria();
      });
      
      window.socket.on('cita_electro:eliminada', () => {
        console.log('[DASHBOARD CITAS] Evento: Cita electrodiagnóstico eliminada');
        buscarCitasAuditoria();
      });
    }
    
    console.log('[DASHBOARD CITAS] Inicialización completada');
    
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
    console.log('[DASHBOARD CITAS] Iniciando búsqueda de citas');
    
    // Obtener elementos del DOM
    const elTipoCita = document.getElementById('dashboardTipoCita');
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    const elProgramadoPor = document.getElementById('dashboardAgendadoPor');
    
    const tipoCita = elTipoCita ? elTipoCita.value : 'TODOS';
    const fechaDesde = elFechaDesde ? elFechaDesde.value : '';
    const fechaHasta = elFechaHasta ? elFechaHasta.value : '';
    const programadoPor = elProgramadoPor ? elProgramadoPor.value.trim() : '';
    
    console.log('[DASHBOARD CITAS] Filtros:', { tipoCita, fechaDesde, fechaHasta, programadoPor });
    
    const params = new URLSearchParams();
    if (tipoCita !== 'TODOS') params.append('tipo_cita', tipoCita);
    if (fechaDesde) params.append('fecha_desde', fechaDesde);
    if (fechaHasta) params.append('fecha_hasta', fechaHasta);
    if (programadoPor) params.append('programado_por', programadoPor);
    
    const url = `/api/dashboard/citas-auditoria?${params.toString()}`;
    console.log('[DASHBOARD CITAS] URL:', url);
    
    const response = await apiFetch(url);
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.warn('[DASHBOARD CITAS] No autorizado, volviendo al menú');
        goToMenu();
        return;
      }
      throw new Error(`Error HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[DASHBOARD CITAS] Respuesta recibida:', data);
    
    dashboardCitasActuales = data.data || [];
    console.log('[DASHBOARD CITAS] Citas encontradas:', dashboardCitasActuales.length);
    
    // Actualizar resumen
    if (data.resumen) {
      actualizarResumenDashboard(data.resumen);
    }
    
    // Renderizar tabla
    renderizarTablaCitasAuditoria(dashboardCitasActuales);
    
    if (dashboardCitasActuales.length > 0) {
      if (typeof showToast === 'function') showToast(`Se encontraron ${dashboardCitasActuales.length} citas`, 'success');
    } else {
      if (typeof showToast === 'function') showToast('No se encontraron citas con los filtros especificados', 'warning');
    }
    
  } catch(e) {
    console.error('[DASHBOARD CITAS] Error cargando auditoría:', e.message);
    if (typeof showToast === 'function') showToast('Error al cargar citas: ' + e.message, 'error');
    
    // Mostrar tabla vacía
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
    console.log('[DASHBOARD CITAS] Actualizando resumen:', resumen);
    
    const elTotal = document.getElementById('dashboardTotalCitas');
    const elMedicas = document.getElementById('dashboardCitasMedicas');
    const elElectro = document.getElementById('dashboardCitasElectro');
    const elAgendadores = document.getElementById('dashboardAgendadores');
    
    if (elTotal) {
      elTotal.textContent = resumen && resumen.total_citas ? resumen.total_citas : 0;
    }
    if (elMedicas) {
      elMedicas.textContent = resumen && resumen.citas_medicas ? resumen.citas_medicas : 0;
    }
    if (elElectro) {
      elElectro.textContent = resumen && resumen.citas_electrodiagnostico ? resumen.citas_electrodiagnostico : 0;
    }
    if (elAgendadores) {
      const agendadores = resumen && resumen.agendadores ? resumen.agendadores.length : 0;
      elAgendadores.textContent = agendadores;
    }
    
    console.log('[DASHBOARD CITAS] Resumen actualizado');
    
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
    
    if (!tbody) {
      console.error('[DASHBOARD CITAS] Tabla no encontrada en el DOM');
      return;
    }
    
    console.log('[DASHBOARD CITAS] Renderizando', citas.length, 'citas');
    
    if (citas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">No hay citas que coincidan con los filtros</td></tr>';
      console.log('[DASHBOARD CITAS] Tabla vacía');
      return;
    }

    // Usar setupPagination (función de app.js) para renderizar con paginación
    setupPagination('citasAuditoria', citas, renderCitaAuditoriaRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'bodyTablaAuditoria',
      containerSelector: '#tablaCitasAuditoriaControls'
    });
    
    console.log('[DASHBOARD CITAS] Tabla renderizada exitosamente con paginación');
    
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
    console.log('[DASHBOARD CITAS] Limpiando filtros');
    
    const elTipoCita = document.getElementById('dashboardTipoCita');
    const elFechaDesde = document.getElementById('dashboardFechaDesde');
    const elFechaHasta = document.getElementById('dashboardFechaHasta');
    const elAgendadoPor = document.getElementById('dashboardAgendadoPor');
    
    if (elTipoCita) {
      elTipoCita.value = 'TODOS';
      console.log('[DASHBOARD CITAS] Tipo de Cita limpio');
    }
    if (elAgendadoPor) {
      elAgendadoPor.value = '';
      console.log('[DASHBOARD CITAS] Agendado por limpio');
    }
    
    // Configurar fechas por defecto (últimos 30 días)
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    if (elFechaDesde) {
      elFechaDesde.value = hace30;
      console.log('[DASHBOARD CITAS] Fecha desde limpia:', hace30);
    }
    if (elFechaHasta) {
      elFechaHasta.value = hoy;
      console.log('[DASHBOARD CITAS] Fecha hasta limpia:', hoy);
    }
    
    // Ejecutar búsqueda con filtros limpios
    setTimeout(() => {
      console.log('[DASHBOARD CITAS] Ejecutando búsqueda después de limpiar filtros');
      buscarCitasAuditoria();
    }, 200);
    
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
function mostrarToast(mensaje, tipo = 'info') {
  try {
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
