'use strict';

function normNombreCatalogo(val) {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXTRAS_COMPROBANTE_MEDICA = [
  'Consulta de Primera Vez por Otras Especialidades Médicas (Epileptología)',
  'Consulta de Control por Otras Especialidades Médicas (Epileptología)'
];

/**
 * Catálogo del campo motivo/servicio del comprobante de consultas médicas.
 * Recibe filas ya filtradas (visible_comprobante=1) o con el flag en cada fila.
 */
function catalogoComprobanteConsultaMedica(tiposConsulta) {
  const vistos = new Set();
  const servicios = [];

  for (const r of tiposConsulta || []) {
    if (r && typeof r === 'object' && r.visible_comprobante !== undefined
      && Number(r.visible_comprobante) === 0) {
      continue;
    }
    const nombre = String(r && r.nombre != null ? r.nombre : r || '').trim();
    const key = normNombreCatalogo(nombre);
    if (!nombre || !key || vistos.has(key)) continue;
    vistos.add(key);
    servicios.push({ codigo: '', nombre });
  }

  servicios.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return servicios;
}

function nombreExtraComprobanteMedica(raw) {
  const key = normNombreCatalogo(raw);
  if (!key) return null;
  return EXTRAS_COMPROBANTE_MEDICA.find((n) => normNombreCatalogo(n) === key) || null;
}

module.exports = {
  catalogoComprobanteConsultaMedica,
  nombreExtraComprobanteMedica,
  EXTRAS_COMPROBANTE_MEDICA,
  normNombreCatalogo
};
