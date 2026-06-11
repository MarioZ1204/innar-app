// Opciones de lanzamiento de Puppeteer + helpers de logo
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function getPuppeteerLaunchOptions() {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'],
    dumpio: false
  };
  const chromePaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      launchOptions.executablePath = chromePath;
      break;
    }
  }
  if (!launchOptions.executablePath) {
    throw new Error(
      'No se encontró Chrome/Chromium instalado. En Hostinger ejecute: apt-get install -y chromium-browser. ' +
      'En Windows instale Google Chrome o Microsoft Edge.'
    );
  }
  return launchOptions;
}

let logoBase64 = '';
let logoReciboBase64 = null;
let certificadoAsistenciaFondoCache = null;

function getLogoPath() {
  const possiblePaths = [
    path.join(__dirname, '..', 'public', 'images', 'logo.png'),
    path.join(__dirname, '..', 'public', 'logo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logo.png'),
    path.join(process.execPath, '..', 'public', 'logo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getLogoBase64() {
  if (logoBase64) return logoBase64;
  const logoPath = getLogoPath();
  if (logoPath) {
    try {
      logoBase64 = fs.readFileSync(logoPath).toString('base64');
    } catch (e) {
      logger.warn('Error cargando logo:', e.message);
    }
  }
  return logoBase64;
}

function getLogoReciboBase64() {
  if (logoReciboBase64) return logoReciboBase64;
  const possiblePaths = [
    path.join(__dirname, '..', 'public', 'images', 'logorecibo.png'),
    path.join(__dirname, '..', 'public', 'logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'logorecibo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try { logoReciboBase64 = fs.readFileSync(p).toString('base64'); } catch (_) {}
      break;
    }
  }
  return logoReciboBase64 || getLogoBase64();
}

function getCertificadoAsistenciaFondo() {
  if (certificadoAsistenciaFondoCache) return certificadoAsistenciaFondoCache;
  const files = [
    { name: 'certificado-asistencia-fondo.png', mime: 'image/png' },
    { name: 'certificado-asistencia-fondo.jpg', mime: 'image/jpeg' },
    { name: 'certificado-asistencia-fondo.jpeg', mime: 'image/jpeg' },
    { name: 'certificado-asistencia-fondo.webp', mime: 'image/webp' }
  ];
  const dirs = [
    path.join(__dirname, '..', 'public', 'images'),
    path.join(process.execPath, '..', 'public', 'images')
  ];
  for (const dir of dirs) {
    for (const file of files) {
      const p = path.join(dir, file.name);
      if (fs.existsSync(p)) {
        try {
          certificadoAsistenciaFondoCache = {
            base64: fs.readFileSync(p).toString('base64'),
            mime: file.mime
          };
          return certificadoAsistenciaFondoCache;
        } catch (e) {
          logger.warn('Error cargando fondo certificado asistencia:', e.message);
        }
      }
    }
  }
  return { base64: '', mime: 'image/png' };
}

// Precarga no crítica
try { getLogoBase64(); } catch (_) {}

module.exports = {
  getPuppeteerLaunchOptions,
  getLogoBase64,
  getLogoReciboBase64,
  getCertificadoAsistenciaFondo
};
