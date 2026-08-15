'use strict';

const COL_TIPOS_CONSULTA_USO = {
  agenda: 'visible_agenda',
  recibo: 'visible_recibo',
  comprobante: 'visible_comprobante'
};

const COL_ENTIDADES_USO = {
  agenda: 'visible_agenda',
  electro: 'visible_electro',
  recibo: 'visible_recibo'
};

const SQL_SELECT_TIPOS_CONSULTA = [
  'id',
  'nombre',
  'orden',
  'COALESCE(permite_sesiones_multiples, 0) AS permite_sesiones_multiples',
  'COALESCE(visible_agenda, 1) AS visible_agenda',
  'COALESCE(visible_comprobante, 1) AS visible_comprobante',
  'COALESCE(visible_recibo, 1) AS visible_recibo'
].join(', ');

function colVisibleTiposConsulta(uso) {
  return COL_TIPOS_CONSULTA_USO[String(uso || '').trim().toLowerCase()] || null;
}

function colVisibleEntidades(uso) {
  return COL_ENTIDADES_USO[String(uso || '').trim().toLowerCase()] || null;
}

function sqlAndVisible(col) {
  return col ? ` AND COALESCE(${col}, 1) = 1` : '';
}

function parseFlag(val, defaultVal = 1) {
  if (val === undefined || val === null || val === '') return defaultVal ? 1 : 0;
  if (val === true || val === 1 || val === '1') return 1;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === 'si' || s === 'sí' || s === 'on') return 1;
  return 0;
}

module.exports = {
  COL_TIPOS_CONSULTA_USO,
  COL_ENTIDADES_USO,
  SQL_SELECT_TIPOS_CONSULTA,
  colVisibleTiposConsulta,
  colVisibleEntidades,
  sqlAndVisible,
  parseFlag
};
