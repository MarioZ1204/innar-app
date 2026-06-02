const path = require('path');
const fs = require('fs');
const { getUploadsRoot, getSoportesRoot, isInsideUploadsRoot } = require('../config/uploads-path');

const SOPORTES_ROOT = getSoportesRoot();
const UPLOADS_ROOT = getUploadsRoot();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getPdxDir(carpetaId) {
  const dir = path.join(SOPORTES_ROOT, 'pdx', String(carpetaId));
  ensureDir(dir);
  return dir;
}

/** @deprecated Use getArmadoFeDirAbs from soportes-armado-structure */
function getArmadoExpedienteDir(periodo, dia, codigo) {
  const dir = path.join(SOPORTES_ROOT, 'armado', periodo, String(dia), codigo);
  ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'].forEach((sub) => ensureDir(path.join(dir, sub)));
  return dir;
}

function getArmadoFeDirFromContext(ctx, codigo) {
  const {
    getArmadoFeDirAbs
  } = require('./soportes-armado-structure');
  return getArmadoFeDirAbs(
    SOPORTES_ROOT,
    ctx.periodo,
    ctx.nombre_display || `Día ${ctx.dia}`,
    ctx.estado_facturacion || 'a_facturar',
    ctx.contenedor_tipo || ctx.tipo || 'soportes',
    codigo
  );
}

function safeFilename(original) {
  const base = path.basename(String(original || 'archivo.pdf'));
  return `${Date.now()}-${base.replace(/[^a-zA-Z0-9.\-_,() ]/g, '_')}`;
}

function resolveStoragePath(rutaRelativa) {
  const rel = String(rutaRelativa || '').replace(/^uploads\//, '').replace(/\\/g, '/').trim();
  if (!rel) return null;

  const candidates = [];
  if (rel.startsWith('soportes/')) {
    candidates.push(path.resolve(UPLOADS_ROOT, rel));
  } else if (rel.startsWith('pdx/')) {
    candidates.push(path.join(SOPORTES_ROOT, rel));
    candidates.push(path.resolve(UPLOADS_ROOT, 'soportes', rel));
  } else {
    candidates.push(path.resolve(UPLOADS_ROOT, rel));
    candidates.push(path.join(SOPORTES_ROOT, rel));
    candidates.push(path.resolve(UPLOADS_ROOT, 'soportes', rel));
  }

  for (const full of candidates) {
    if (!isInsideUploadsRoot(full)) continue;
    if (fs.existsSync(full)) return full;
  }
  const first = candidates.find((p) => isInsideUploadsRoot(p));
  return first || null;
}

/** Resuelve PDF PDX probando ruta en BD, carpeta en disco y nombres alternativos. */
function resolvePdxArchivoPath(archivoRow) {
  if (!archivoRow) return null;
  const fromDb = resolveStoragePath(archivoRow.ruta_relativa);
  if (fromDb && fs.existsSync(fromDb)) return fromDb;

  const carpetaId = archivoRow.carpeta_id;
  const names = [
    path.basename(String(archivoRow.ruta_relativa || '')),
    archivoRow.nombre_archivo_display,
    archivoRow.nombre_archivo_original
  ].filter(Boolean);

  if (carpetaId) {
    const dir = getPdxDir(carpetaId);
    for (const name of names) {
      const base = path.basename(String(name));
      if (!base || base === '.' || base === '..') continue;
      const fp = path.join(dir, base);
      if (fs.existsSync(fp)) return fp;
    }
    try {
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
      const origBase = path.basename(String(archivoRow.nombre_archivo_original || '')).toLowerCase();
      if (origBase) {
        const match = files.find((f) => f.toLowerCase().includes(origBase.replace(/\.pdf$/i, '').slice(0, 24)));
        if (match) return path.join(dir, match);
      }
    } catch (_) { /* ignore */ }
  }

  return fromDb && fs.existsSync(fromDb) ? fromDb : null;
}

ensureDir(SOPORTES_ROOT);
ensureDir(path.join(SOPORTES_ROOT, 'pdx'));
ensureDir(path.join(SOPORTES_ROOT, 'armado'));

module.exports = {
  SOPORTES_ROOT,
  UPLOADS_ROOT,
  getPdxDir,
  getArmadoExpedienteDir,
  getArmadoFeDirFromContext,
  safeFilename,
  resolveStoragePath,
  resolvePdxArchivoPath,
  ensureDir
};
