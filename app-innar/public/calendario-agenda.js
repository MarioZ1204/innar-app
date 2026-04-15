// calendario-agenda.js - Calendario mensual integrado en Ver Citas de Agenda Medica

let _citasCalMesActual = null;
let _citasCalDatosCache = {};
let _citasCalDispCache = {}; // disponibilidad del doctor
let _citasCalIniciado = false;

const _MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const _DIAS_SEMANA_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

function initCitasCalendario() {
  var calView = document.getElementById('agendaCalView');
  var dayView = document.getElementById('agendaDayView');
  if (calView) { calView.style.display = ''; calView.classList.remove('agenda-cal-view-exit','agenda-cal-view-enter'); }
  if (dayView) { dayView.classList.remove('agenda-day-view-enter','agenda-day-view-exit'); dayView.classList.add('agenda-day-view-hidden'); }

  if (_citasCalIniciado) { cargarCitasCalendario(); return; }
  _citasCalIniciado = true;
  _citasCalMesActual = new Date();
  _citasCalMesActual.setDate(1);

  var btnPrev = document.getElementById('citasCalPrevMonth');
  var btnNext = document.getElementById('citasCalNextMonth');
  var btnVolver = document.getElementById('btnVolverCalendarioCitas');

  if (btnPrev) btnPrev.addEventListener('click', function() {
    _citasCalMesActual.setMonth(_citasCalMesActual.getMonth() - 1);
    cargarCitasCalendario();
  });
  if (btnNext) btnNext.addEventListener('click', function() {
    _citasCalMesActual.setMonth(_citasCalMesActual.getMonth() + 1);
    cargarCitasCalendario();
  });
  if (btnVolver) btnVolver.addEventListener('click', citasCalVolverAlMes);

  cargarCitasCalendario();
}

function _getCitasCalDoctorId() {
  // Si hay un doctor explícitamente seleccionado, usarlo
  if (typeof selectedDoctorId !== 'undefined' && selectedDoctorId) return selectedDoctorId;
  // Si el usuario actual es doctor, usar su propio ID
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor') return currentUser.id;
  // Para otros roles (recepción, admin, etc.) sin doctor seleccionado: null = mostrar todos
  return null;
}

async function cargarCitasCalendario() {
  var doctorId = _getCitasCalDoctorId();

  var mes = _citasCalMesActual.getFullYear() + '-' + String(_citasCalMesActual.getMonth() + 1).padStart(2, '0');
  var titulo = document.getElementById('citasCalMonthTitle');
  if (titulo) titulo.textContent = _MESES_ES[_citasCalMesActual.getMonth()] + ' ' + _citasCalMesActual.getFullYear();

  try {
    var url = '/api/turnos/calendario?mes=' + mes + (doctorId ? '&doctor_id=' + encodeURIComponent(doctorId) : '');
    var res = await apiFetch(url);
    var data = await res.json();

    _citasCalDatosCache = {};
    _citasCalDispCache = {};

    if (data.ok && Array.isArray(data.dias)) {
      data.dias.forEach(function(d) {
        var fechaStr = typeof d.fecha === 'string' ? d.fecha.substring(0, 10) : new Date(d.fecha).toISOString().substring(0, 10);
        _citasCalDatosCache[fechaStr] = {
          total: parseInt(d.total) || 0,
          agendadas: parseInt(d.agendadas) || 0,
          atendidas: parseInt(d.atendidas) || 0,
          no_asistieron: parseInt(d.no_asistieron) || 0,
          canceladas: parseInt(d.canceladas) || 0,
          reprogramadas: parseInt(d.reprogramadas) || 0
        };
      });
    }

    // Procesar disponibilidad del doctor
    if (data.disponibilidad && Array.isArray(data.disponibilidad)) {
      data.disponibilidad.forEach(function(d) {
        var fechaStr = typeof d.fecha === 'string' ? d.fecha.substring(0, 10) : new Date(d.fecha).toISOString().substring(0, 10);
        _citasCalDispCache[fechaStr] = parseInt(d.disponible) || 0;
      });
    }

    renderCitasCalGrid();
  } catch (e) {
    console.error('Error cargando calendario de citas:', e);
  }
}

