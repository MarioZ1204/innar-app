/**
 * Fechas/horas de citas electro sin desfase por zona horaria.
 * Usar componentes de calendario (YYYY-MM-DD) en lugar de Date local/ISO.
 */

function extraerFechaYmd(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
  }
  return null;
}

/** Suma minutos a fecha+hora en calendario local (coherente con UI y TIMESTAMP MySQL). */
function sumarMinutosAHoraYFecha(fechaYmd, horaHm, minutos) {
  const f = extraerFechaYmd(fechaYmd);
  const hora = String(horaHm || '').slice(0, 5);
  if (!f || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const [y, mo, d] = f.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const base = new Date(y, mo - 1, d, hh, mm, 0);
  if (Number.isNaN(base.getTime())) return null;
  const end = new Date(base.getTime() + (parseInt(minutos, 10) || 0) * 60000);
  return {
    horaFin: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
    fechaFin: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  };
}

/** Si hora_fin < hora_inicio en el mismo día, el fin es al día siguiente. */
function fechaFinSiCruzaMedianoche(fechaYmd, horaInicio, horaFin) {
  const f = extraerFechaYmd(fechaYmd);
  if (!f || !horaInicio || !horaFin) return f;
  const [hi, mi] = String(horaInicio).slice(0, 5).split(':').map(Number);
  const [hf, mf] = String(horaFin).slice(0, 5).split(':').map(Number);
  if (hf * 60 + mf >= hi * 60 + mi) return f;
  const [y, mo, d] = f.split('-').map(Number);
  const next = new Date(y, mo - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD de fin programado (duración o hora_fin_date). */
function citaFechaFinYmd(cita) {
  const fin = finProgramadoCitaElectro(cita);
  if (fin?.fechaFin) return fin.fechaFin;
  return extraerFechaYmd(cita?.hora_fin_date) || extraerFechaYmd(cita?.fecha);
}

/** Cita visible en día D si D está en [fecha inicio, fecha fin] y no está cancelada. */
function citaVisibleEnFechaYmd(cita, fechaYmd) {
  if (!cita || cita.estado === 'Cancelado') return false;
  const inicio = extraerFechaYmd(cita.fecha);
  if (!inicio || !fechaYmd) return false;
  const fin = citaFechaFinYmd(cita) || inicio;
  return fechaYmd >= inicio && fechaYmd <= fin;
}

/**
 * Agenda del día: mult día en curso sigue visible en días intermedios;
 * Completado solo en la tabla del día de inicio (no en el día en que terminó).
 */
function citaVisibleEnAgendaDiaYmd(cita, fechaYmd) {
  if (!cita || cita.estado === 'Cancelado') return false;
  const inicio = extraerFechaYmd(cita.fecha);
  if (!inicio || !fechaYmd) return false;
  if (cita.estado === 'Completado') return fechaYmd === inicio;
  return citaVisibleEnFechaYmd(cita, fechaYmd);
}

function citaEsInicioEnFechaYmd(cita, fechaYmd) {
  return extraerFechaYmd(cita?.fecha) === fechaYmd;
}

function citaEsContinuacionEnFechaYmd(cita, fechaYmd) {
  return citaVisibleEnFechaYmd(cita, fechaYmd) && !citaEsInicioEnFechaYmd(cita, fechaYmd);
}

/**
 * Citas visibles en un día Y: cualquier estudio cuyo rango [fecha, fin] incluye Y.
 */
function sqlCitaElectroVisibleEnFecha(alias = 'c') {
  const a = alias;
  return `(
    ${a}.fecha <= ?
    AND COALESCE(${a}.hora_fin_date, ${a}.fecha) >= ?
    AND ${a}.estado <> 'Cancelado'
  )`;
}

function paramsCitaElectroVisibleEnFecha(fechaYmd) {
  return [fechaYmd, fechaYmd];
}

/** SQL agenda: Completado solo si fecha = día consultado; resto por rango mult día. */
function sqlCitaElectroVisibleEnAgendaDia(alias = 'c') {
  const a = alias;
  return `(
    (${a}.estado = 'Completado' AND ${a}.fecha = ?)
    OR (
      ${a}.estado NOT IN ('Completado', 'Cancelado')
      AND ${a}.fecha <= ?
      AND COALESCE(${a}.hora_fin_date, ${a}.fecha) >= ?
    )
  )`;
}

function paramsCitaElectroVisibleEnAgendaDia(fechaYmd) {
  return [fechaYmd, fechaYmd, fechaYmd];
}

/** Hora HH:MM desde hora_inicio, hora_agendamiento o columna TIME. */
function horaInicioCitaElectro(cita) {
  const raw = cita?.hora_inicio ?? cita?.hora_agendamiento;
  if (raw == null || raw === '') return null;
  const h = String(raw).trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(h) ? h : null;
}

/** Elige el fin más tardío entre dos candidatos (reapertura / reprogramación). */
function finProgramadoMasTardio(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const msA = finProgramadoMsLocal(a);
  const msB = finProgramadoMsLocal(b);
  if (msA == null) return b;
  if (msB == null) return a;
  return msB >= msA ? b : a;
}

/**
 * Fin programado del estudio (UTC calendario, sin TZ local).
 * Usa el fin más tardío entre (hora_inicio + duración) y (hora_fin_date + hora_fin).
 */
function finProgramadoCitaElectro(cita) {
  if (!cita) return null;
  const fechaInicio = extraerFechaYmd(cita.fecha);
  const horaInicio = horaInicioCitaElectro(cita);
  const durMin = parseInt(cita.duracion_minutos, 10);
  let finDesdeInicio = null;
  if (fechaInicio && horaInicio && durMin > 0) {
    finDesdeInicio = sumarMinutosAHoraYFecha(fechaInicio, horaInicio, durMin);
  }
  const fechaFin = extraerFechaYmd(cita.hora_fin_date) || fechaInicio;
  const horaFin = String(cita.hora_fin || '').trim().slice(0, 5);
  let finDesdeSlot = null;
  if (fechaFin && /^\d{2}:\d{2}$/.test(horaFin)) {
    finDesdeSlot = { horaFin, fechaFin };
  }
  const efectivo = finProgramadoMasTardio(finDesdeInicio, finDesdeSlot);
  if (efectivo) return efectivo;
  return finDesdeSlot;
}

/** Ms de fin programado en calendario local (coherente con TIMESTAMP MySQL / UI). */
function finProgramadoMsLocal(fin) {
  if (!fin?.fechaFin || !fin?.horaFin) return null;
  const [y, mo, d] = fin.fechaFin.split('-').map(Number);
  const [hh, mm] = fin.horaFin.split(':').map(Number);
  const t = new Date(y, mo - 1, d, hh, mm, 0).getTime();
  return Number.isNaN(t) ? null : t;
}

/** true si el fin programado ya pasó (hora local del servidor). */
function estudioElectroFinProgramadoVencido(cita, ahora = new Date()) {
  const fin = finProgramadoCitaElectro(cita);
  const finMs = finProgramadoMsLocal(fin);
  if (finMs == null) return false;
  return finMs <= ahora.getTime();
}

/** YYYY-MM-DD en hora local del servidor (coherente con agendar/iniciar en UI). */
function ymdLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hora programada (agendamiento) al iniciar sin cambiar hora — flujo «No» del modal. */
function horaInicioAgendadaParaInicioEstudio(cita) {
  const horaAg = String(cita?.hora_agendamiento || '').trim().slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(horaAg)) return horaAg;
  return horaInicioCitaElectro(cita);
}

/**
 * Hora de inicio al pasar a En Estudio: si hoy y la agendada ya pasó, usar hora actual.
 * Solo para flujo «Sí» / solicitud cuando no se envía hora_inicio explícita.
 */
function horaInicioEfectivaParaInicioEstudio(cita, ahora = new Date()) {
  const fechaBase = extraerFechaYmd(cita?.fecha);
  const horaAg = String(cita?.hora_agendamiento || '').trim().slice(0, 5);
  const horaIni = String(cita?.hora_inicio || '').trim().slice(0, 5);
  const base = /^\d{2}:\d{2}$/.test(horaIni) ? horaIni : horaAg;
  if (!/^\d{2}:\d{2}$/.test(base) || !fechaBase) return /^\d{2}:\d{2}$/.test(base) ? base : null;

  if (fechaBase !== ymdLocal(ahora)) return base;

  const horaAhora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const [ah, am] = horaAhora.split(':').map(Number);
  const [bh, bm] = base.split(':').map(Number);
  if (ah * 60 + am > bh * 60 + bm) return horaAhora;
  return base;
}

/**
 * Fin al pasar a En Estudio. Si inicio+duración ya venció, el fin se ancla a
 * hora efectiva (ahora si la agendada ya pasó) + duración completa.
 */
function calcularFinInicioEstudioElectro(fechaIni, horaIniStr, durMin, modoInicio, ahora = new Date()) {
  const dur = parseInt(durMin, 10);
  if (!extraerFechaYmd(fechaIni) || !/^\d{2}:\d{2}$/.test(String(horaIniStr || '').slice(0, 5)) || !(dur > 0)) {
    return null;
  }
  const horaIni = String(horaIniStr).slice(0, 5);
  const finDesdeInicio = sumarMinutosAHoraYFecha(fechaIni, horaIni, dur);
  if (!finDesdeInicio) return null;

  const citaTmp = {
    fecha: fechaIni,
    hora_inicio: horaIni,
    duracion_minutos: dur,
    hora_fin: finDesdeInicio.horaFin,
    hora_fin_date: finDesdeInicio.fechaFin
  };
  if (!estudioElectroFinProgramadoVencido(citaTmp, ahora)) {
    return {
      hora_inicio: horaIni,
      hora_fin: finDesdeInicio.horaFin,
      hora_fin_date: finDesdeInicio.fechaFin,
      duracion_minutos: dur
    };
  }

  const modo = String(modoInicio || '').trim().toLowerCase();
  const horaEfectiva = modo === 'agendado'
    ? horaInicioEfectivaParaInicioEstudio({ fecha: fechaIni, hora_agendamiento: horaIni }, ahora)
    : horaIni;
  const finDesdeEfectiva = sumarMinutosAHoraYFecha(fechaIni, horaEfectiva, dur);
  if (!finDesdeEfectiva) return null;
  return {
    hora_inicio: horaIni,
    hora_fin: finDesdeEfectiva.horaFin,
    hora_fin_date: finDesdeEfectiva.fechaFin,
    duracion_minutos: dur
  };
}

/** SQL: fin programado (inicio + duración o hora_fin) — para comparar con NOW(). */
function sqlEstudioElectroFinProgramadoTs(alias) {
  const p = alias ? `${alias}.` : '';
  const finDesdeInicio = `CASE
        WHEN ${p}duracion_minutos > 0 AND ${p}hora_inicio IS NOT NULL THEN
          DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_inicio)), INTERVAL ${p}duracion_minutos MINUTE)
        WHEN ${p}duracion_minutos > 0 AND ${p}hora_agendamiento IS NOT NULL THEN
          DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_agendamiento)), INTERVAL ${p}duracion_minutos MINUTE)
        ELSE NULL
      END`;
  const finDesdeSlot = `CASE
        WHEN ${p}hora_fin_date IS NOT NULL AND ${p}hora_fin IS NOT NULL THEN
          TIMESTAMP(${p}hora_fin_date, TIME(${p}hora_fin))
        ELSE NULL
      END`;
  return `(GREATEST(
    COALESCE(${finDesdeInicio}, '1970-01-01 00:00:00'),
    COALESCE(${finDesdeSlot}, '1970-01-01 00:00:00'),
    TIMESTAMP(COALESCE(${p}hora_fin_date, ${p}fecha), COALESCE(${p}hora_fin, '23:59:59'))
  ))`;
}

/** Minutos de duración: columna, catálogo implícito vía hora_agendamiento→hora_fin, o null. */
function inferirDuracionMinutosCitaElectro(cita) {
  const d = parseInt(cita?.duracion_minutos, 10);
  if (d > 0) return d;
  const fecha = extraerFechaYmd(cita?.fecha);
  const horaAg = String(cita?.hora_agendamiento || '').trim().slice(0, 5);
  const horaFin = String(cita?.hora_fin || '').trim().slice(0, 5);
  const fechaFin = extraerFechaYmd(cita?.hora_fin_date) || fecha;
  if (!fecha || !/^\d{2}:\d{2}$/.test(horaAg) || !/^\d{2}:\d{2}$/.test(horaFin)) return null;
  const inicioMs = finProgramadoMsLocal({ fechaFin: fecha, horaFin: horaAg });
  const finMs = finProgramadoMsLocal({ fechaFin, horaFin });
  if (inicioMs == null || finMs == null || finMs <= inicioMs) return null;
  return Math.round((finMs - inicioMs) / 60000);
}

/**
 * No inferir duración desde slot de agenda (ej. 30 min) si el estudio ya inició con hora_inicio real.
 * Evita auto-cierre prematuro de estudios largos En Estudio.
 */
function inferirDuracionMinutosCitaElectroParaPersistir(cita) {
  const activo = cita?.estado === 'En Estudio' || cita?.estado === 'Pausado';
  const tieneInicioReal = /^\d{2}:\d{2}/.test(String(cita?.hora_inicio || '').trim());
  if (activo && tieneInicioReal) return null;
  return inferirDuracionMinutosCitaElectro(cita);
}

/** SQL: fin programado vencido (misma lógica que finProgramadoCitaElectro). */
function sqlEstudioElectroFinProgramadoVencido(alias) {
  return `${sqlEstudioElectroFinProgramadoTs(alias)} < NOW()`;
}

/**
 * Auto-cierre hoy/en curso: solo si hay duracion_minutos y fin = inicio + duración.
 * Evita cerrar por hora_fin de agenda (slot 30 min) en estudios En Estudio largos.
 */
function sqlEstudioElectroFinProgramadoVencidoConDuracion(alias) {
  const p = alias ? `${alias}.` : '';
  return `(
    ${p}duracion_minutos > 0
    AND ${sqlEstudioElectroFinProgramadoTs(alias)} < NOW()
  )`;
}

module.exports = {
  extraerFechaYmd,
  sumarMinutosAHoraYFecha,
  fechaFinSiCruzaMedianoche,
  citaFechaFinYmd,
  citaVisibleEnFechaYmd,
  citaVisibleEnAgendaDiaYmd,
  citaEsInicioEnFechaYmd,
  citaEsContinuacionEnFechaYmd,
  sqlCitaElectroVisibleEnFecha,
  paramsCitaElectroVisibleEnFecha,
  sqlCitaElectroVisibleEnAgendaDia,
  paramsCitaElectroVisibleEnAgendaDia,
  horaInicioCitaElectro,
  ymdLocal,
  horaInicioAgendadaParaInicioEstudio,
  horaInicioEfectivaParaInicioEstudio,
  finProgramadoCitaElectro,
  finProgramadoMasTardio,
  finProgramadoMsLocal,
  estudioElectroFinProgramadoVencido,
  inferirDuracionMinutosCitaElectro,
  inferirDuracionMinutosCitaElectroParaPersistir,
  calcularFinInicioEstudioElectro,
  sqlEstudioElectroFinProgramadoTs,
  sqlEstudioElectroFinProgramadoVencido,
  sqlEstudioElectroFinProgramadoVencidoConDuracion
};
