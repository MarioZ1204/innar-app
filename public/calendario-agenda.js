/**
 * Calendario mensual de citas (Ver Citas) — cuenta CITAS/LIBRES por día.
 * Si hay cupos por entidad programados, la capacidad es la suma de esos cupos.
 */
let _citasCalAno = (new Date()).getFullYear();
let _citasCalMes = (new Date()).getMonth();
let _citasCalDatosCache = {};
let _citasCalDispCache = {};
let _citasCalSlotsCache = {};
/** @type {Record<string, { capacidad: number, ocupados: number, libres: number, resumen: object[] }>} */
let _citasCalCuposCache = {};
let _citasCalIniciado = false;

const _MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const _DIAS_SEMANA_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function initCitasCalendario() {
  const calView = document.getElementById('agendaCalView');
  const dayView = document.getElementById('agendaDayView');
  if (calView) {
    calView.style.display = '';
    calView.classList.remove('agenda-cal-view-exit', 'agenda-cal-view-enter');
  }
  if (dayView) {
    dayView.classList.remove('agenda-day-view-enter', 'agenda-day-view-exit');
    dayView.classList.add('agenda-day-view-hidden');
  }

  const prevBtn = document.getElementById('citasCalPrevMonth');
  const nextBtn = document.getElementById('citasCalNextMonth');
  const btnVolver = document.getElementById('btnVolverCalendarioCitas');

  if (prevBtn) {
    const clone = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(clone, prevBtn);
    clone.addEventListener('click', () => {
      _citasCalMes -= 1;
      if (_citasCalMes < 0) { _citasCalMes = 11; _citasCalAno -= 1; }
      cargarCitasCalendario();
    });
  }
  if (nextBtn) {
    const clone = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(clone, nextBtn);
    clone.addEventListener('click', () => {
      _citasCalMes += 1;
      if (_citasCalMes > 11) { _citasCalMes = 0; _citasCalAno += 1; }
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
  if (typeof selectedDoctorId !== 'undefined' && selectedDoctorId) return selectedDoctorId;
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor') return currentUser.id;
  return null;
}

function _fmtFechaCal(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

function _textoCuposEntidadObs(resumen) {
  if (!Array.isArray(resumen) || !resumen.length) return '';
  return resumen.map((r) => {
    const nom = String(r.entidad || '').trim();
    const occ = parseInt(r.ocupados, 10) || 0;
    const max = parseInt(r.cupo_max, 10) || 0;
    const lib = parseInt(r.libres, 10);
    const libres = Number.isFinite(lib) ? lib : Math.max(0, max - occ);
    const abrev = nom.length > 12 ? `${nom.slice(0, 10)}…` : nom;
    return `${abrev} ${occ}/${max} (${libres} disp.)`;
  }).join(' · ');
}

function _abrevEntidadCal(nom, maxLen = 10) {
  const s = String(nom || '').trim();
  if (!s) return 'Ent.';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function _calcMetricasSplit(citasGeneral, capHoraria, cuposDia) {
  const resumen = (cuposDia && Array.isArray(cuposDia.resumen)) ? cuposDia.resumen : [];
  if (!resumen.length) return null;

  const occProgramados = resumen.reduce((s, r) => s + (parseInt(r.ocupados, 10) || 0), 0);
  return {
    izquierda: {
      citas: Math.max(0, citasGeneral - occProgramados),
      libres: Math.max(0, capHoraria - citasGeneral)
    },
    entidades: resumen.map((r) => ({
      entidad: String(r.entidad || '').trim() || 'Entidad',
      citas: parseInt(r.ocupados, 10) || 0,
      libres: parseInt(r.libres, 10) ?? Math.max(0, (parseInt(r.cupo_max, 10) || 0) - (parseInt(r.ocupados, 10) || 0))
    }))
  };
}

function _htmlPanelMetricas(citas, libres, extraClass) {
  return `<div class="ccal-split-metrics${extraClass ? ` ${extraClass}` : ''}">`
    + `<div class="ccal-card-metric ccal-card-metric-citas"><span class="ccal-card-num">${citas}</span><span class="ccal-card-label">CITAS</span></div>`
    + `<div class="ccal-card-metric ccal-card-metric-libres"><span class="ccal-card-num">${libres}</span><span class="ccal-card-label">LIBRES</span></div>`
    + '</div>';
}

function _htmlMetricasTop(citasGeneral, capHoraria, cuposDia) {
  const libresGeneral = Math.max(0, capHoraria - citasGeneral);
  const split = _calcMetricasSplit(citasGeneral, capHoraria, cuposDia);
  if (!split) {
    return `<div class="ccal-card-top">${_htmlPanelMetricas(citasGeneral, libresGeneral)}</div>`;
  }

  const entHtml = split.entidades.map((e) => {
    const abrev = _abrevEntidadCal(e.entidad);
    return `<div class="ccal-ent-block" title="${escapeHtml(e.entidad)}">`
      + `<span class="ccal-ent-title">${escapeHtml(abrev)}</span>`
      + _htmlPanelMetricas(e.citas, e.libres, 'ccal-split-metrics-ent')
      + '</div>';
  }).join('');

  return '<div class="ccal-card-top ccal-card-top-split">'
    + `<div class="ccal-split-panel ccal-split-general">${_htmlPanelMetricas(split.izquierda.citas, split.izquierda.libres)}</div>`
    + `<div class="ccal-split-panel ccal-split-entidad">${entHtml}</div>`
    + '</div>';
}

async function cargarCitasCalendario() {
  const doctorId = _getCitasCalDoctorId();
  const mes = `${_citasCalAno}-${String(_citasCalMes + 1).padStart(2, '0')}`;
  const titleEl = document.getElementById('citasCalMonthTitle');
  if (titleEl) titleEl.textContent = `${_MESES_ES[_citasCalMes]} ${_citasCalAno}`;

  try {
    const url = `/api/turnos/calendario?mes=${mes}${doctorId ? `&doctor_id=${encodeURIComponent(doctorId)}` : ''}`;
    const res = await apiFetch(url);
    const body = await res.json();

    _citasCalDatosCache = {};
    _citasCalDispCache = {};
    _citasCalSlotsCache = {};
    _citasCalCuposCache = {};

    if (body.ok && Array.isArray(body.dias)) {
      body.dias.forEach((d) => {
        const f = _fmtFechaCal(d.fecha);
        _citasCalDatosCache[f] = {
          total: parseInt(d.total, 10) || 0,
          agendadas: parseInt(d.agendadas, 10) || 0,
          atendidas: parseInt(d.atendidas, 10) || 0,
          no_asistieron: parseInt(d.no_asistieron, 10) || 0,
          canceladas: parseInt(d.canceladas, 10) || 0,
          reprogramadas: parseInt(d.reprogramadas, 10) || 0
        };
      });
    }

    if (body.disponibilidad && Array.isArray(body.disponibilidad)) {
      body.disponibilidad.forEach((d) => {
        const f = _fmtFechaCal(d.fecha);
        _citasCalDispCache[f] = {
          disponible: parseInt(d.disponible, 10),
          motivo: d.motivo_ausencia || null,
          manana: d.disponible_manana != null ? parseInt(d.disponible_manana, 10) : 1,
          tarde: d.disponible_tarde != null ? parseInt(d.disponible_tarde, 10) : 1,
          total: parseInt(d.total_pacientes, 10) || 0
        };
      });
    }

    if (body.cupos_resumen_dia && Array.isArray(body.cupos_resumen_dia)) {
      body.cupos_resumen_dia.forEach((row) => {
        const f = _fmtFechaCal(row.fecha);
        _citasCalCuposCache[f] = {
          capacidad: parseInt(row.capacidad, 10) || 0,
          ocupados: parseInt(row.ocupados, 10) || 0,
          libres: parseInt(row.libres, 10) || 0,
          resumen: Array.isArray(row.resumen) ? row.resumen : []
        };
      });
    }

    if (doctorId) {
      try {
        const rSlots = await apiFetch(`/api/doctor-agenda?doctor_id=${encodeURIComponent(doctorId)}&_t=${Date.now()}`);
        const slots = await rSlots.json();
        if (Array.isArray(slots)) {
          slots.forEach((s) => {
            if (!s || !s.disponible) return;
            const f = (s.fecha || '').slice(0, 10);
            if (!_citasCalSlotsCache[f]) _citasCalSlotsCache[f] = [];
            _citasCalSlotsCache[f].push(s);
          });
        }
      } catch (e) {
        console.warn('Error cargando slots del calendario de citas:', e.message || e);
      }
    }

    renderCitasCalGrid();
  } catch (e) {
    console.error('Error cargando calendario de citas:', e);
  }
}

function renderCitasCalGrid() {
  const grid = document.getElementById('citasCalGrid');
  if (!grid) return;

  const year = _citasCalAno;
  const month = _citasCalMes;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let startWeekday = new Date(year, month, 1).getDay() - 1;
  if (startWeekday < 0) startWeekday = 6;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const hayDispConfig = Object.keys(_citasCalDispCache).length > 0;

  let html = '';
  _DIAS_SEMANA_CORTO.forEach((d) => { html += `<div class="ccal-weekday">${d}</div>`; });

  for (let i = 0; i < startWeekday; i++) {
    html += '<div class="ccal-cell ccal-empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const datos = _citasCalDatosCache[fecha] || null;
    const cuposDia = _citasCalCuposCache[fecha] || null;
    const esHoy = fecha === todayStr;
    const esDomingo = new Date(year, month, day).getDay() === 0;
    const disp = _citasCalDispCache[fecha] || null;

    let bloqueado = false;
    let motivo = null;
    if (esDomingo || (hayDispConfig && disp && disp.disponible === 0)) bloqueado = true;
    if (disp) motivo = disp.motivo || null;

    const esUcqn = motivo === 'UCQN';
    const tieneMotivo = motivo && motivo !== '';

    const intervalMin = (typeof selectedDoctorEspecialidad !== 'undefined' && selectedDoctorEspecialidad
      && ((selectedDoctorEspecialidad || '').toLowerCase().includes('neurolog')
        || (selectedDoctorEspecialidad || '').toLowerCase().includes('epileptolog'))) ? 25 : 40;

    const slots = _citasCalSlotsCache[fecha] || [];
    const slotKeys = slots.map((s) => `${(s.hora_inicio || '').slice(0, 5)}-${(s.hora_fin || '').slice(0, 5)}`).sort();

    let capHoraria = 0;
    if (intervalMin === 25 && (slotKeys.includes('08:00-12:00') || slotKeys.includes('14:00-18:00'))) {
      capHoraria = (slotKeys.includes('08:00-12:00') ? 11 : 0) + (slotKeys.includes('14:00-18:00') ? 11 : 0);
    } else if (disp && disp.total > 0) {
      capHoraria = disp.total;
    } else if (capHoraria === 0 && slotKeys.length > 0) {
      capHoraria = slots.reduce((acc, s) => {
        const t0 = (s.hora_inicio || '00:00').split(':').map(Number);
        const t1 = (s.hora_fin || '00:00').split(':').map(Number);
        return acc + Math.max(0, Math.floor((60 * t1[0] + t1[1] - 60 * t0[0] - t0[1]) / intervalMin));
      }, 0);
    } else if (disp && !bloqueado) {
      capHoraria = (disp.manana !== 0 ? Math.floor(240 / intervalMin) : 0)
        + (disp.tarde !== 0 ? Math.floor(240 / intervalMin) : 0);
    }

    const EGeneral = datos ? (datos.agendadas + datos.atendidas + datos.no_asistieron) : 0;

    const citasCount = EGeneral;
    const libresCount = Math.max(0, capHoraria - citasCount);
    let obsCupos = '';
    const tieneCuposEntidad = !!(cuposDia && cuposDia.capacidad > 0
      && Array.isArray(cuposDia.resumen) && cuposDia.resumen.length);

    if (tieneCuposEntidad) {
      obsCupos = _textoCuposEntidadObs(cuposDia.resumen);
    }

    const E = citasCount;
    const T = libresCount;
    const splitInfo = tieneCuposEntidad ? _calcMetricasSplit(citasCount, capHoraria, cuposDia) : null;

    let tooltip = `Citas: ${citasCount} | Libres horario: ${libresCount}`;
    if (splitInfo) {
      tooltip += ` | Otras citas: ${splitInfo.izquierda.citas} | Otras libres: ${splitInfo.izquierda.libres}`;
      splitInfo.entidades.forEach((e) => {
        tooltip += ` | ${e.entidad}: ${e.citas} citas, ${e.libres} libres`;
      });
    }
    if (datos && datos.atendidas) tooltip += ` | Atendidas: ${datos.atendidas}`;
    if (datos && datos.no_asistieron) tooltip += ` | No asist.: ${datos.no_asistieron}`;
    if (datos && datos.canceladas) tooltip += ` | Canceladas: ${datos.canceladas}`;
    if (datos && datos.reprogramadas) tooltip += ` | Reprog.: ${datos.reprogramadas}`;
    if (obsCupos) tooltip += ` | ${obsCupos}`;

    let obsTexto = (tieneCuposEntidad ? '' : obsCupos) || (tieneMotivo
      ? (motivo.length > 26 ? `${motivo.slice(0, 24)}…` : motivo)
      : (bloqueado ? 'NO DISPONIBLE' : (tieneCuposEntidad ? '' : 'Sin observación')));

    let colorClass = 'ccal-neutro';
    const totalDia = datos ? datos.total : 0;

    if (!bloqueado && esUcqn) {
      colorClass = E > 10 ? 'ccal-verde' : 'ccal-ucqn';
    } else if (bloqueado && esUcqn) {
      colorClass = 'ccal-ucqn';
    } else if (bloqueado && tieneMotivo) {
      colorClass = 'ccal-noasiste';
    } else if (bloqueado) {
      colorClass = 'ccal-bloqueado';
    } else if (datos && ((datos.no_asistieron > 0) || (datos.canceladas > 0))) {
      colorClass = 'ccal-rojo';
    } else if (datos && datos.reprogramadas > 0) {
      colorClass = 'ccal-azul';
    } else if (E > 10 || totalDia > 10) {
      colorClass = 'ccal-verde';
    } else if (E >= 1 || totalDia >= 1) {
      colorClass = 'ccal-amarillo';
    }

    const clickable = !bloqueado || tieneMotivo;
    const splitClass = tieneCuposEntidad ? ' ccal-cell-split' : '';
    html += `<div class="ccal-cell ${colorClass}${esHoy ? ' ccal-hoy' : ''}${splitClass}" data-fecha="${fecha}" title="${escapeHtml(tooltip)}"${clickable ? ` onclick="citasCalClickDia('${fecha}', this)"` : ''}>`;
    html += `<div class="ccal-dia-num">${day}</div>`;
    html += '<div class="ccal-dia-info ccal-dia-info-split">';
    html += _htmlMetricasTop(citasCount, capHoraria, tieneCuposEntidad ? cuposDia : null);
    html += `<div class="ccal-card-bottom"><span class="ccal-card-observacion${obsTexto || tieneMotivo || bloqueado ? '' : ' ccal-card-observacion-empty'}"${tieneMotivo && !obsCupos ? ` title="${escapeHtml(motivo)}"` : ''}>${escapeHtml(obsTexto)}</span></div>`;
    html += '</div>';

    if (!esUcqn && !bloqueado && datos && (datos.atendidas || datos.canceladas || datos.reprogramadas || datos.no_asistieron)) {
      html += '<div class="ccal-status-badges">';
      if (datos.atendidas > 0) html += `<span class="ccal-badge ccal-badge-atendida" title="Atendidas">${datos.atendidas}</span>`;
      if (datos.canceladas > 0) html += `<span class="ccal-badge ccal-badge-cancelada" title="Canceladas">${datos.canceladas}</span>`;
      if (datos.reprogramadas > 0) html += `<span class="ccal-badge ccal-badge-reprog" title="Reprogramadas">${datos.reprogramadas}</span>`;
      if (datos.no_asistieron > 0) html += `<span class="ccal-badge ccal-badge-noasistio" title="No asistió">${datos.no_asistieron}</span>`;
      html += '</div>';
    }
    html += '</div>';
  }

  const totalCells = startWeekday + daysInMonth;
  const trailing = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 0; i < trailing; i++) {
    html += '<div class="ccal-cell ccal-empty"></div>';
  }

  grid.innerHTML = html;
}

function citasCalClickDia(fecha, el) {
  const calView = document.getElementById('agendaCalView');
  const dayView = document.getElementById('agendaDayView');
  if (!calView || !dayView) return;

  const fechaInput = document.getElementById('agendaMedicaFecha');
  if (fechaInput) {
    fechaInput.value = fecha;
    fechaInput.dispatchEvent(new Event('change'));
  }
  if (el) el.classList.add('ccal-cell-zooming');
  setTimeout(() => {
    calView.classList.add('agenda-cal-view-exit');
    dayView.classList.remove('agenda-day-view-hidden');
    dayView.classList.add('agenda-day-view-enter');
    setTimeout(() => {
      calView.style.display = 'none';
      calView.classList.remove('agenda-cal-view-exit');
      if (el) el.classList.remove('ccal-cell-zooming');
    }, 350);
  }, 200);
}

function citasCalVolverAlMes() {
  const calView = document.getElementById('agendaCalView');
  const dayView = document.getElementById('agendaDayView');
  if (!calView || !dayView) return;
  calView.style.display = '';
  calView.classList.add('agenda-cal-view-enter');
  dayView.classList.add('agenda-day-view-exit');
  setTimeout(() => {
    dayView.classList.remove('agenda-day-view-enter', 'agenda-day-view-exit');
    dayView.classList.add('agenda-day-view-hidden');
    calView.classList.remove('agenda-cal-view-enter');
    cargarCitasCalendario();
  }, 350);
}