function renderCitasCalGrid() {
  var grid = document.getElementById('citasCalGrid');
  if (!grid) return;

  var year = _citasCalMesActual.getFullYear();
  var month = _citasCalMesActual.getMonth();
  var hoy = new Date();
  var hoyStr = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');

  var startDay = new Date(year, month, 1).getDay() - 1;
  if (startDay < 0) startDay = 6;
  var diasEnMes = new Date(year, month + 1, 0).getDate();

  // Verificar si hay datos de disponibilidad cargados
  var hayDisponibilidad = Object.keys(_citasCalDispCache).length > 0;

  var html = '';
  _DIAS_SEMANA_CORTO.forEach(function(d) {
    html += '<div class="ccal-weekday">' + d + '</div>';
  });

  for (var i = 0; i < startDay; i++) {
    html += '<div class="ccal-cell ccal-empty"></div>';
  }

  for (var dia = 1; dia <= diasEnMes; dia++) {
    var fechaStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    var datos = _citasCalDatosCache[fechaStr] || null;
    var total = datos ? datos.total : 0;
    var esHoy = fechaStr === hoyStr;
    var esDomingo = new Date(year, month, dia).getDay() === 0;

    // Determinar si el día está bloqueado (doctor no disponible)
    var bloqueado = false;
    if (esDomingo) {
      bloqueado = true;
    } else if (hayDisponibilidad && _citasCalDispCache[fechaStr] === 0) {
      bloqueado = true;
    }

    // Colores: 0 → rojo, 1-10 → amarillo, >10 → verde
    var colorClass = 'ccal-rojo';
    if (bloqueado) {
      colorClass = 'ccal-bloqueado';
    } else if (total > 10) {
      colorClass = 'ccal-verde';
    } else if (total >= 1) {
      colorClass = 'ccal-amarillo';
    }

    var clickAttr = bloqueado ? '' : ' onclick="citasCalClickDia(\'' + fechaStr + '\', this)"';
    html += '<div class="ccal-cell ' + colorClass + (esHoy ? ' ccal-hoy' : '') + '"'
      + ' data-fecha="' + fechaStr + '"' + clickAttr + '>'
      + '<div class="ccal-dia-num">' + dia + '</div>'
      + '<div class="ccal-dia-info">';

    if (bloqueado && !datos) {
      html += '<span class="ccal-citas-label">No disponible</span>';
    } else if (total > 0) {
      html += '<span class="ccal-citas-count">' + total + '</span>'
        + '<span class="ccal-citas-label">cita' + (total !== 1 ? 's' : '') + '</span>';
    } else {
      html += '<span class="ccal-citas-label">Sin citas</span>';
    }

    // Barra indicadora inferior
    if (total > 0 && !bloqueado) html += '<span class="ccal-bar"></span>';

    html += '</div>';

    // Contadores de estados en esquina inferior
    if (datos && (datos.atendidas || datos.canceladas || datos.reprogramadas || datos.no_asistieron)) {
      html += '<div class="ccal-status-badges">';
      if (datos.atendidas > 0)
        html += '<span class="ccal-badge ccal-badge-atendida" title="Atendidas">' + datos.atendidas + '</span>';
      if (datos.canceladas > 0)
        html += '<span class="ccal-badge ccal-badge-cancelada" title="Canceladas">' + datos.canceladas + '</span>';
      if (datos.reprogramadas > 0)
        html += '<span class="ccal-badge ccal-badge-reprog" title="Reprogramadas">' + datos.reprogramadas + '</span>';
      if (datos.no_asistieron > 0)
        html += '<span class="ccal-badge ccal-badge-noasistio" title="No asistió">' + datos.no_asistieron + '</span>';
      html += '</div>';
    }

    html += '</div>';
  }

  var totalCells = startDay + diasEnMes;
  var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (var j = 0; j < remaining; j++) {
    html += '<div class="ccal-cell ccal-empty"></div>';
  }

  grid.innerHTML = html;
}

function citasCalClickDia(fechaStr, cellEl) {
  var calView = document.getElementById('agendaCalView');
  var dayView = document.getElementById('agendaDayView');
  if (!calView || !dayView) return;

  var fechaInput = document.getElementById('agendaMedicaFecha');
  if (fechaInput) {
    fechaInput.value = fechaStr;
    fechaInput.dispatchEvent(new Event('change'));
  }

  if (cellEl) cellEl.classList.add('ccal-cell-zooming');

  setTimeout(function() {
    calView.classList.add('agenda-cal-view-exit');
    dayView.classList.remove('agenda-day-view-hidden');
    dayView.classList.add('agenda-day-view-enter');

    setTimeout(function() {
      calView.style.display = 'none';
      calView.classList.remove('agenda-cal-view-exit');
      if (cellEl) cellEl.classList.remove('ccal-cell-zooming');
    }, 350);
  }, 200);
}

function citasCalVolverAlMes() {
  var calView = document.getElementById('agendaCalView');
  var dayView = document.getElementById('agendaDayView');
  if (!calView || !dayView) return;

  calView.style.display = '';
  calView.classList.add('agenda-cal-view-enter');
  dayView.classList.add('agenda-day-view-exit');

  setTimeout(function() {
    dayView.classList.remove('agenda-day-view-enter', 'agenda-day-view-exit');
    dayView.classList.add('agenda-day-view-hidden');
    calView.classList.remove('agenda-cal-view-enter');
    cargarCitasCalendario();
  }, 350);
}
