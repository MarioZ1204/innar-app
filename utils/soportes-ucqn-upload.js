'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { fileLooksLikePdfAsync } = require('../middleware/upload');
const { SOPORTES_ROOT, ensureDir } = require('./soportes-storage');
const { moveFileSafeAsync, pathExists } = require('./fs-move-safe');
const { decodeUploadFilename, safeOriginalFilename } = require('./soportes-archivo-detect');
const {
  getArmadoUcqnPersonaDir,
  fetchDiaRow,
  esModoUcqn
} = require('./soportes-armado-modos');
const { sanitizePathSegment } = require('./soportes-armado-structure');

function ucqnDiskName(originalName) {
  const safe = safeOriginalFilename(originalName) || 'documento.pdf';
  const base = path.basename(safe);
  const ext = path.extname(base).toLowerCase() || '.pdf';
  const stem = base.slice(0, -ext.length).replace(/\s+/g, ' ').trim() || 'documento';
  return `${stem}${ext}`;
}

async function resolveUcqnUploadContext(exp) {
  const dia = await fetchDiaRow(db, exp.dia_id);
  if (!dia || !esModoUcqn(dia.modo)) return null;
  let contenedorNombre = 'U C Q N';
  if (dia.parent_id) {
    const parent = await fetchDiaRow(db, dia.parent_id);
    if (parent?.nombre_display) contenedorNombre = parent.nombre_display;
  }
  const periodoRows = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [dia.periodo_id]);
  const periodo = periodoRows[0]?.periodo || '';
  const relDir = getArmadoUcqnPersonaDir(periodo, contenedorNombre, dia.nombre_display);
  const absDir = path.join(SOPORTES_ROOT, relDir);
  ensureDir(absDir);
  return { dia, relDir, absDir, periodo, contenedorNombre };
}

async function saveUcqnPdf(exp, tempPath, originalName, usuarioId, opts = {}) {
  if (!(await fileLooksLikePdfAsync(tempPath))) {
    throw new Error('Solo se permiten archivos PDF');
  }
  const ctx = await resolveUcqnUploadContext(exp);
  if (!ctx) throw new Error('Expediente UCQN no válido');
  const origen = opts.origen === 'copia_pdx' ? 'copia_pdx' : 'upload';
  const displayName = decodeUploadFilename(originalName);

  let diskName = ucqnDiskName(displayName);
  let destPath = path.join(ctx.absDir, diskName);
  let n = 1;
  while (await pathExists(destPath)) {
    const ext = path.extname(diskName);
    const stem = path.basename(diskName, ext);
    diskName = `${stem}_${n}${ext}`;
    destPath = path.join(ctx.absDir, diskName);
    n += 1;
  }

  await moveFileSafeAsync(tempPath, destPath);
  const rutaRelativa = path.join(ctx.relDir, diskName).replace(/\\/g, '/');
  const tamano = (await fs.promises.stat(destPath)).size;

  const dup = await db.query(
    'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND ruta_relativa = ? LIMIT 1',
    [exp.id, rutaRelativa]
  );
  if (dup.length) {
    await db.execute(
      `UPDATE sop_exp_archivos SET nombre_archivo = ?, nombre_original = ?, tamano_bytes = ?, subido_por = ?
       WHERE id = ?`,
      [diskName, displayName, tamano, usuarioId, dup[0].id]
    );
    return { slot: 'PDF', nombre_archivo: diskName, nombre_original: displayName, archivo_id: dup[0].id };
  }

  const r = await db.execute(
    `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, subido_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [exp.id, 'PDF', diskName, displayName, rutaRelativa, tamano, origen, usuarioId]
  );
  const archivoId = r.insertId;
  if (opts.pdxArchivoId && archivoId) {
    await db.execute(
      'UPDATE sop_exp_archivos SET pdx_archivo_id = ? WHERE id = ?',
      [opts.pdxArchivoId, archivoId]
    );
  }
  return {
    slot: 'PDF',
    nombre_archivo: diskName,
    nombre_original: displayName,
    archivo_id: archivoId
  };
}

async function buildUcqnExpedienteDetail(expId, exp) {
  const archivos = await db.query(
    "SELECT * FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = 'PDF' ORDER BY id ASC",
    [expId]
  );
  const pdfs = archivos.map((a) => ({
    id: a.id,
    nombre_archivo: a.nombre_archivo,
    nombre_original: decodeUploadFilename(a.nombre_original || a.nombre_archivo),
    tamano_bytes: a.tamano_bytes,
    creado_en: a.creado_en
  }));
  return {
    ...exp,
    modo: 'ucqn',
    pdfs,
    paquete_completo: pdfs.length > 0
  };
}

async function resolverArchivoUcqnPdf(expedienteId, archivoId) {
  const rows = await db.query(
    `SELECT a.* FROM sop_exp_archivos a
     JOIN sop_expedientes e ON e.id = a.expediente_id
     JOIN sop_dias d ON d.id = e.dia_id
     WHERE a.id = ? AND a.expediente_id = ? AND a.tipo = 'PDF' AND d.modo = 'ucqn'`,
    [archivoId, expedienteId]
  );
  if (!rows.length) return { ok: false, error: 'PDF no encontrado', status: 404 };
  const { obtenerExpedienteContext, resolveArchivoAbsoluto } = require('./soportes-exp-archivo');
  const expediente = await obtenerExpedienteContext(expedienteId);
  const fp = resolveArchivoAbsoluto(rows[0], { expediente, deepScan: false });
  if (!fp || !fs.existsSync(fp)) {
    return { ok: false, error: 'El archivo no está en disco', status: 404, row: rows[0] };
  }
  return { ok: true, fp, row: rows[0] };
}

module.exports = {
  ucqnDiskName,
  saveUcqnPdf,
  buildUcqnExpedienteDetail,
  resolveUcqnUploadContext,
  resolverArchivoUcqnPdf
};
