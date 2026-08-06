/**
 * Genera OPF en expediente FE: ORDEN+HC + autorización (depósito, manual o PDF ya unido).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { fileLooksLikePdf } = require('../middleware/upload');
const { getArmadoFeDirForExpediente } = require('./soportes-storage');
const { buildSoportesDiskName } = require('./soportes-archivo-detect');
const { moveFileSafe } = require('./fs-move-safe');
const { mergePdfFilesToTemp, esArchivoOrdenHcPdx } = require('./soportes-opf-merge');

async function assertOpfNoExiste(expedienteId) {
  const rows = await db.query(
    'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
    [expedienteId, 'OPF']
  );
  if (rows.length) {
    throw new Error('Ya existe un OPF en este expediente. Elimínelo antes de generar otro.');
  }
}

function assertPdfEnDisco(filePath, etiqueta) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Falta el PDF de ${etiqueta}`);
  }
  if (!fileLooksLikePdf(filePath)) {
    throw new Error(`${etiqueta} debe ser un PDF válido`);
  }
}

async function persistirOpfEnExpediente(exp, ctx, mergedTmp, meta, usuarioId) {
  const diskName = buildSoportesDiskName('OPF', exp, '.pdf');
  const { abs: feDir, rel: feRel } = getArmadoFeDirForExpediente(ctx, exp);
  const destPath = path.join(feDir, diskName);
  moveFileSafe(mergedTmp, destPath);
  const rutaRelativa = path.join(feRel, diskName).replace(/\\/g, '/');
  const tamano = fs.statSync(destPath).size;
  const nombreOriginal = String(meta?.nombre_original || 'OPF').slice(0, 500);

  await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [exp.id, 'OPF']);
  await db.execute(
    `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, pdx_archivo_id, subido_por)
     VALUES (?,?,?,?,?,?, ?, ?, ?)`,
    [
      exp.id, 'OPF', diskName, nombreOriginal, rutaRelativa, tamano,
      meta?.origen || 'merge_opf',
      meta?.orden_pdx_id || null,
      usuarioId
    ]
  );

  return {
    ok: true,
    nombre_archivo: diskName,
    nombre_original: nombreOriginal,
    pendiente_factura: !(parseInt(exp.numero_factura, 10) > 0),
    orden_pdx_id: meta?.orden_pdx_id || null
  };
}

/**
 * Guarda un PDF ya unido como OPF (subida manual sin depósito).
 */
