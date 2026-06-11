// Opciones de lanzamiento de Puppeteer + helpers de logo
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const logger = require('./logger');

function resolveChromeExecutable() {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN
  ].filter(Boolean);
  for (const chromePath of envCandidates) {
    if (fs.existsSync(chromePath)) return chromePath;
  }
  const chromePaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/google-chrome',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) return chromePath;
  }
  return null;
}

function getPuppeteerLaunchOptions() {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error(
      'No se encontró Chrome/Chromium instalado. Defina PUPPETEER_EXECUTABLE_PATH o instale Chromium. ' +
      'En Hostinger: apt-get install -y chromium-browser. En Windows: Google Chrome o Microsoft Edge.'
    );
  }
  return {
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--font-render-hinting=none'
    ],
    dumpio: false
  };
}

/**
 * Renderiza HTML a PDF sin depender de red externa (p. ej. Google Fonts).
 */
async function renderHtmlToPdf(html, options = {}) {
  const {
    format = 'A4',
    printBackground = true,
    margin = { top: '0', bottom: '0', left: '0', right: '0' },
    waitFonts = true,
    contentTimeout = 60000,
    fontsTimeoutMs = 3000
  } = options;

  const launchOptions = getPuppeteerLaunchOptions();
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setContent(html, { waitUntil: 'load', timeout: contentTimeout });
    if (waitFonts) {
      await page.evaluate((ms) => Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, ms))
      ]), fontsTimeoutMs);
    }
    return await page.pdf({ format, printBackground, margin });
  } finally {
    await browser.close().catch(() => {});
  }
}

let logoBase64 = '';
let logoReciboBase64 = null;
let certificadoAsistenciaFondoCache = null;
let comprobanteServiciosFondoCache = null;

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

function getComprobanteServiciosFondo() {
  if (comprobanteServiciosFondoCache) return comprobanteServiciosFondoCache;
  const files = [
    { name: 'comprobante-servicios-fondo.png', mime: 'image/png' },
    { name: 'comprobante-servicios-fondo.jpg', mime: 'image/jpeg' },
    { name: 'comprobante-servicios-fondo.jpeg', mime: 'image/jpeg' },
    { name: 'comprobante-servicios-fondo.webp', mime: 'image/webp' }
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
          comprobanteServiciosFondoCache = {
            base64: fs.readFileSync(p).toString('base64'),
            mime: file.mime
          };
          return comprobanteServiciosFondoCache;
        } catch (e) {
          logger.warn('Error cargando fondo comprobante servicios:', e.message);
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
  renderHtmlToPdf,
  getLogoBase64,
  getLogoReciboBase64,
  getCertificadoAsistenciaFondo,
  getComprobanteServiciosFondo
};
