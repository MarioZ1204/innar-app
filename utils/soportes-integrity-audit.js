const fs = require('fs');
const path = require('path');
const db = require('./db-mysql');
const { getUploadsRoot, getSoportesRoot } = require('../config/uploads-path');

function resolveRutaRegistradaExacta(row) {
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/').replace(/^uploads\//, '').trim();
  if (!rel || path.isAbsolute(rel)) return null;
  const uploads = getUploadsRoot();
  const soportes = getSoportesRoot();
  const candidates = rel.startsWith('soportes/')
    ? [path.resolve(uploads, rel)]
    : [path.resolve(soportes, rel), path.resolve(uploads, rel)];
  return candidates.find((fp) => fs.existsSync(fp)) || null;
}

function walkFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

async function auditarIntegridadSoportes({ expedienteIds = [] } = {}) {
  const params = [];
  const where = expedienteIds.length
    ? ` WHERE expediente_id IN (${expedienteIds.map(() => '?').join(',')})`
    : '';
  params.push(...expedienteIds);
  const soportes = await db.query(`SELECT *, 'soportes' AS origen_tabla FROM sop_exp_archivos${where}`, params);
  let rips = [];
  try {
    rips = await db.query(`SELECT *, 'rips' AS origen_tabla FROM sop_rips_archivos${where}`, params);
  } catch (_) { /* tabla opcional */ }

  const registrosSinArchivo = [];
  const rutasLegacy = [];
  const referenciados = new Set();
  for (const row of [...soportes, ...rips]) {
    const fp = resolveRutaRegistradaExacta(row);
    if (!fp || !fs.existsSync(fp)) {
      registrosSinArchivo.push({
        tabla: row.origen_tabla,
        id: row.id,
        expediente_id: row.expediente_id,
        slot: row.tipo || row.slot,
        ruta_relativa: row.ruta_relativa
      });
      continue;
    }
    referenciados.add(path.resolve(fp).toLowerCase());
    const rel = String(row.ruta_relativa || '').replace(/\\/g, '/');
    if (rel.startsWith('uploads/') || rel.startsWith('soportes/') || path.isAbsolute(rel)) {
      rutasLegacy.push({
        tabla: row.origen_tabla,
        id: row.id,
        expediente_id: row.expediente_id,
        ruta_relativa: row.ruta_relativa
      });
    }
  }

  const archivosHuerfanos = walkFiles(getSoportesRoot())
    .filter((fp) => !referenciados.has(path.resolve(fp).toLowerCase()))
    .map((fp) => path.relative(getSoportesRoot(), fp).replace(/\\/g, '/'));
  let journalsIncompletos = [];
  try {
    journalsIncompletos = await db.query(
      "SELECT * FROM sop_fs_journal WHERE estado IN ('preparado','error') ORDER BY creado_en ASC"
    );
  } catch (_) { /* migración aún no aplicada */ }

  return {
    registros_sin_archivo: registrosSinArchivo,
    archivos_huerfanos: archivosHuerfanos,
    rutas_legacy: rutasLegacy,
    journals_incompletos: journalsIncompletos,
    resumen: {
      registros_sin_archivo: registrosSinArchivo.length,
      archivos_huerfanos: archivosHuerfanos.length,
      rutas_legacy: rutasLegacy.length,
      journals_incompletos: journalsIncompletos.length
    }
  };
}

module.exports = { auditarIntegridadSoportes, walkFiles, resolveRutaRegistradaExacta };
