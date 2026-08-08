// Opciones de lanzamiento de Puppeteer + helpers de logo
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const logger = require('./logger');
const { readFileBuffer, pathExists } = require('./fs-async');
const { applyPuppeteerCacheEnv, getPuppeteerCacheDir } = require('../config/puppeteer-cache-path');

function puppeteerCacheDir() {
  return getPuppeteerCacheDir();
}

function resolveBundledChromeExecutable() {
  applyPuppeteerCacheEnv();
  try {
    const puppeteerFull = require('puppeteer');
    if (typeof puppeteerFull.executablePath === 'function') {
      const bundled = puppeteerFull.executablePath();
      if (bundled && fs.existsSync(bundled)) return bundled;
    }
  } catch (e) {
    logger.warn('Puppeteer empaquetado no disponible:', e.message);
  }

  const cacheRoots = [
    puppeteerCacheDir(),
    path.join(process.env.HOME || '', '.cache', 'puppeteer'),
    path.join(__dirname, '..', 'node_modules', 'puppeteer', '.cache')
  ].filter(Boolean);

  const execNames = process.platform === 'win32'
    ? ['chrome.exe', 'chromium.exe']
    : ['chrome', 'chromium', 'chromium-browser', 'google-chrome'];

  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    const found = buscarEjecutableChrome(root, execNames, 0, 6);
    if (found) return found;
  }
  return null;
}

function buscarEjecutableChrome(dir, execNames, depth, maxDepth) {
  if (depth > maxDepth) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && execNames.includes(entry.name) && esEjecutableChrome(full)) {
      return full;
    }
    if (entry.isDirectory()) {
      const nested = buscarEjecutableChrome(full, execNames, depth + 1, maxDepth);
      if (nested) return nested;
    }
  }
  return null;
}

function esEjecutableChrome(filePath) {
  if (process.platform === 'win32') return filePath.toLowerCase().endsWith('.exe');
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveChromeExecutable() {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN
  ].filter(Boolean);
  for (const chromePath of envCandidates) {
    if (fs.existsSync(chromePath)) return chromePath;
  }

  const bundled = resolveBundledChromeExecutable();
  if (bundled) return bundled;

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

function getChromiumDiagnostic() {
  const executablePath = resolveChromeExecutable();
  return {
    platform: process.platform,
    executablePath: executablePath || null,
    executableExists: !!(executablePath && fs.existsSync(executablePath)),
    cacheDir: puppeteerCacheDir(),
    envPath: process.env.PUPPETEER_EXECUTABLE_PATH || null
  };
}

function buildPuppeteerLaunchArgs(extra = []) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--no-first-run',
    '--font-render-hinting=none',
    ...extra
  ];
  if (process.platform === 'linux') {
    args.push('--no-zygote');
  }
  return args;
}

function getPuppeteerLaunchOptions(extraArgs = []) {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error(
      'No se encontró Chrome/Chromium. Ejecute npm install (descarga Chrome con puppeteer) o defina PUPPETEER_EXECUTABLE_PATH.'
    );
  }
  return {
    executablePath,
    headless: true,
    args: buildPuppeteerLaunchArgs(extraArgs),
    dumpio: false
  };
}

function pdfRenderTimeoutMs() {
  const n = parseInt(process.env.CERT_PDF_TIMEOUT_MS || '45000', 10);
  return Number.isFinite(n) && n >= 10000 ? n : 45000;
}

/**
 * Renderiza HTML a PDF sin depender de red externa (p. ej. Google Fonts).
 */
