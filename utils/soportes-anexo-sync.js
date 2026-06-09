'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { buildAnexoFiduExcelBuffer } = require('./anexo-fidu-export');
const { soportesRoot, ensureDir } = require('./soportes-storage');
const { getArmadoAnexoDir } = require('./soportes-armado-modos');

async function fetchAnexoArchivoMeta(archivoId) {
  const rows = await db.query(
    `SELECT a.*, c.nombre AS carpeta_nombre
     FROM anexo_fidu_archivos a
     JOIN anexo_fidu_carpetas c ON c.id = a.carpeta_id
     WHERE a.id = ?`,
    [archivoId]
  );
  return rows[0] || null;
}

async function resolverSopDiaAnexo(archivoId, meta) {
  if (meta?.sop_dia_id) {
    const dia = await db.query('SELECT * FROM sop_dias WHERE id = ?', [meta.sop_dia_id]);
    if (dia.length) return dia[0];
  }
  const byLink = await db.query('SELECT * FROM sop_dias WHERE anexo_archivo_id = ? LIMIT 1', [archivoId]);
  if (byLink.length) return byLink[0];
  return null;
}

async function guardarExportAnexoEnSoportes(archivoId) {
  const meta = await fetchAnexoArchivoMeta(archivoId);
  if (!meta) return { ok: false, error: 'Anexo no encontrado' };

  const dia = await resolverSopDiaAnexo(archivoId, meta);
  if (!dia) return { ok: false, skipped: true, reason: 'sin_vinculo_soportes' };

  const parentRows = dia.parent_id
    ? await db.query('SELECT nombre_display FROM sop_dias WHERE id = ?', [dia.parent_id])
    : [];
  const contenedorNombre = parentRows[0]?.nombre_display || 'Anexo FIDU';
  const periodoRows = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [dia.periodo_id]);
  const periodo = periodoRows[0]?.periodo;
  if (!periodo) return { ok: false, error: 'Periodo no encontrado' };

  const rows = await db.query(
    'SELECT * FROM anexo_fidu_registros WHERE archivo_id = ? ORDER BY id ASC',
    [archivoId]
  );
  const { buffer, filename } = await buildAnexoFiduExcelBuffer(rows, { nombreArchivo: meta.nombre });
  const relDir = getArmadoAnexoDir(periodo, contenedorNombre, dia.nombre_display);
  const absDir = path.join(soportesRoot(), relDir);
  ensureDir(absDir);
  const absPath = path.join(absDir, filename);
  fs.writeFileSync(absPath, Buffer.from(buffer));
  const rutaExport = path.join(relDir, filename).replace(/\\/g, '/');

  await db.execute(
    'UPDATE anexo_fidu_archivos SET ruta_export = ?, sop_dia_id = COALESCE(sop_dia_id, ?) WHERE id = ?',
    [rutaExport, dia.id, archivoId]
  );
  await db.execute('UPDATE sop_dias SET anexo_archivo_id = ? WHERE id = ?', [archivoId, dia.id]);

  return { ok: true, ruta_export: rutaExport, filename };
}

module.exports = {
  guardarExportAnexoEnSoportes,
  fetchAnexoArchivoMeta,
  resolverSopDiaAnexo
};
