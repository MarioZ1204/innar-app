/**
 * Raíz de archivos subidos (PDF agenda, soportes PDX, armado, etc.).
 *
 * En producción (Hostinger) definir UPLOADS_DIR apuntando a una carpeta
 * FUERA del repositorio git, para que git pull / redeploy no borre los PDF.
 *
 * Ejemplo Hostinger:
 *   UPLOADS_DIR=/home/USUARIO/domains/tudominio.com/private_uploads
 */
const path = require('path');
const fs = require('fs');

function resolveUploadsRoot() {
  const fromEnv = process.env.UPLOADS_DIR && String(process.env.UPLOADS_DIR).trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, '..', 'public', 'uploads');
}

function tryMkdir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function getUploadsRoot() {
  const root = resolveUploadsRoot();
  tryMkdir(root);
  return root;
}

function getSoportesRoot() {
  const dir = path.join(getUploadsRoot(), 'soportes');
  tryMkdir(dir);
  return dir;
}

let uploadsWritableCache = null;
let uploadsWritableCacheAt = 0;
const UPLOADS_WRITABLE_CACHE_MS = 30000;

function writeProbe(dir, label) {
  const testFile = path.join(dir, `.write_test_${process.pid}_${label}`);
  fs.writeFileSync(testFile, 'ok');
  fs.unlinkSync(testFile);
}

/** Comprueba si UPLOADS_DIR existe y permite escribir (raíz + soportes/armado). */
function checkUploadsWritable() {
  const root = resolveUploadsRoot();
  const result = {
    path: root,
    exists: fs.existsSync(root),
    writable: false,
    soportesWritable: false,
    armadoWritable: false,
    error: null
  };
  try {
    if (!result.exists) tryMkdir(root);
    result.exists = fs.existsSync(root);
    if (!result.exists) {
      result.error = 'La carpeta no existe y no se pudo crear';
      return result;
    }
    writeProbe(root, 'root');
    result.writable = true;

    const soportesDir = path.join(root, 'soportes');
    tryMkdir(soportesDir);
    writeProbe(soportesDir, 'soportes');
    result.soportesWritable = true;

    const armadoDir = path.join(soportesDir, 'armado');
    tryMkdir(armadoDir);
    writeProbe(armadoDir, 'armado');
    result.armadoWritable = true;
  } catch (e) {
    result.error = e.message || String(e);
    if (result.writable && !result.armadoWritable) {
      result.error = `Raíz escribible pero soportes/armado no: ${result.error}`;
    } else if (result.writable && !result.soportesWritable) {
      result.error = `Raíz escribible pero soportes/ no: ${result.error}`;
    }
  }
  return result;
}

/** Resultado cacheado (30 s) para no probar disco en cada petición de listado. */
function isUploadsWritable() {
  const now = Date.now();
  if (uploadsWritableCache && now - uploadsWritableCacheAt < UPLOADS_WRITABLE_CACHE_MS) {
    return uploadsWritableCache;
  }
  const checked = checkUploadsWritable();
  uploadsWritableCache = {
    ...checked,
    /** Sync RIPS / carpetas FE requiere poder crear bajo soportes/armado. */
    writableForArmado: !!(checked.writable && checked.armadoWritable)
  };
  uploadsWritableCacheAt = now;
  return uploadsWritableCache;
}

function isInsideUploadsRoot(fullPath) {
  const root = path.resolve(getUploadsRoot());
  const full = path.resolve(fullPath);
  return full === root || full.startsWith(root + path.sep);
}

module.exports = {
  resolveUploadsRoot,
  getUploadsRoot,
  getSoportesRoot,
  isInsideUploadsRoot,
  checkUploadsWritable,
  isUploadsWritable,
  tryMkdir
};
