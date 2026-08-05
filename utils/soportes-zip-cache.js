'use strict';

/**
 * Caché persistente de ZIP por periodo/tipo.
 * Si los archivos del mes no cambiaron, la descarga es inmediata (sin regenerar).
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

function cachePaths(periodoId, kind) {
  const base = path.join(getCacheDir(), `${periodoId}-${kind}`);
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

function readManifest(periodoId, kind) {
  const { manifestPath } = cachePaths(periodoId, kind);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function tryGetCachedZip(periodoId, kind) {
  if (!PERIOD_ZIP_KINDS.has(kind) || !periodoId) return null;
  const { zipPath } = cachePaths(periodoId, kind);
  const manifest = readManifest(periodoId, kind);
  if (!manifest || !manifest.fingerprint) return null;
  if (!fs.existsSync(zipPath)) return null;

  const fp = await computePeriodoFingerprint(periodoId, kind);
  if (!fp.file_count) return null;
  if (fingerprintKey(fp) !== manifest.fingerprint) return null;

  return {
    filePath: zipPath,
    filename: manifest.filename || path.basename(zipPath),
    fromCache: true
  };
}

async function saveToCache(periodoId, kind, sourceZipPath, filename) {
  if (!PERIOD_ZIP_KINDS.has(kind) || !periodoId || !sourceZipPath) return;
  if (!fs.existsSync(sourceZipPath)) return;

  const { zipPath, manifestPath } = cachePaths(periodoId, kind);
  try {
    if (path.resolve(sourceZipPath) !== path.resolve(zipPath)) {
      fs.copyFileSync(sourceZipPath, zipPath);
    }
    await writeCacheManifest(periodoId, kind, filename || path.basename(zipPath));
  } catch (e) {
    logger.warn('[SOPORTES] zip cache save:', e.message);
  }
}

async function writeCacheManifest(periodoId, kind, filename) {
  const { zipPath, manifestPath } = cachePaths(periodoId, kind);
  if (!fs.existsSync(zipPath)) return;
  const fp = await computePeriodoFingerprint(periodoId, kind);
  fs.writeFileSync(manifestPath, JSON.stringify({
    periodoId,
    kind,
    fingerprint: fingerprintKey(fp),
    filename: filename || path.basename(zipPath),
    builtAt: Date.now(),
    file_count: fp.file_count
  }));
}

function getCacheZipPath(periodoId, kind) {
  return cachePaths(periodoId, kind).zipPath;
}

function invalidatePeriodoZipCache(periodoId) {
  if (!periodoId) return;
  const dir = getCacheDir();
  try {
    for (const kind of PERIOD_ZIP_KINDS) {
      const { zipPath, manifestPath } = cachePaths(periodoId, kind);
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

module.exports = {
  PERIOD_ZIP_KINDS,
  tryGetCachedZip,
  saveToCache,
  writeCacheManifest,
  getCacheZipPath,
  invalidatePeriodoZipCache,
  computePeriodoFingerprint,
  fingerprintKey,
  getCacheDir,
  cachePaths
};
