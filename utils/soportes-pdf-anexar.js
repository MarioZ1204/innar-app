/**
 * Añade páginas de uno o más PDF al final de un PDF existente (pdf-lib).
 */
const fs = require('fs');
const path = require('path');
const { fileLooksLikePdf } = require('../middleware/upload');
const { mergePdfFilesToTemp } = require('./soportes-opf-merge');
const { moveFileSafe } = require('./fs-move-safe');

const MAX_ANEXOS_PER_REQUEST = 12;

function assertPdfPaths(paths, min = 1) {
  const list = (paths || []).filter(Boolean);
  if (list.length < min) {
    throw new Error(min > 1 ? `Seleccione al menos ${min} archivos PDF` : 'Seleccione al menos un PDF');
  }
  if (list.length > MAX_ANEXOS_PER_REQUEST) {
    throw new Error(`Máximo ${MAX_ANEXOS_PER_REQUEST} PDF por operación`);
  }
  for (const p of list) {
    if (!fs.existsSync(p)) throw new Error('Uno de los PDF no está disponible');
    if (!fileLooksLikePdf(p)) throw new Error(`Debe ser PDF válido: ${path.basename(p)}`);
  }
  return list;
}

/**
 * @param {string} existingPath — PDF destino (se sobrescribe)
 * @param {string[]} newPaths — PDF a concatenar después del actual
 * @returns {Promise<number>} tamaño en bytes del archivo resultante
 */
async function appendPdfFilesToExisting(existingPath, newPaths) {
  if (!existingPath || !fs.existsSync(existingPath)) {
    throw new Error('El PDF actual no está en disco');
  }
  if (!fileLooksLikePdf(existingPath)) {
    throw new Error('El archivo actual no es un PDF válido');
  }
  const extras = assertPdfPaths(newPaths, 1);
  const mergedTmp = await mergePdfFilesToTemp([existingPath, ...extras]);
  try {
    moveFileSafe(mergedTmp, existingPath);
    return fs.statSync(existingPath).size;
  } catch (e) {
    try { if (fs.existsSync(mergedTmp)) fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  MAX_ANEXOS_PER_REQUEST,
  appendPdfFilesToExisting
};
