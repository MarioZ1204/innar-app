/**
 * Capacidad electro: cupo = equipos activos.
 * - Agendar: solo citas En Estudio/Pausado consumen cupo (las programadas no bloquean).
 * - Iniciar: cupo por equipos realmente en uso ahora; con equipo asignado basta validar ese equipo.
 */

const ESTADOS_CUPO_ACTIVO = new Set(['En Estudio', 'Pausado']);

function sliceDate10(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

function sliceHora5(v) {
  if (!v) return '00:00';
  return String(v).trim().slice(0, 5);
}

function parseCitaElectroInterval(cita) {
  const fecha = sliceDate10(cita.fecha);
  const esActiva = ESTADOS_CUPO_ACTIVO.has(cita.estado);
  const horaIni = sliceHora5(
    esActiva
      ? (cita.hora_inicio || cita.hora_agendamiento || '00:00')
      : (cita.hora_agendamiento || cita.hora_inicio || '00:00')
  );
  const [hiH, hiM] = horaIni.split(':').map((x) => parseInt(x, 10));
  const start = new Date(`${fecha}T${String(hiH).padStart(2, '0')}:${String(hiM).padStart(2, '0')}:00`);

  if (cita.duracion_minutos && parseInt(cita.duracion_minutos, 10) > 0) {
    const end = new Date(start.getTime() + parseInt(cita.duracion_minutos, 10) * 60000);
    return { start, end };
  }

  const horaFin = sliceHora5(cita.hora_fin || horaIni);
  const fechaFin = cita.hora_fin_date ? sliceDate10(cita.hora_fin_date) : fecha;
  const [hfH, hfM] = horaFin.split(':').map((x) => parseInt(x, 10));
  let end = new Date(`${fechaFin}T${String(hfH).padStart(2, '0')}:${String(hfM).padStart(2, '0')}:00`);
  if (!cita.hora_fin_date && end <= start) {
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

function peakConcurrentCitasElectro(citas, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) return 0;
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();
  const events = [];

  for (const c of citas || []) {
    const { start, end } = parseCitaElectroInterval(c);
    const s = Math.max(start.getTime(), rs);
    const e = Math.min(end.getTime(), re);
    if (e <= s) continue;
    events.push({ t: s, d: 1 });
    events.push({ t: e, d: -1 });
  }

  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let peak = 0;
  for (const ev of events) {
    cur += ev.d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

function filterCitasCupoActivo(citas) {
  return (citas || []).filter((c) => ESTADOS_CUPO_ACTIVO.has(c.estado));
}

function hayCupoElectroParaRango(citas, rangeStart, rangeEnd, maxCupos) {
  const max = Math.max(0, parseInt(maxCupos, 10) || 0);
  if (max === 0) return { ok: false, peak: 0, maxCupos: 0, disponibles: 0 };
  const peak = peakConcurrentCitasElectro(citas, rangeStart, rangeEnd);
  return { ok: peak < max, peak, maxCupos: max, disponibles: Math.max(0, max - peak) };
}

/** Agendar / disponibilidad: solo estudios ya iniciados (o pausados) consumen cupo. */
function hayCupoElectroParaAgendar(citas, rangeStart, rangeEnd, maxCupos) {
  const activas = filterCitasCupoActivo(citas);
  const check = hayCupoElectroParaRango(activas, rangeStart, rangeEnd, maxCupos);
  return { ...check, citasConsideradas: activas.length };
}

/** Iniciar estudio: equipos en uso en este instante. */
function hayCupoElectroParaIniciar(citas, atInstant, maxCupos) {
  const max = Math.max(0, parseInt(maxCupos, 10) || 0);
  if (max === 0) return { ok: false, peak: 0, maxCupos: 0, disponibles: 0 };
  const t = (atInstant instanceof Date ? atInstant : new Date()).getTime();
  const instantEnd = new Date(t + 60000);
  const activas = filterCitasCupoActivo(citas);
  const peak = peakConcurrentCitasElectro(activas, new Date(t), instantEnd);
  return { ok: peak < max, peak, maxCupos: max, disponibles: Math.max(0, max - peak) };
}

module.exports = {
  ESTADOS_CUPO_ACTIVO,
  parseCitaElectroInterval,
  peakConcurrentCitasElectro,
  filterCitasCupoActivo,
  hayCupoElectroParaRango,
  hayCupoElectroParaAgendar,
  hayCupoElectroParaIniciar
};
