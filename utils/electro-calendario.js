/**
 * Agregación mensual para calendario electro (misma visibilidad que agenda del día).
 */
const { extraerFechaYmd } = require('./electro-fechas');
const { monitorEstudioColorKey } = require('./electro-monitor');

const TIPOS_CALENDARIO = ['psg', 'eeg', 'vtm', 'actigrafia', 'otro'];

const ESTADOS_EXCLUIDOS_CAL = new Set(['Cancelado']);

function emptyPorTipo() {
  return { psg: 0, eeg: 0, vtm: 0, actigrafia: 0, otro: 0 };
}

/** Misma regla que sqlCitaElectroVisibleEnFecha */
function citaVisibleEnDiaAgenda(cita, fechaYmd) {
  const inicio = extraerFechaYmd(cita.fecha);
  if (!inicio) return false;
  const fin = extraerFechaYmd(cita.hora_fin_date) || inicio;
  if (inicio === fechaYmd) return true;
  if (
    ['En Estudio', 'Pausado'].includes(cita.estado) &&
    fechaYmd >= inicio &&
    fechaYmd <= fin
  ) {
    return true;
  }
  return false;
}

function familiaEstudioCalendario(estudio) {
  const key = monitorEstudioColorKey(estudio);
  if (key === 'psg' || key === 'eeg' || key === 'vtm') return key;
  const u = String(estudio || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (u.includes('actigraf')) return 'actigrafia';
  return 'otro';
}

function diasDelMes(mesYmd) {
  const [y, m] = mesYmd.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/**
 * @param {Array<{fecha, hora_fin_date, estudio, estado}>} citas
 * @param {string} mes YYYY-MM
 */
function buildCalendarioElectroMes(citas, mes) {
  const diasMap = {};
  for (const fecha of diasDelMes(mes)) {
    diasMap[fecha] = { fecha, total: 0, porTipo: emptyPorTipo() };
  }

  const lista = Array.isArray(citas) ? citas : [];
  for (const cita of lista) {
    if (ESTADOS_EXCLUIDOS_CAL.has(cita.estado)) continue;
    const familia = familiaEstudioCalendario(cita.estudio);
    for (const fecha of Object.keys(diasMap)) {
      if (!citaVisibleEnDiaAgenda(cita, fecha)) continue;
      diasMap[fecha].total += 1;
      if (diasMap[fecha].porTipo[familia] != null) {
        diasMap[fecha].porTipo[familia] += 1;
      } else {
        diasMap[fecha].porTipo.otro += 1;
      }
    }
  }

  return {
    mes,
    dias: Object.values(diasMap)
  };
}

module.exports = {
  TIPOS_CALENDARIO,
  citaVisibleEnDiaAgenda,
  buildCalendarioElectroMes,
  familiaEstudioCalendario
};
