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
    return `${val.getUTCFullYear()}-${String(val.getUTCMonth() + 1).padStart(2, '0')}-${String(val.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

/** Suma minutos a fecha+hora calendario; devuelve hora_fin y hora_fin_date. */
function sumarMinutosAHoraYFecha(fechaYmd, horaHm, minutos) {
  const f = extraerFechaYmd(fechaYmd);
  const hora = String(horaHm || '').slice(0, 5);
  if (!f || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const [y, mo, d] = f.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const base = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const end = new Date(base + (parseInt(minutos, 10) || 0) * 60000);
  return {
    horaFin: `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`,
    fechaFin: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`
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
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Citas visibles en un día Y: agendadas ese día o estudios activos (En Estudio/Pausado)
 * cuyo rango [fecha, hora_fin_date] incluye Y.
 */
function sqlCitaElectroVisibleEnFecha(alias = 'c') {
  const a = alias;
  return `(
    ${a}.fecha = ?
    OR (
      ${a}.estado IN ('En Estudio', 'Pausado')
      AND ? >= ${a}.fecha
      AND ? <= COALESCE(${a}.hora_fin_date, ${a}.fecha)
    )
  )`;
}

function paramsCitaElectroVisibleEnFecha(fechaYmd) {
  return [fechaYmd, fechaYmd, fechaYmd];
}

/** Hora HH:MM desde hora_inicio, hora_agendamiento o columna TIME. */
function horaInicioCitaElectro(cita) {
  const raw = cita?.hora_inicio ?? cita?.hora_agendamiento;
  if (raw == null || raw === '') return null;
  const h = String(raw).trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(h) ? h : null;
}

/**
 * Fin programado del estudio (UTC calendario, sin TZ local).
 * Prioriza hora_inicio + duracion_minutos; si no hay duración, usa hora_fin + hora_fin_date.
 */
function finProgramadoCitaElectro(cita) {
  if (!cita) return null;
  const fechaInicio = extraerFechaYmd(cita.fecha);
  const horaInicio = horaInicioCitaElectro(cita);
  const durMin = parseInt(cita.duracion_minutos, 10);
  if (fechaInicio && horaInicio && durMin > 0) {
    return sumarMinutosAHoraYFecha(fechaInicio, horaInicio, durMin);
  }
  const fechaFin = extraerFechaYmd(cita.hora_fin_date) || fechaInicio;
  const horaFin = String(cita.hora_fin || '').trim().slice(0, 5);
  if (!fechaFin || !/^\d{2}:\d{2}$/.test(horaFin)) return null;
  return { horaFin, fechaFin };
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
  return `(
    CASE
      WHEN ${p}duracion_minutos > 0 AND ${p}hora_inicio IS NOT NULL THEN
        DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_inicio)), INTERVAL ${p}duracion_minutos MINUTE)
      WHEN ${p}duracion_minutos > 0 AND ${p}hora_agendamiento IS NOT NULL THEN
        DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_agendamiento)), INTERVAL ${p}duracion_minutos MINUTE)
      ELSE
        TIMESTAMP(COALESCE(${p}hora_fin_date, ${p}fecha), COALESCE(${p}hora_fin, '23:59:59'))
    END
  )`;
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

/** SQL: fin programado vencido — prioriza hora_inicio + duracion_minutos (igual que finProgramadoCitaElectro). */
function sqlEstudioElectroFinProgramadoVencido(alias) {
  const p = alias ? `${alias}.` : '';
  return `(
    CASE
      WHEN ${p}duracion_minutos > 0 AND ${p}hora_inicio IS NOT NULL THEN
        DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_inicio)), INTERVAL ${p}duracion_minutos MINUTE)
      WHEN ${p}duracion_minutos > 0 AND ${p}hora_agendamiento IS NOT NULL THEN
        DATE_ADD(TIMESTAMP(${p}fecha, TIME(${p}hora_agendamiento)), INTERVAL ${p}duracion_minutos MINUTE)
      ELSE
        TIMESTAMP(COALESCE(${p}hora_fin_date, ${p}fecha), COALESCE(${p}hora_fin, '23:59:59'))
    END
  ) < NOW()`;
}

module.exports = {
  extraerFechaYmd,
  sumarMinutosAHoraYFecha,
  fechaFinSiCruzaMedianoche,
  sqlCitaElectroVisibleEnFecha,
  paramsCitaElectroVisibleEnFecha,
  horaInicioCitaElectro,
  ymdLocal,
  horaInicioAgendadaParaInicioEstudio,
  horaInicioEfectivaParaInicioEstudio,
  finProgramadoCitaElectro,
  finProgramadoMsLocal,
  estudioElectroFinProgramadoVencido,
  inferirDuracionMinutosCitaElectro,
  calcularFinInicioEstudioElectro,
  sqlEstudioElectroFinProgramadoTs,
  sqlEstudioElectroFinProgramadoVencido
};
