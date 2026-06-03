const path = require('path');
const fs = require('fs');
const { getUploadsRoot, getSoportesRoot } = require('../config/uploads-path');

/** Siempre leer UPLOADS_DIR actual (no cachear al cargar el módulo). */
function uploadsRoot() {
  return getUploadsRoot();
}

function soportesRoot() {
  return getSoportesRoot();
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    const err = new Error(`No se pudo crear directorio: ${dir}`);
    err.code = e.code || 'ENSURE_DIR_FAILED';
    err.cause = e;
    throw err;
  }
}

function getPdxDir(carpetaId) {
  const dir = path.join(soportesRoot(), 'pdx', String(carpetaId));
  ensureDir(dir);
  return dir;
}

/** @deprecated Use getArmadoFeDirAbs from soportes-armado-structure */
function getArmadoExpedienteDir(periodo, dia, codigo) {
  const dir = path.join(soportesRoot(), 'armado', periodo, String(dia), codigo);
  ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'].forEach((sub) => ensureDir(path.join(dir, sub)));
  return dir;
}

function getArmadoFeDirFromContext(ctx, codigo) {
  const { getArmadoFeDirAbs } = require('./soportes-armado-structure');
  return getArmadoFeDirAbs(
    soportesRoot(),
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

function stripMulterTimestamp(filename) {
  return String(filename || '').replace(/^\d{10,}-/, '');
}

function legacyPublicUploadsRoot() {
  return path.resolve(__dirname, '..', 'public', 'uploads');
}

function resolveStoragePath(rutaRelativa) {
  const rel = String(rutaRelativa || '').replace(/^uploads\//, '').replace(/\\/g, '/').trim();
  if (!rel) return null;

  const root = uploadsRoot();
  const candidates = [];

  if (rel.startsWith('soportes/')) {
    candidates.push(path.resolve(root, rel));
  } else if (rel.startsWith('pdx/')) {
    candidates.push(path.join(soportesRoot(), rel));
    candidates.push(path.resolve(root, 'soportes', rel));
  } else {
    candidates.push(path.resolve(root, rel));
    candidates.push(path.join(soportesRoot(), rel));
    candidates.push(path.resolve(root, 'soportes', rel));
  }

  const leg = legacyPublicUploadsRoot();
  candidates.push(path.join(leg, rel));
  if (rel.startsWith('soportes/')) {
    candidates.push(path.join(leg, rel));
  }

  for (const full of candidates) {
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function listPdxPdfsInCarpeta(carpetaId) {
  try {
    const dir = getPdxDir(carpetaId);
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch (_) {
    return [];
  }
}

function matchPdxFileInCarpeta(carpetaId, names, archivoRow) {
  const dir = getPdxDir(carpetaId);
  const files = listPdxPdfsInCarpeta(carpetaId);
  const want = names
    .map((n) => path.basename(String(n || '')))
    .filter((n) => n && n !== '.' && n !== '..');
  const orig = path.basename(String(archivoRow?.nombre_archivo_original || '')).toLowerCase();
  const origCore = orig.replace(/\.pdf$/i, '').slice(0, 40);

  for (const f of files) {
    const fLow = f.toLowerCase();
    const fStripped = stripMulterTimestamp(f).toLowerCase();
    if (want.some((w) => {
      const wLow = w.toLowerCase();
      return wLow === fLow || stripMulterTimestamp(w).toLowerCase() === fStripped;
    })) {
      return path.join(dir, f);
    }
    if (origCore && fLow.includes(origCore)) return path.join(dir, f);
  }

  if (files.length === 1 && want.length) {
    return path.join(dir, files[0]);
  }
  return null;
}

/** Resuelve PDF PDX probando ruta en BD, legacy public/uploads, carpeta en disco y nombres alternativos. */
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
      const withTs = listPdxPdfsInCarpeta(carpetaId).find(
        (f) => stripMulterTimestamp(f) === base || f.endsWith(base)
      );
      if (withTs) return path.join(dir, withTs);
    }
    const matched = matchPdxFileInCarpeta(carpetaId, names, archivoRow);
    if (matched) return matched;
  }

  return null;
}

function relativePdxRuta(carpetaId, diskBasename) {
  return path.join('soportes', 'pdx', String(carpetaId), diskBasename).replace(/\\/g, '/');
}

ensureDir(soportesRoot());
ensureDir(path.join(soportesRoot(), 'pdx'));
ensureDir(path.join(soportesRoot(), 'armado'));

module.exports = {
  get uploadsRoot() { return uploadsRoot(); },
  get soportesRoot() { return soportesRoot(); },
  get UPLOADS_ROOT() { return uploadsRoot(); },
  get SOPORTES_ROOT() { return soportesRoot(); },
  getPdxDir,
  getArmadoExpedienteDir,
  getArmadoFeDirFromContext,
  safeFilename,
  stripMulterTimestamp,
  resolveStoragePath,
  resolvePdxArchivoPath,
  relativePdxRuta,
  listPdxPdfsInCarpeta,
  ensureDir
};
