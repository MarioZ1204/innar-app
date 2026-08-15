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

function fechaYmdOHoyColombia(raw) {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : hoyColombiaISO();
}

module.exports = { hoyColombiaISO, fechaYmdOHoyColombia };
