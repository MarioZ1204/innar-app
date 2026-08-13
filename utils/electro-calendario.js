/**
 * Agregación mensual para calendario electro (misma visibilidad que agenda del día).
 */
const {
  citaVisibleEnAgendaDiaYmd,
  citaEsInicioEnFechaYmd,
  citaEsContinuacionEnFechaYmd
} = require('./electro-fechas');
const { monitorEstudioColorKey } = require('./electro-monitor');

const TIPOS_CALENDARIO = ['psg', 'eeg', 'vtm', 'actigrafia', 'otro'];

const ESTADOS_EXCLUIDOS_CAL = new Set(['Cancelado']);

function emptyPorTipo() {
  return { psg: 0, eeg: 0, vtm: 0, actigrafia: 0, otro: 0 };
}

/** Misma regla que agenda/kanban (Completado solo día de inicio). */
function citaVisibleEnDiaAgenda(cita, fechaYmd) {
  return citaVisibleEnAgendaDiaYmd(cita, fechaYmd);
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

function emptyDia(fecha) {
  return {
    fecha,
    total: 0,
    inicio: 0,
    continuacion: 0,
    porTipo: emptyPorTipo(),
    porTipoInicio: emptyPorTipo(),
    porTipoCont: emptyPorTipo()
  };
}

/**
 * @param {Array<{fecha, hora_fin_date, hora_agendamiento, hora_inicio, hora_fin, duracion_minutos, estudio, estado}>} citas
 * @param {string} mes YYYY-MM
 */
function buildCalendarioElectroMes(citas, mes) {
  const diasMap = {};
  for (const fecha of diasDelMes(mes)) {
    diasMap[fecha] = emptyDia(fecha);
  }

  const lista = Array.isArray(citas) ? citas : [];
  for (const cita of lista) {
    if (ESTADOS_EXCLUIDOS_CAL.has(cita.estado)) continue;
    const familia = familiaEstudioCalendario(cita.estudio);
    for (const fecha of Object.keys(diasMap)) {
      if (!citaVisibleEnDiaAgenda(cita, fecha)) continue;
      const dia = diasMap[fecha];
      dia.total += 1;
      if (dia.porTipo[familia] != null) dia.porTipo[familia] += 1;
      else dia.porTipo.otro += 1;

      if (citaEsInicioEnFechaYmd(cita, fecha)) {
        dia.inicio += 1;
        if (dia.porTipoInicio[familia] != null) dia.porTipoInicio[familia] += 1;
        else dia.porTipoInicio.otro += 1;
      }
      if (citaEsContinuacionEnFechaYmd(cita, fecha)) {
        dia.continuacion += 1;
        if (dia.porTipoCont[familia] != null) dia.porTipoCont[familia] += 1;
        else dia.porTipoCont.otro += 1;
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
