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
function mapFilaImportadaAnexo(raw, extras = {}) {
  const { ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');
  const { enriquecerRegistroAnexoFidu } = require('./anexo-fidu-servicios');
  const { aplicarCamposCombinadosImport } = require('./anexo-fidu-import');
  const out = {};
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => {
    out[k] = raw[k] != null ? String(raw[k]).trim() : '';
  });
  aplicarCamposCombinadosImport(out, extras);
  return enriquecerRegistroAnexoFidu(out);
}

function parseAnexoFiduWorksheet(ws) {
  const { ANEXO_FIDU_COLUMNAS } = require('./anexo-fidu-columns');
  const { normHeader, cellToString, IMPORT_HEADER_ALIASES } = require('./anexo-fidu-import');

  const labelToKey = new Map();
  ANEXO_FIDU_COLUMNAS.forEach((c) => {
    labelToKey.set(normHeader(c.label), c.key);
    labelToKey.set(normHeader(c.key), c.key);
  });
  Object.entries(IMPORT_HEADER_ALIASES).forEach(([alias, key]) => {
    if (!labelToKey.has(alias)) labelToKey.set(alias, key);
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
    let nombresRaw = '';
    let apellidosRaw = '';
    let barrioRaw = '';
    let tieneDato = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colMap[colNumber];
      if (!key) return;
      let val = cellToString(cell.value);
      if (key === 'fecha_autorizacion_hora') {
        const { formatFechaAutorizacionHora } = require('./anexo-fidu-import');
        val = formatFechaAutorizacionHora(cell.value);
      }
      if (val) tieneDato = true;
      if (key === '_nombres') nombresRaw = val;
      else if (key === '_apellidos') apellidosRaw = val;
      else if (key === '_barrio') barrioRaw = val;
      else raw[key] = val;
    });
    if (!tieneDato) return;
    try {
      registros.push(mapFilaImportadaAnexo(raw, { nombresRaw, apellidosRaw, barrioRaw }));
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
