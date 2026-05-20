const path = require('path');
const fs = require('fs');

const SOPORTES_ROOT = path.resolve(__dirname, '..', 'public', 'uploads', 'soportes');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getPdxDir(carpetaId) {
  const dir = path.join(SOPORTES_ROOT, 'pdx', String(carpetaId));
  ensureDir(dir);
  return dir;
}

function getArmadoExpedienteDir(periodo, dia, codigo) {
  const dir = path.join(SOPORTES_ROOT, 'armado', periodo, String(dia), codigo);
  ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'].forEach((sub) => ensureDir(path.join(dir, sub)));
  return dir;
}

function safeFilename(original) {
  const base = path.basename(String(original || 'archivo.pdf'));
  return `${Date.now()}-${base.replace(/[^a-zA-Z0-9.\-_,() ]/g, '_')}`;
}

function resolveStoragePath(rutaRelativa) {
  const rel = String(rutaRelativa || '').replace(/^uploads\//, '').replace(/\\/g, '/');
  const full = path.resolve(path.join(SOPORTES_ROOT, '..'), rel);
  const root = path.resolve(path.join(SOPORTES_ROOT, '..'));
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

ensureDir(SOPORTES_ROOT);
ensureDir(path.join(SOPORTES_ROOT, 'pdx'));
ensureDir(path.join(SOPORTES_ROOT, 'armado'));

module.exports = {
  SOPORTES_ROOT,
  getPdxDir,
  getArmadoExpedienteDir,
  safeFilename,
  resolveStoragePath,
  ensureDir
};
