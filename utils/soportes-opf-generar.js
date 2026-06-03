/**
 * Genera OPF en expediente FE: ORDEN+HC (depósito reportes) + autorización PDF.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./db-mysql');
const { fileLooksLikePdf } = require('../middleware/upload');
const { getArmadoFeDirFromContext } = require('./soportes-storage');
const { buildCanonicalName } = require('./soportes-archivo-detect');
const { esExpedientePendienteFactura } = require('./soportes-pacientes-parse');
const { mergePdfFilesToTemp, esArchivoOrdenHcPdx } = require('./soportes-opf-merge');

async function assertOpfNoExiste(expedienteId) {
  const rows = await db.query(
    'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
    [expedienteId, 'OPF']
  );
  if (rows.length) {
    throw new Error('Ya existe un OPF en este expediente (ORDEN+HC + autorización). No se puede reemplazar.');
  }
}

async function generarOpfEnExpediente(exp, ctx, {
  ordenPdxRow,
  authTempPath,
  authOriginalName,
  usuarioId
}) {
  if (!exp?.id) throw new Error('Expediente inválido');
  if (ctx?.contenedor_tipo === 'rips') {
    throw new Error('El OPF se genera en la carpeta SOPORTES, no en RIPS');
  }
  await assertOpfNoExiste(exp.id);
  if (esExpedientePendienteFactura(exp)) {
    throw new Error('Asigne el número de factura (suba la FEV) antes de generar el OPF.');
  }
  if (!ordenPdxRow?.id || !esArchivoOrdenHcPdx(ordenPdxRow)) {
    throw new Error('El archivo seleccionado no es un ORDEN + HC válido del depósito de reportes');
  }
  if (!authTempPath || !fs.existsSync(authTempPath)) {
    throw new Error('Falta el PDF de autorización');
  }
  if (!fileLooksLikePdf(authTempPath)) {
    throw new Error('La autorización debe ser un PDF válido');
  }

  const { resolveStoragePath } = require('./soportes-storage');
  const ordenPath = resolveStoragePath(ordenPdxRow.ruta_relativa);
  if (!ordenPath || !fs.existsSync(ordenPath)) {
    throw new Error('El archivo ORDEN+HC no está en disco');
  }
  if (!fileLooksLikePdf(ordenPath)) {
    throw new Error('El ORDEN+HC del depósito no es un PDF válido');
  }

  const mergedTmp = await mergePdfFilesToTemp([ordenPath, authTempPath]);
  try {
    const diskName = buildCanonicalName('OPF', exp.numero_factura, '.pdf');
    const { abs: feDir, rel: feRel } = getArmadoFeDirFromContext(ctx, exp.codigo);
    const destPath = path.join(feDir, diskName);
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    fs.renameSync(mergedTmp, destPath);
    const rutaRelativa = path.join(feRel, diskName).replace(/\\/g, '/');
    const tamano = fs.statSync(destPath).size;
    const nombreOriginal = `OPF ← ${ordenPdxRow.nombre_archivo_original || 'ORDEN+HC'} + ${authOriginalName || 'Autorización'}`;

    await db.execute(
      `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, pdx_archivo_id, subido_por)
       VALUES (?,?,?,?,?,?, 'merge_opf', ?, ?)`,
      [exp.id, 'OPF', diskName, nombreOriginal.slice(0, 500), rutaRelativa, tamano, ordenPdxRow.id, usuarioId]
    );

    return {
      ok: true,
      nombre_archivo: diskName,
      nombre_original: nombreOriginal,
      orden_pdx_id: ordenPdxRow.id
    };
  } catch (e) {
    try { if (fs.existsSync(mergedTmp)) fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  assertOpfNoExiste,
  generarOpfEnExpediente,
  esArchivoOrdenHcPdx
};
