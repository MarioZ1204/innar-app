'use strict';

/**
 * Fecha civil en America/Bogota (UTC−5, sin DST).
 * Evita new Date().toISOString().slice(0, 10), que después de las 19:00
 * en Colombia ya es el día siguiente.
 */
function hoyColombiaISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

function horaColombiaHm(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value;
  const m = parts.find((p) => p.type === 'minute')?.value;
  if (h == null || m == null) return '';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function fechaYmdOHoyColombia(raw) {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : hoyColombiaISO();
}

function esMedianocheUtc(date) {
  return date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

/**
 * YYYY-MM-DD de un valor de cita/agenda:
 * - `YYYY-MM-DD` o datetime MySQL sin zona → el prefijo civil (como está en BD)
 * - Instant UTC (`Z` / offset) → fecha en Bogotá, salvo medianoche UTC (DATE de mysql2)
 */
function ymdCalendarioColombia(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    if (esMedianocheUtc(val)) return val.toISOString().slice(0, 10);
    return hoyColombiaISO(val);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mysqlLocal = s.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}/);
  const tieneZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || /GMT/i.test(s);
  if (mysqlLocal && !tieneZona) return mysqlLocal[1];
  const instant = new Date(s);
  if (Number.isNaN(instant.getTime())) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  if (esMedianocheUtc(instant)) return instant.toISOString().slice(0, 10);
  return hoyColombiaISO(instant);
}

module.exports = {
  hoyColombiaISO,
  horaColombiaHm,
  fechaYmdOHoyColombia,
  ymdCalendarioColombia
};