async function tryRenderHtmlToPdf(html, options = {}) {
  const timeoutMs = options.timeoutMs ?? pdfRenderTimeoutMs();
  const contentTimeout = Math.min(options.contentTimeout ?? timeoutMs, timeoutMs);
  try {
    const pdf = await Promise.race([
      renderHtmlToPdf(html, { ...options, contentTimeout }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Tiempo de espera agotado generando PDF')), timeoutMs);
      })
    ]);
    return { ok: true, pdf };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function probeChromiumLaunch() {
  const attempts = [
    () => getPuppeteerLaunchOptions(),
    () => getPuppeteerLaunchOptions(['--single-process']),
  ];
  let lastError = null;
  for (const build of attempts) {
    try {
      const launchOptions = build();
      const browser = await puppeteer.launch(launchOptions);
      await browser.close().catch(() => {});
      return { ok: true, executablePath: launchOptions.executablePath };
    } catch (e) {
      lastError = e;
    }
  }
  return { ok: false, error: lastError?.message || 'No se pudo lanzar Chrome', ...getChromiumDiagnostic() };
}

async function launchBrowserWithFallback() {
  const attempts = [
    () => puppeteer.launch(getPuppeteerLaunchOptions()),
    () => puppeteer.launch(getPuppeteerLaunchOptions(['--single-process'])),
  ];
  let lastError = null;
  for (const launch of attempts) {
    try {
      return await launch();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('No se pudo lanzar Chrome');
}

const BROWSER_IDLE_MS = parseInt(process.env.PUPPETEER_BROWSER_IDLE_MS || '300000', 10) || 300000;
let sharedBrowser = null;
let sharedBrowserLaunch = null;
let browserIdleTimer = null;

function scheduleSharedBrowserIdleClose() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(() => {
    void closeSharedBrowser('idle');
  }, BROWSER_IDLE_MS);
}

async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.connected) {
    scheduleSharedBrowserIdleClose();
    return sharedBrowser;
  }
  if (!sharedBrowserLaunch) {
    sharedBrowserLaunch = launchBrowserWithFallback()
      .then((browser) => {
        sharedBrowser = browser;
        sharedBrowserLaunch = null;
        browser.on('disconnected', () => {
          sharedBrowser = null;
        });
        scheduleSharedBrowserIdleClose();
        return browser;
      })
      .catch((e) => {
        sharedBrowserLaunch = null;
        throw e;
      });
  }
  return sharedBrowserLaunch;
}

async function closeSharedBrowser(reason = 'manual') {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  const browser = sharedBrowser;
  sharedBrowser = null;
  sharedBrowserLaunch = null;
  if (browser) {
    try {
      await browser.close();
    } catch (_) { /* noop */ }
    logger.info('[PUPPETEER] Navegador compartido cerrado', { reason });
  }
}

async function renderHtmlToPdf(html, options = {}) {
  const {
    format = 'A4',
    printBackground = true,
    margin = { top: '0', bottom: '0', left: '0', right: '0' },
    waitFonts = true,
    contentTimeout = pdfRenderTimeoutMs(),
    fontsTimeoutMs = 800,
    preferCSSPageSize = true
  } = options;

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(contentTimeout);
    page.setDefaultTimeout(contentTimeout);
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: contentTimeout });
    if (waitFonts) {
      await page.evaluate((ms) => Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, ms))
      ]), fontsTimeoutMs);
    }
    return await page.pdf({ format, printBackground, margin, preferCSSPageSize });
  } finally {
    await page.close().catch(() => {});
    scheduleSharedBrowserIdleClose();
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

// Precarga no bloqueante en segundo plano
setImmediate(() => {
  (async () => {
    try {
      const logoPath = getLogoPath();
      if (logoPath && await pathExists(logoPath)) {
        logoBase64 = (await readFileBuffer(logoPath)).toString('base64');
      }
    } catch (_) { /* ignore */ }
  })();
});

module.exports = {
  getPuppeteerLaunchOptions,
  getChromiumDiagnostic,
  probeChromiumLaunch,
  tryRenderHtmlToPdf,
  renderHtmlToPdf,
  getSharedBrowser,
  closeSharedBrowser,
  getLogoBase64,
  getLogoReciboBase64,
  getCertificadoAsistenciaFondo,
  getComprobanteServiciosFondo
};
