'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { fileLooksLikePdf } = require('../middleware/upload');
const { SOPORTES_ROOT, ensureDir } = require('./soportes-storage');
const { moveFileSafe } = require('./fs-move-safe');
const { safeOriginalFilename } = require('./soportes-archivo-detect');
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
  const stem = base.slice(0, -ext.length).replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.\-()]/gi, '_').trim() || 'documento';
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
  if (!fileLooksLikePdf(tempPath)) {
    throw new Error('Solo se permiten archivos PDF');
  }
  const ctx = await resolveUcqnUploadContext(exp);
  if (!ctx) throw new Error('Expediente UCQN no válido');
  const origen = opts.origen === 'copia_pdx' ? 'copia_pdx' : 'upload';

  let diskName = ucqnDiskName(originalName);
  let destPath = path.join(ctx.absDir, diskName);
  let n = 1;
  while (fs.existsSync(destPath)) {
    const ext = path.extname(diskName);
    const stem = path.basename(diskName, ext);
    diskName = `${stem}_${n}${ext}`;
    destPath = path.join(ctx.absDir, diskName);
    n += 1;
  }

  moveFileSafe(tempPath, destPath);
  const rutaRelativa = path.join(ctx.relDir, diskName).replace(/\\/g, '/');
  const tamano = fs.statSync(destPath).size;

  const dup = await db.query(
    'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND ruta_relativa = ? LIMIT 1',
    [exp.id, rutaRelativa]
  );
  if (dup.length) {
    await db.execute(
      `UPDATE sop_exp_archivos SET nombre_archivo = ?, nombre_original = ?, tamano_bytes = ?, subido_por = ?
       WHERE id = ?`,
      [diskName, originalName, tamano, usuarioId, dup[0].id]
    );
    return { slot: 'PDF', nombre_archivo: diskName, nombre_original: originalName, archivo_id: dup[0].id };
  }

  const r = await db.execute(
    `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, subido_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [exp.id, 'PDF', diskName, originalName, rutaRelativa, tamano, origen, usuarioId]
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
    nombre_original: originalName,
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
    nombre_original: a.nombre_original,
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

module.exports = {
  saveUcqnPdf,
  buildUcqnExpedienteDetail,
  resolveUcqnUploadContext
};
