/**
 * Lógica exclusiva del monitor de equipos: timeline 06:00–06:00, provisión virtual y colores por estudio.
 * No modifica equipo_id en BD ni reglas de cupo de agendamiento/inicio.
 */

const MONITOR_HORA_INICIO = 6;
const MONITOR_INICIO_MIN = MONITOR_HORA_INICIO * 60; // 360
const MONITOR_AXIS_TOTAL = 1440;

const ESTADOS_PROGRAMADOS_PROVISION = new Set([
  'Programado', 'Confirmado', 'En Sala', 'Reprogramado', 'Adelantado'
]);

const ESTADOS_EXCLUIDOS_MONITOR = new Set(['Cancelado']);

function monitorToHM(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function monitorToDateStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.length > 10 ? v.slice(0, 10) : v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function monitorParseMinutes(hm) {
  if (!hm) return 0;
  const [hh, mm] = String(hm).split(':').map((x) => parseInt(x, 10));
  return (hh || 0) * 60 + (mm || 0);
}

function addDaysToDateStr(fechaStr, days) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getMonitorWindow(fechaDia) {
  const start = new Date(`${fechaDia}T${String(MONITOR_HORA_INICIO).padStart(2, '0')}:00:00`);
  const end = new Date(start.getTime() + MONITOR_AXIS_TOTAL * 60000);
  const fechaFin = addDaysToDateStr(fechaDia, 1);
  return {
    start,
    end,
    fechaDia,
    fechaFin,
    inicio_hm: '06:00',
    fin_hm: '06:00',
    etiqueta: `${fechaDia} 06:00 – ${fechaFin} 06:00`
  };
}

function monitorBarKind(estado, esProvision) {
  if (esProvision) return 'provision';
  const s = (estado || '').toLowerCase();
  if (s === 'completado') return 'pasado';
  if (s === 'en estudio' || s === 'pausado') return 'activo';
  if (ESTADOS_PROGRAMADOS_PROVISION.has(estado)) return 'futuro';
  return 'otro';
}

const { tipoEstudioElectro } = require('./electro-estudio-tipo');

/** PSG → morado; EEG → amarillo; VTM → azul */
function monitorEstudioColorKey(estudio) {
  const tipo = tipoEstudioElectro(estudio);
  if (tipo === 'psg' || tipo === 'eeg' || tipo === 'vtm') return tipo;
  return 'otro';
}

function monitorCitaInterval(cita) {
  const fecha = monitorToDateStr(cita.fecha);
  const horaInicioStr = monitorToHM(cita.hora_inicio || cita.hora_agendamiento || '00:00') || '00:00';
  const [hiH, hiM] = horaInicioStr.split(':').map(Number);
  const start = new Date(`${fecha}T${String(hiH).padStart(2, '0')}:${String(hiM).padStart(2, '0')}:00`);

  let end;
  const dur = parseInt(cita.duracion_minutos, 10);
  if (dur > 0) {
    end = new Date(start.getTime() + dur * 60000);
  } else if (cita.hora_fin) {
    const fechaFin = monitorToDateStr(cita.hora_fin_date) || fecha;
    const [hfH, hfM] = monitorToHM(cita.hora_fin).split(':').map(Number);
    end = new Date(`${fechaFin}T${String(hfH).padStart(2, '0')}:${String(hfM).padStart(2, '0')}:00`);
    if (!cita.hora_fin_date && end <= start) end.setDate(end.getDate() + 1);
  } else {
    end = new Date(start.getTime() + 60 * 60000);
  }

  return { start, end };
}

function citaOverlapsMonitorWindow(cita, fechaDia) {
  const win = getMonitorWindow(fechaDia);
  const iv = monitorCitaInterval(cita);
  return iv.start < win.end && iv.end > win.start;
}

function dateToAxisMin(dt, windowStart) {
  const min = Math.round((dt.getTime() - windowStart.getTime()) / 60000);
  return Math.max(0, Math.min(MONITOR_AXIS_TOTAL, min));
}

function axisMinToHM(axisMin) {
  const clockMin = (axisMin + MONITOR_INICIO_MIN) % 1440;
  return `${String(Math.floor(clockMin / 60)).padStart(2, '0')}:${String(clockMin % 60).padStart(2, '0')}`;
}

function monitorCitaToTimelineSegment(cita, fechaDia, esProvision) {
  const win = getMonitorWindow(fechaDia);
  const iv = monitorCitaInterval(cita);
  if (iv.end <= win.start || iv.start >= win.end) return null;

  const clipStart = iv.start < win.start ? win.start : iv.start;
  const clipEnd = iv.end > win.end ? win.end : iv.end;
  const startMin = dateToAxisMin(clipStart, win.start);
  const endMin = dateToAxisMin(clipEnd, win.start);
  const span = Math.max(endMin - startMin, 5);

  const horaInicioStr = monitorToHM(cita.hora_inicio || cita.hora_agendamiento || '00:00') || '00:00';

  return {
    id: cita.id,
    estudio: cita.estudio,
    estado: cita.estado,
    paciente_nombre: cita.paciente_nombre,
    paciente_documento: cita.paciente_documento,
    entidad: cita.entidad,
    duracion_minutos: cita.duracion_minutos,
    hora_inicio: horaInicioStr,
    hora_fin: monitorToHM(cita.hora_fin) || axisMinToHM(endMin),
    start_min: startMin,
    end_min: endMin,
    left_pct: (startMin / MONITOR_AXIS_TOTAL) * 100,
    width_pct: (span / MONITOR_AXIS_TOTAL) * 100,
    bar_kind: monitorBarKind(cita.estado, esProvision),
    estudio_color: monitorEstudioColorKey(cita.estudio),
    es_provision: !!esProvision,
    equipo_id_real: cita.equipo_id || null
  };
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function assignProvisionToEquipos(citasProvision, equiposActivos, timelinesByEquipo, intervalsByEquipo, fechaConsulta) {
  const sinCupo = [];
  const sorted = [...citasProvision].sort((a, b) => {
    const ia = monitorCitaInterval(a);
    const ib = monitorCitaInterval(b);
    return ia.start - ib.start;
  });

  for (const cita of sorted) {
    const iv = monitorCitaInterval(cita);
    let placed = false;
    const equiposOrdenados = [...equiposActivos].sort((a, b) => {
      const la = (intervalsByEquipo[String(a.id)] || []).length;
      const lb = (intervalsByEquipo[String(b.id)] || []).length;
      return la - lb;
    });

    for (const eq of equiposOrdenados) {
      const eid = String(eq.id);
      const ocupados = intervalsByEquipo[eid] || [];
      const clash = ocupados.some((o) => intervalsOverlap(iv.start, iv.end, o.start, o.end));
      if (!clash) {
        const seg = monitorCitaToTimelineSegment(cita, fechaConsulta, true);
        if (!seg) continue;
        if (!timelinesByEquipo[eid]) timelinesByEquipo[eid] = [];
        if (!intervalsByEquipo[eid]) intervalsByEquipo[eid] = [];
        timelinesByEquipo[eid].push(seg);
        intervalsByEquipo[eid].push({ start: iv.start, end: iv.end });
        placed = true;
        break;
      }
    }
    if (!placed) sinCupo.push(cita);
  }

  return sinCupo;
}

function computeProximoHuecoLibre(timeline, esHoy, fechaConsulta) {
  if (!timeline || !timeline.length) return { hora: null, minuto: 0 };
  let maxEnd = 0;
  let tieneActivo = false;
  for (const seg of timeline) {
    if (seg.bar_kind === 'activo') tieneActivo = true;
    if (seg.end_min > maxEnd) maxEnd = seg.end_min;
  }
  if (tieneActivo) return { hora: null, minuto: maxEnd, ocupadoAhora: true };

  const win = getMonitorWindow(fechaConsulta);
  const now = new Date();
  let desde = maxEnd;
  if (esHoy && now >= win.start && now < win.end) {
    const nowAxis = dateToAxisMin(now, win.start);
    desde = Math.max(nowAxis, maxEnd);
  }
  if (desde >= MONITOR_AXIS_TOTAL) return { hora: null, minuto: MONITOR_AXIS_TOTAL, ocupadoAhora: false };
  return {
    hora: axisMinToHM(desde),
    minuto: desde,
    ocupadoAhora: false
  };
}

function buildMonitorEquiposView(citasDia, equipos, fechaConsulta, esHoy) {
  const equiposActivos = equipos.filter((eq) => eq.activo);
  const timelinesByEquipo = {};
  const intervalsByEquipo = {};
  const citasProvision = [];
  const citasEnVentana = citasDia.filter((c) => {
    if (ESTADOS_EXCLUIDOS_MONITOR.has(c.estado)) return false;
    return citaOverlapsMonitorWindow(c, fechaConsulta);
  });

  for (const c of citasEnVentana) {
    const tieneEquipo = c.equipo_id != null && c.equipo_id !== '' && Number(c.equipo_id) !== 0;

    if (tieneEquipo) {
      const eid = String(c.equipo_id);
      const seg = monitorCitaToTimelineSegment(c, fechaConsulta, false);
      if (!seg) continue;
      if (!timelinesByEquipo[eid]) timelinesByEquipo[eid] = [];
      timelinesByEquipo[eid].push(seg);
      const iv = monitorCitaInterval(c);
      if (!intervalsByEquipo[eid]) intervalsByEquipo[eid] = [];
      intervalsByEquipo[eid].push({ start: iv.start, end: iv.end });
    } else {
      citasProvision.push(c);
    }
  }

  const sinCupoProvision = assignProvisionToEquipos(
    citasProvision,
    equiposActivos,
    timelinesByEquipo,
    intervalsByEquipo,
    fechaConsulta
  );

  const mapCitaResumen = (c, extra = {}) => ({
    id: c.id,
    estudio: c.estudio,
    estado: c.estado,
    paciente_nombre: c.paciente_nombre,
    paciente_documento: c.paciente_documento,
    hora_inicio: monitorToHM(c.hora_inicio || c.hora_agendamiento),
    hora_fin: monitorToHM(c.hora_fin),
    hora_agendamiento: monitorToHM(c.hora_agendamiento),
    fecha: monitorToDateStr(c.fecha),
    hora_fin_date: monitorToDateStr(c.hora_fin_date),
    duracion_minutos: c.duracion_minutos,
    entidad: c.entidad,
    estudio_color: monitorEstudioColorKey(c.estudio),
    ...extra
  });

  const sinEquipoReal = citasEnVentana.filter((c) => {
    const tieneEquipo = c.equipo_id != null && c.equipo_id !== '' && Number(c.equipo_id) !== 0;
    return !tieneEquipo && (c.estado === 'En Estudio' || c.estado === 'Pausado');
  });

  const resultado = equipos.map((eq) => {
    const eid = String(eq.id);
    const timeline = (timelinesByEquipo[eid] || []).sort((a, b) => a.start_min - b.start_min);
    const hueco = computeProximoHuecoLibre(timeline, esHoy, fechaConsulta);
    const tieneActivo = timeline.some((s) => s.bar_kind === 'activo');
    const tieneProvision = timeline.some((s) => s.es_provision);
    const tieneReal = timeline.some((s) => !s.es_provision);

    let estadoFila = 'libre';
    if (!eq.activo) estadoFila = 'inactivo';
    else if (tieneActivo || hueco.ocupadoAhora) estadoFila = 'ocupado';
    else if (tieneProvision && !tieneReal) estadoFila = 'reservado';
    else if (timeline.length > 0) estadoFila = 'programado';

    const actual = timeline.find((s) => s.bar_kind === 'activo') || null;
    const proximo = timeline.find((s) => s.es_provision && (s.bar_kind === 'futuro' || s.bar_kind === 'provision')) ||
      timeline.find((s) => !s.es_provision && (s.bar_kind === 'futuro' || s.bar_kind === 'otro')) || null;

    const mapFromSeg = (seg, extra = {}) => (seg ? {
      id: seg.id,
      estudio: seg.estudio,
      estado: seg.estado,
      paciente_nombre: seg.paciente_nombre,
      paciente_documento: seg.paciente_documento,
      hora_inicio: seg.hora_inicio,
      hora_fin: seg.hora_fin,
      estudio_color: seg.estudio_color,
      es_provision: !!seg.es_provision,
      ...extra
    } : null);

    return {
      id: eq.id,
      nombre: eq.nombre,
      descripcion: eq.descripcion,
      activo: !!eq.activo,
      estudios_timeline: timeline,
      proximo_hueco_libre: hueco.hora,
      estado_fila: estadoFila,
      estudio_actual: mapFromSeg(actual),
      proximo_estudio: mapFromSeg(proximo)
    };
  });

  return {
    equipos: resultado,
    sin_equipo: sinEquipoReal.map((c) => mapCitaResumen(c)),
    sin_cupo_provision: sinCupoProvision.map((c) => mapCitaResumen(c, { es_provision: true })),
    ventana_horaria: getMonitorWindow(fechaConsulta),
    total_en_ventana: citasEnVentana.length
  };
}

/** Etiquetas de hora en el eje: 06:00 … 03:00 … 06:00 (+1 día) */
function monitorHourTickLabels() {
  return [
    { hour: 6, label: '06:00', axisMin: 0 },
    { hour: 9, label: '09:00', axisMin: 180 },
    { hour: 12, label: '12:00', axisMin: 360 },
    { hour: 15, label: '15:00', axisMin: 540 },
    { hour: 18, label: '18:00', axisMin: 720 },
    { hour: 21, label: '21:00', axisMin: 900 },
    { hour: 0, label: '00:00', axisMin: 1080 },
    { hour: 3, label: '03:00', axisMin: 1260 },
    { hour: 6, label: '06:00', axisMin: 1440, nextDay: true }
  ];
}

function monitorNowPct(fechaConsulta, esHoy) {
  if (!esHoy) return null;
  const win = getMonitorWindow(fechaConsulta);
  const now = new Date();
  if (now < win.start || now >= win.end) return null;
  return (dateToAxisMin(now, win.start) / MONITOR_AXIS_TOTAL) * 100;
}

module.exports = {
  MONITOR_HORA_INICIO,
  MONITOR_AXIS_TOTAL,
  ESTADOS_PROGRAMADOS_PROVISION,
  monitorToHM,
  monitorToDateStr,
  monitorEstudioColorKey,
  monitorCitaToTimelineSegment,
  citaOverlapsMonitorWindow,
  getMonitorWindow,
  monitorHourTickLabels,
  monitorNowPct,
  buildMonitorEquiposView
};
