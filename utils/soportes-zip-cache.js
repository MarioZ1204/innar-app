'use strict';

/**
 * Caché persistente de ZIP por tipo de descarga (mes, día, contenedor, expediente).
 * Si los archivos no cambiaron, la descarga es inmediata (sin regenerar).
 */
const fs = require('fs');
const path = require('path');
const db = require('./db-mysql');
const { getUploadsRoot } = require('../config/uploads-path');
const logger = require('./logger');

const PERIOD_ZIP_KINDS = new Set(['periodo-paquete', 'periodo-unificado', 'periodo-facturados']);

function getCacheDir() {
  const dir = path.join(getUploadsRoot(), 'sop-zip-cache');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logger.warn('[SOPORTES] zip cache dir:', e.message);
  }
  return dir;
}

/** @param {{ kind: string, periodoId?: number, diaId?: number, contenedorId?: number, expedienteId?: number }} spec */
function jobCacheId(spec) {
  if (!spec?.kind) return null;
  if (PERIOD_ZIP_KINDS.has(spec.kind) && spec.periodoId) {
    return `${spec.periodoId}-${spec.kind}`;
  }
  if ((spec.kind === 'dia' || spec.kind === 'dia-carpeta') && spec.diaId) {
    return `dia-${spec.diaId}-${spec.kind}`;
  }
  if (spec.kind === 'contenedor' && spec.contenedorId) {
    return `cont-${spec.contenedorId}`;
  }
  if (spec.kind === 'expediente' && spec.expedienteId) {
    return `exp-${spec.expedienteId}`;
  }
  return null;
}

