'use strict';

function normNombreCatalogo(val) {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nombres internos de epileptología: se quedan en agenda/recibos, no en el combo del comprobante. */
const EXCLUIDOS_COMPROBANTE_MEDICA = new Set([
  'consulta de control por epileptologia',
  'consulta de primera vez por epileptologia'
]);

const EXTRAS_COMPROBANTE_MEDICA = [
  'Consulta de Primera Vez por Otras Especialidades Médicas (Epileptología)',
  'Consulta de Control por Otras Especialidades Médicas (Epileptología)'
];

/**
 * Catálogo del campo motivo/servicio del comprobante de consultas médicas:
 * tipos de consulta (sin códigos CUPS), sin las dos de epileptología internas,
 * más las dos de otras especialidades médicas (epileptología).
 */
function catalogoComprobanteConsultaMedica(tiposConsulta) {
  const vistos = new Set();
  const servicios = [];

  for (const r of tiposConsulta || []) {
    const nombre = String(r && r.nombre != null ? r.nombre : r || '').trim();
    const key = normNombreCatalogo(nombre);
    if (!nombre || !key || EXCLUIDOS_COMPROBANTE_MEDICA.has(key) || vistos.has(key)) continue;
    vistos.add(key);
    servicios.push({ codigo: '', nombre });
  }

  for (const nombre of EXTRAS_COMPROBANTE_MEDICA) {
    const key = normNombreCatalogo(nombre);
    if (vistos.has(key)) continue;
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
  EXCLUIDOS_COMPROBANTE_MEDICA,
  normNombreCatalogo
};
