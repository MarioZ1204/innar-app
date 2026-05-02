// calendario-agenda.js - Calendario mensual integrado en Ver Citas de Agenda Medica

let _citasCalAno = new Date().getFullYear();
let _citasCalMes = new Date().getMonth(); // 0-based
let _citasCalDatosCache = {};
let _citasCalDispCache = {}; // { 'YYYY-MM-DD': { disponible: 0|1, motivo: string|null } }
let _citasCalIniciado = false;

const _MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const _DIAS_SEMANA_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

function initCitasCalendario() {
  var calView = document.getElementById('agendaCalView');
  var dayView = document.getElementById('agendaDayView');
  if (calView) { calView.style.display = ''; calView.classList.remove('agenda-cal-view-exit','agenda-cal-view-enter'); }
  if (dayView) { dayView.classList.remove('agenda-day-view-enter','agenda-day-view-exit'); dayView.classList.add('agenda-day-view-hidden'); }

  // Reasignar listeners usando replaceWith para evitar duplicados
  var btnPrev = document.getElementById('citasCalPrevMonth');
  var btnNext = document.getElementById('citasCalNextMonth');
  var btnVolver = document.getElementById('btnVolverCalendarioCitas');

  if (btnPrev) {
    var newPrev = btnPrev.cloneNode(true);
    btnPrev.parentNode.replaceChild(newPrev, btnPrev);
    newPrev.addEventListener('click', function() {
      _citasCalMes--;
      if (_citasCalMes < 0) { _citasCalMes = 11; _citasCalAno--; }
      cargarCitasCalendario();
    });
  }
  if (btnNext) {
    var newNext = btnNext.cloneNode(true);
    btnNext.parentNode.replaceChild(newNext, btnNext);
    newNext.addEventListener('click', function() {
      _citasCalMes++;
      if (_citasCalMes > 11) { _citasCalMes = 0; _citasCalAno++; }
      cargarCitasCalendario();
    });
  }
  if (btnVolver && !_citasCalIniciado) {
    btnVolver.addEventListener('click', citasCalVolverAlMes);
  }

  _citasCalIniciado = true;
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

  var mes = _citasCalAno + '-' + String(_citasCalMes + 1).padStart(2, '0');
  var titulo = document.getElementById('citasCalMonthTitle');
  if (titulo) titulo.textContent = _MESES_ES[_citasCalMes] + ' ' + _citasCalAno;

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

    // Procesar disponibilidad del doctor (incluye motivo_ausencia)
    if (data.disponibilidad && Array.isArray(data.disponibilidad)) {
      data.disponibilidad.forEach(function(d) {
        var fechaStr = typeof d.fecha === 'string' ? d.fecha.substring(0, 10) : new Date(d.fecha).toISOString().substring(0, 10);
        _citasCalDispCache[fechaStr] = {
          disponible: parseInt(d.disponible),
          motivo: d.motivo_ausencia || null
        };
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

  var year = _citasCalAno;
  var month = _citasCalMes;
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

    // Determinar disponibilidad y observación
    var dispInfo = _citasCalDispCache[fechaStr] || null;
    var bloqueado = false;
    var observacion = null;
    if (esDomingo) {
      bloqueado = true;
    } else if (hayDisponibilidad && dispInfo && dispInfo.disponible === 0) {
      bloqueado = true;
    }
    if (dispInfo) observacion = dispInfo.motivo || null;

    var esUCQN = observacion === 'UCQN';
    var tieneObservacion = observacion && observacion !== '';

    // Colores por estado de agenda
    var colorClass = 'ccal-rojo';
    if (!bloqueado && esUCQN) {
      // Doctor asiste pero en UCQN → azul
      colorClass = total > 10 ? 'ccal-verde' : (total >= 1 ? 'ccal-ucqn' : 'ccal-ucqn');
    } else if (bloqueado && esUCQN) {
      // Doctor no asiste pero está en UCQN → azul bloqueado
      colorClass = 'ccal-ucqn';
    } else if (bloqueado && tieneObservacion) {
      colorClass = 'ccal-noasiste';
    } else if (bloqueado) {
      colorClass = 'ccal-bloqueado';
    } else if (datos && ((datos.no_asistieron || 0) > 0 || (datos.canceladas || 0) > 0)) {
      colorClass = 'ccal-rojo';
    } else if (datos && (datos.reprogramadas || 0) > 0) {
      colorClass = 'ccal-azul';
    } else if (total > 10) {
      colorClass = 'ccal-verde';
    } else if (total >= 1) {
      colorClass = 'ccal-amarillo';
    }

    // Días con observación son clickables incluso si bloqueado
    var clickable = !bloqueado || tieneObservacion;
    var clickAttr = clickable ? ' onclick="citasCalClickDia(\'' + fechaStr + '\', this)"' : '';

    html += '<div class="ccal-cell ' + colorClass + (esHoy ? ' ccal-hoy' : '') + '"'
      + ' data-fecha="' + fechaStr + '"' + clickAttr + '>'
      + '<div class="ccal-dia-num">' + dia + '</div>'
      + '<div class="ccal-dia-info">';

    if (tieneObservacion) {
      // Mostrar texto diagonal de la observación
      var obsTexto = observacion.length > 18 ? observacion.substring(0, 16) + '…' : observacion;
      html += '<div class="ccal-motivo-diagonal" title="' + escapeHtml(observacion) + '">' + escapeHtml(obsTexto) + '</div>';
      if (total > 0) {
        html += '<span class="ccal-corner-count" title="' + total + ' cita' + (total !== 1 ? 's' : '') + '">' + total + '</span>';
      } else if (!bloqueado) {
        html += '<span class="ccal-citas-label" style="font-size:0.6rem;opacity:0.7">Sin citas</span>';
      }
    } else if (bloqueado && !datos) {
      html += '<span class="ccal-citas-label">No disponible</span>';
    } else if (total > 0) {
      html += '<span class="ccal-citas-count">' + total + '</span>'
        + '<span class="ccal-citas-label">cita' + (total !== 1 ? 's' : '') + '</span>';
    } else {
      html += '<span class="ccal-citas-label">Sin citas</span>';
    }

    // Barra indicadora inferior (solo para días con citas no bloqueados)
    if (total > 0 && !bloqueado) html += '<span class="ccal-bar"></span>';

    html += '</div>';

    // Contadores de estados en esquina inferior (solo para días disponibles, sin UCQN)
    if (!esUCQN && !bloqueado && datos && (datos.atendidas || datos.canceladas || datos.reprogramadas || datos.no_asistieron)) {
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
