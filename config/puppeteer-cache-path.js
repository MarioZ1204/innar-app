/**
 * Caché persistente de Chrome para Puppeteer (certificados / comprobantes).
 *
 * En Hostinger, si UPLOADS_DIR apunta a private_uploads fuera del repo,
 * la caché por defecto será ../private_puppeteer (misma carpeta padre).
 */
const path = require('path');
const fs = require('fs');

function resolvePuppeteerCacheDir() {
  const fromEnv = process.env.PUPPETEER_CACHE_DIR && String(process.env.PUPPETEER_CACHE_DIR).trim();
  if (fromEnv) return path.resolve(fromEnv);

  const uploadsEnv = process.env.UPLOADS_DIR && String(process.env.UPLOADS_DIR).trim();
  if (uploadsEnv) {
    const uploadsRoot = path.resolve(uploadsEnv);
    return path.join(path.dirname(uploadsRoot), 'private_puppeteer');
  }

  return path.resolve(__dirname, '..', '.cache', 'puppeteer');
}

function getPuppeteerCacheDir() {
  const dir = resolvePuppeteerCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function applyPuppeteerCacheEnv() {
  const dir = getPuppeteerCacheDir();
  process.env.PUPPETEER_CACHE_DIR = dir;
  return dir;
}

module.exports = {
  resolvePuppeteerCacheDir,
  getPuppeteerCacheDir,
  applyPuppeteerCacheEnv,
};
