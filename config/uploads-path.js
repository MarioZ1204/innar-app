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

/** Comprueba si UPLOADS_DIR existe y permite escribir (para diagnóstico en producción). */
function checkUploadsWritable() {
  const root = resolveUploadsRoot();
  const result = { path: root, exists: fs.existsSync(root), writable: false, error: null };
  try {
    if (!result.exists) tryMkdir(root);
    result.exists = fs.existsSync(root);
    if (!result.exists) {
      result.error = 'La carpeta no existe y no se pudo crear';
      return result;
    }
    const testFile = path.join(root, `.write_test_${process.pid}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    result.writable = true;
  } catch (e) {
    result.error = e.message || String(e);
  }
  return result;
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
  tryMkdir
};
