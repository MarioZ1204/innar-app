/**
 * Unir varios PDF en un slot de expediente SOPORTES (CRC, etc.).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { fileLooksLikePdf } = require('../middleware/upload');
const { getArmadoFeDirFromContext } = require('./soportes-storage');
const { buildSoportesDiskName } = require('./soportes-archivo-detect');
const { moveFileSafe } = require('./fs-move-safe');
const { mergePdfFilesToTemp } = require('./soportes-opf-merge');
const { loadArchivoExpedienteSlot, eliminarArchivoExpedienteSlot } = require('./soportes-exp-archivo');

const UNIR_PDF_SLOTS = ['CRC'];

function assertSlotUnirPermitido(slotKey) {
  const t = String(slotKey || '').toUpperCase();
  if (!UNIR_PDF_SLOTS.includes(t)) {
    throw new Error(`No se pueden unir PDF para el tipo ${t}`);
  }
  return t;
}

function assertPdfPaths(paths, min = 1) {
  const list = (paths || []).filter(Boolean);
  if (list.length < min) {
    throw new Error(min > 1 ? `Seleccione al menos ${min} archivos PDF` : 'Seleccione al menos un PDF');
  }
  for (const p of list) {
    if (!fs.existsSync(p)) throw new Error('Uno de los PDF no está disponible');
    if (!fileLooksLikePdf(p)) throw new Error(`Debe ser PDF válido: ${path.basename(p)}`);
  }
  return list;
}

async function persistirSlotPdf(exp, ctx, slotKey, mergedTmp, meta, usuarioId) {
  const tipo = String(slotKey).toUpperCase();
  const diskName = buildSoportesDiskName(tipo, exp, '.pdf');
  const { abs: feDir, rel: feRel } = getArmadoFeDirFromContext(ctx, exp.codigo);
  const destPath = path.join(feDir, diskName);
  moveFileSafe(mergedTmp, destPath);
  const rutaRelativa = path.join(feRel, diskName).replace(/\\/g, '/');
  const tamano = fs.statSync(destPath).size;
  const nombreOriginal = String(meta?.nombre_original || tipo).slice(0, 500);

  await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [exp.id, tipo]);
  await db.execute(
    `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, subido_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [exp.id, tipo, diskName, nombreOriginal, rutaRelativa, tamano, meta?.origen || 'merge_pdf', usuarioId]
  );

  return {
    ok: true,
    tipo,
    nombre_archivo: diskName,
    nombre_original: nombreOriginal,
    pendiente_factura: !(parseInt(exp.numero_factura, 10) > 0)
  };
}

/**
 * Une PDFs en orden y guarda en el slot (p. ej. CRC).
 */
async function unirPdfsEnSlot(exp, ctx, slotKey, sourcePaths, {
  nombreOriginal,
  origen,
  usuarioId,
  reemplazar = false,
  minArchivos = 2
} = {}) {
  if (!exp?.id) throw new Error('Expediente inválido');
  if (ctx?.contenedor_tipo === 'rips') {
    throw new Error('Los PDF unidos se guardan en la carpeta SOPORTES, no en RIPS');
  }

  const tipo = assertSlotUnirPermitido(slotKey);
  const paths = assertPdfPaths(sourcePaths, minArchivos);

  const existe = await loadArchivoExpedienteSlot(exp.id, tipo);
  if (existe.ok && !reemplazar) {
    throw new Error(`Ya existe ${tipo}. Elimínelo o use reemplazar.`);
  }
  if (existe.ok && reemplazar) {
    await eliminarArchivoExpedienteSlot(exp.id, tipo);
  }

  const mergedTmp = await mergePdfFilesToTemp(paths);
  try {
    const labels = paths.map((p) => path.basename(p)).join(' + ');
    return await persistirSlotPdf(exp, ctx, tipo, mergedTmp, {
      nombre_original: nombreOriginal || `${tipo} ← ${labels}`,
      origen: origen || 'merge_pdf'
    }, usuarioId);
  } catch (e) {
    try { if (fs.existsSync(mergedTmp)) fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  UNIR_PDF_SLOTS,
  unirPdfsEnSlot
};