function cachePaths(cacheId) {
  const safe = String(cacheId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const base = path.join(getCacheDir(), safe);
  return { zipPath: `${base}.zip`, manifestPath: `${base}.manifest.json` };
}

function fingerprintKey(fp) {
  return `${fp.file_count || 0}:${fp.exp_count || 0}:${fp.max_ts || 0}`;
}

async function computePeriodoFingerprint(periodoId, kind) {
  const diaFilter = kind === 'periodo-facturados'
    ? "AND d.estado_facturacion = 'facturados'"
    : '';
  const rows = await db.query(
    `SELECT
       COUNT(DISTINCT a.id) + COUNT(DISTINCT ra.id) AS file_count,
       COUNT(DISTINCT e.id) AS exp_count,
       COALESCE(MAX(GREATEST(
         COALESCE(UNIX_TIMESTAMP(a.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.actualizado_en), 0)
       )), 0) AS max_ts
     FROM sop_dias d
     JOIN sop_contenedores c ON c.dia_id = d.id
     JOIN sop_expedientes e ON e.contenedor_id = c.id
     LEFT JOIN sop_exp_archivos a ON a.expediente_id = e.id
     LEFT JOIN sop_rips_archivos ra ON ra.expediente_id = e.id
     WHERE d.periodo_id = ? ${diaFilter}`,
    [periodoId]
  );
  return rows[0] || { file_count: 0, exp_count: 0, max_ts: 0 };
}

async function computeDiaFingerprint(diaId) {
  const rows = await db.query(
    `SELECT
       COUNT(DISTINCT a.id) + COUNT(DISTINCT ra.id) AS file_count,
       COUNT(DISTINCT e.id) AS exp_count,
       COALESCE(MAX(GREATEST(
         COALESCE(UNIX_TIMESTAMP(a.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.actualizado_en), 0)
       )), 0) AS max_ts
     FROM sop_dias d
     JOIN sop_contenedores c ON c.dia_id = d.id
     JOIN sop_expedientes e ON e.contenedor_id = c.id
     LEFT JOIN sop_exp_archivos a ON a.expediente_id = e.id
     LEFT JOIN sop_rips_archivos ra ON ra.expediente_id = e.id
     WHERE d.id = ?`,
    [diaId]
  );
  return rows[0] || { file_count: 0, exp_count: 0, max_ts: 0 };
}

async function computeContenedorFingerprint(contenedorId) {
  const rows = await db.query(
    `SELECT
       COUNT(DISTINCT a.id) + COUNT(DISTINCT ra.id) AS file_count,
       COUNT(DISTINCT e.id) AS exp_count,
       COALESCE(MAX(GREATEST(
         COALESCE(UNIX_TIMESTAMP(a.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.actualizado_en), 0)
       )), 0) AS max_ts
     FROM sop_expedientes e
     LEFT JOIN sop_exp_archivos a ON a.expediente_id = e.id
     LEFT JOIN sop_rips_archivos ra ON ra.expediente_id = e.id
     WHERE e.contenedor_id = ?`,
    [contenedorId]
  );
  return rows[0] || { file_count: 0, exp_count: 0, max_ts: 0 };
}

async function computeExpedienteFingerprint(expedienteId) {
  const rows = await db.query(
    `SELECT
       COUNT(DISTINCT a.id) + COUNT(DISTINCT ra.id) AS file_count,
       1 AS exp_count,
       COALESCE(MAX(GREATEST(
         COALESCE(UNIX_TIMESTAMP(a.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.creado_en), 0),
         COALESCE(UNIX_TIMESTAMP(ra.actualizado_en), 0)
       )), 0) AS max_ts
     FROM sop_expedientes e
     LEFT JOIN sop_exp_archivos a ON a.expediente_id = e.id
     LEFT JOIN sop_rips_archivos ra ON ra.expediente_id = e.id
     WHERE e.id = ?`,
    [expedienteId]
  );
  return rows[0] || { file_count: 0, exp_count: 0, max_ts: 0 };
}

async function computeJobFingerprint(spec) {
  if (!spec?.kind) return { file_count: 0, exp_count: 0, max_ts: 0 };
  if (PERIOD_ZIP_KINDS.has(spec.kind) && spec.periodoId) {
    return computePeriodoFingerprint(spec.periodoId, spec.kind);
  }
  if ((spec.kind === 'dia' || spec.kind === 'dia-carpeta') && spec.diaId) {
    return computeDiaFingerprint(spec.diaId);
  }
  if (spec.kind === 'contenedor' && spec.contenedorId) {
    return computeContenedorFingerprint(spec.contenedorId);
  }
  if (spec.kind === 'expediente' && spec.expedienteId) {
    return computeExpedienteFingerprint(spec.expedienteId);
  }
  return { file_count: 0, exp_count: 0, max_ts: 0 };
}

function readManifest(cacheId) {
  const { manifestPath } = cachePaths(cacheId);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function tryGetCachedZipForSpec(spec) {
  const cacheId = jobCacheId(spec);
  if (!cacheId) return null;
  const { zipPath } = cachePaths(cacheId);
  const manifest = readManifest(cacheId);
  if (!manifest || !manifest.fingerprint) return null;
  if (!fs.existsSync(zipPath)) return null;

  const fp = await computeJobFingerprint(spec);
  if (!fp.file_count) return null;
  if (fingerprintKey(fp) !== manifest.fingerprint) return null;

  return {
    filePath: zipPath,
    filename: manifest.filename || path.basename(zipPath),
    fromCache: true
  };
}

/** @deprecated use tryGetCachedZipForSpec */
async function tryGetCachedZip(periodoId, kind) {
  return tryGetCachedZipForSpec({ kind, periodoId });
}

async function saveToCacheForSpec(spec, sourceZipPath, filename) {
  const cacheId = jobCacheId(spec);
  if (!cacheId || !sourceZipPath) return;
  if (!fs.existsSync(sourceZipPath)) return;

  const { zipPath, manifestPath } = cachePaths(cacheId);
  try {
    if (path.resolve(sourceZipPath) !== path.resolve(zipPath)) {
      fs.copyFileSync(sourceZipPath, zipPath);
    }
    const fp = await computeJobFingerprint(spec);
    fs.writeFileSync(manifestPath, JSON.stringify({
      cacheId,
      kind: spec.kind,
      fingerprint: fingerprintKey(fp),
      filename: filename || path.basename(zipPath),
      builtAt: Date.now(),
      file_count: fp.file_count
    }));
  } catch (e) {
    logger.warn('[SOPORTES] zip cache save:', e.message);
  }
}

/** @deprecated */
async function saveToCache(periodoId, kind, sourceZipPath, filename) {
  return saveToCacheForSpec({ kind, periodoId }, sourceZipPath, filename);
}

function invalidatePeriodoZipCache(periodoId) {
  if (!periodoId) return;
  try {
    for (const kind of PERIOD_ZIP_KINDS) {
      const cacheId = `${periodoId}-${kind}`;
      const { zipPath, manifestPath } = cachePaths(cacheId);
      [zipPath, manifestPath].forEach((p) => {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
        }
      });
    }
  } catch (e) {
    logger.warn('[SOPORTES] zip cache invalidate:', e.message);
  }
}

function getCacheZipPath(periodoId, kind) {
  return cachePaths(`${periodoId}-${kind}`).zipPath;
}

module.exports = {
  PERIOD_ZIP_KINDS,
  jobCacheId,
  tryGetCachedZip,
  tryGetCachedZipForSpec,
  saveToCache,
  saveToCacheForSpec,
  getCacheZipPath,
  invalidatePeriodoZipCache,
  computeJobFingerprint,
  computePeriodoFingerprint,
  fingerprintKey,
  getCacheDir,
  cachePaths
};