async function guardarOpfPdfUnido(exp, ctx, sourcePath, { nombreOriginal, origen, usuarioId } = {}) {
  if (!exp?.id) throw new Error('Expediente inválido');
  if (ctx?.contenedor_tipo === 'rips') {
    throw new Error('El OPF se guarda en la carpeta SOPORTES, no en RIPS');
  }
  await assertOpfNoExiste(exp.id);
  assertPdfEnDisco(sourcePath, 'OPF');
  const tmp = `${sourcePath}.innar-opf-copy.pdf`;
  try {
    fs.copyFileSync(sourcePath, tmp);
    return await persistirOpfEnExpediente(exp, ctx, tmp, {
      nombre_original: nombreOriginal || path.basename(sourcePath),
      origen: origen || 'upload_opf'
    }, usuarioId);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

/**
 * Une ORDEN+HC + autorización (o un solo PDF) y guarda como OPF.
 */
async function generarOpfEnExpediente(exp, ctx, {
  ordenPdxRow,
  ordenPath,
  ordenOriginalName,
  authTempPath,
  authOriginalName,
  usuarioId
}) {
  if (!exp?.id) throw new Error('Expediente inválido');
  if (ctx?.contenedor_tipo === 'rips') {
    throw new Error('El OPF se genera en la carpeta SOPORTES, no en RIPS');
  }
  await assertOpfNoExiste(exp.id);

  let ordenFilePath = ordenPath;
  let ordenLabel = ordenOriginalName || 'ORDEN+HC manual';
  let pdxId = null;

  if (ordenPdxRow?.id) {
    if (!esArchivoOrdenHcPdx(ordenPdxRow)) {
      throw new Error('El archivo del depósito no es un ORDEN + HC válido');
    }
    const { resolveStoragePath } = require('./soportes-storage');
    ordenFilePath = resolveStoragePath(ordenPdxRow.ruta_relativa);
    ordenLabel = ordenPdxRow.nombre_archivo_original || 'ORDEN+HC';
    pdxId = ordenPdxRow.id;
  }

  if (!ordenFilePath) {
    throw new Error('Indique ORDEN+HC (del depósito o PDF manual) y la autorización');
  }
  assertPdfEnDisco(ordenFilePath, 'ORDEN+HC');

  const paths = [ordenFilePath];
  if (authTempPath) {
    assertPdfEnDisco(authTempPath, 'autorización');
    paths.push(authTempPath);
  }

  const mergedTmp = await mergePdfFilesToTemp(paths);
  try {
    const nombreOriginal = paths.length > 1
      ? `OPF ← ${ordenLabel} + ${authOriginalName || 'Autorización'}`
      : `OPF ← ${ordenLabel}`;
    return await persistirOpfEnExpediente(exp, ctx, mergedTmp, {
      nombre_original: nombreOriginal,
      origen: 'merge_opf',
      orden_pdx_id: pdxId
    }, usuarioId);
  } catch (e) {
    try { if (fs.existsSync(mergedTmp)) fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

/**
 * Une N PDFs (depósito y/o temporales) en orden y guarda como OPF. Mínimo 2 partes.
 * @param {Array<{ kind: 'pdx', pdxRow: object }|{ kind: 'file', path: string, label?: string }>} partes
 */
async function generarOpfDesdePartes(exp, ctx, partes, usuarioId) {
  if (!exp?.id) throw new Error('Expediente inválido');
  if (ctx?.contenedor_tipo === 'rips') {
    throw new Error('El OPF se genera en la carpeta SOPORTES, no en RIPS');
  }
  if (!Array.isArray(partes) || partes.length < 2) {
    throw new Error('Agregue al menos 2 archivos PDF para generar el OPF');
  }
  await assertOpfNoExiste(exp.id);

  const { resolveStoragePath } = require('./soportes-storage');
  const paths = [];
  const labels = [];
  let firstPdxId = null;

  for (const p of partes) {
    if (p.kind === 'pdx') {
      const row = p.pdxRow;
      if (!row?.ruta_relativa) throw new Error('Archivo del depósito sin ruta');
      const fp = resolveStoragePath(row.ruta_relativa);
      assertPdfEnDisco(fp, 'depósito');
      paths.push(fp);
      labels.push(row.nombre_archivo_original || row.paciente_nombre || 'Depósito');
      if (!firstPdxId) firstPdxId = row.id;
    } else if (p.kind === 'file') {
      assertPdfEnDisco(p.path, p.label || 'archivo');
      paths.push(p.path);
      labels.push(p.label || path.basename(p.path));
    } else {
      throw new Error('Parte de OPF no válida');
    }
  }

  const mergedTmp = await mergePdfFilesToTemp(paths);
  try {
    let nombreOriginal = `OPF ← ${labels[0]}`;
    if (labels.length === 2) nombreOriginal += ` + ${labels[1]}`;
    else if (labels.length > 2) {
      nombreOriginal += ` + ${labels[1]} (+${labels.length - 2} más)`;
    }
    return await persistirOpfEnExpediente(exp, ctx, mergedTmp, {
      nombre_original: nombreOriginal.slice(0, 500),
      origen: 'merge_opf',
      orden_pdx_id: firstPdxId
    }, usuarioId);
  } catch (e) {
    try { if (fs.existsSync(mergedTmp)) fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  assertOpfNoExiste,
  guardarOpfPdfUnido,
  generarOpfEnExpediente,
  generarOpfDesdePartes,
  esArchivoOrdenHcPdx
};
