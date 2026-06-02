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

function getUploadsRoot() {
  const root = resolveUploadsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

function getSoportesRoot() {
  const dir = path.join(getUploadsRoot(), 'soportes');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
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
  isInsideUploadsRoot
};
