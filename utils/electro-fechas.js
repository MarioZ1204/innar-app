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

module.exports = {
  extraerFechaYmd,
  sumarMinutosAHoraYFecha,
  fechaFinSiCruzaMedianoche,
  sqlCitaElectroVisibleEnFecha,
  paramsCitaElectroVisibleEnFecha
};
