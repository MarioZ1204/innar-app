'use strict';

function normalizarNombreAnexo(nombre) {
  return String(nombre || '').trim().replace(/\s+/g, ' ');
}

function slugNombreArchivo(nombre) {
  return normalizarNombreAnexo(nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

/**
 * Lee hoja Excel exportada del anexo (cabeceras = labels de columnas).
 * @param {import('exceljs').Worksheet} ws
 */
function mapFilaImportadaAnexo(raw) {
  const { ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');
  const { enriquecerRegistroAnexoFidu } = require('./anexo-fidu-servicios');
  const { formatFechaParaCelda, calcularEdadDesdeFecha } = require('./anexo-fidu-import');
  const out = {};
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => {
    out[k] = raw[k] != null ? String(raw[k]).trim() : '';
  });
  if (out.fecha_nacimiento) {
    out.fecha_nacimiento = formatFechaParaCelda(out.fecha_nacimiento);
    if (!out.edad) out.edad = calcularEdadDesdeFecha(out.fecha_nacimiento);
  }
  return enriquecerRegistroAnexoFidu(out);
}

function parseAnexoFiduWorksheet(ws) {
  const { ANEXO_FIDU_COLUMNAS } = require('./anexo-fidu-columns');
  const { normHeader, cellToString } = require('./anexo-fidu-import');

  const labelToKey = new Map();
  ANEXO_FIDU_COLUMNAS.forEach((c) => {
    labelToKey.set(normHeader(c.label), c.key);
    labelToKey.set(normHeader(c.key), c.key);
  });

  const headerRow = ws.getRow(1);
  const colMap = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const nk = normHeader(cell.value);
    colMap[colNumber] = labelToKey.get(nk) || null;
  });

  const registros = [];
  const errores = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    let tieneDato = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colMap[colNumber];
      if (!key) return;
      const val = cellToString(cell.value);
      if (val) tieneDato = true;
      raw[key] = val;
    });
    if (!tieneDato) return;
    try {
      registros.push(mapFilaImportadaAnexo(raw));
    } catch (e) {
      errores.push(`Fila ${rowNumber}: ${e.message}`);
    }
  });

  return { registros, errores };
}

module.exports = {
  normalizarNombreAnexo,
  slugNombreArchivo,
  mapFilaImportadaAnexo,
  parseAnexoFiduWorksheet
};
