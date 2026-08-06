// config/static-files.js
// Servidor de archivos estáticos + inyección de versión en index.html

const fs = require('fs');
const path = require('path');
const express = require('express');

function staticCacheHeaders(res, filePath) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  } else if (filePath.endsWith('.mjs')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
    // Evita que clientes/proxies se queden con bundles viejos ante hotfixes urgentes.
    // Con revalidación en cada request reducimos riesgo de servir JS/CSS obsoletos.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  } else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
  } else if (/\.(woff2?|ttf|eot)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

/** HTML del visor PDF (no servir directamente; ruta autenticada /soportes/visor-pdf). */
const VISOR_PDF_SHELL_PATH = '/visor-pdf-shell.html';

function readVisorPdfHtml(appRoot) {
  const candidates = [
    path.join(appRoot, 'views', 'visor-pdf.html'),
    path.join(appRoot, 'public', 'visor-pdf-shell.html'),
  ];
  for (const htmlPath of candidates) {
    try {
      if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf8');
    } catch (_) { /* probar siguiente */ }
  }
  return null;
}

/** Añade o reemplaza ?v=APP_VERSION en CSS/JS locales (cache bust tras deploy). */
function injectAssetVersion(html, appVersion) {
  const vTag = `?v=${appVersion}`;
  const withTag = (url) => {
    const base = String(url).replace(/\?v=[^"'&]*/, '');
    return `${base}${vTag}`;
  };

  html = html.replace(
    /href="(?!https?:\/\/)([^"?]+\.css)(\?v=[^"]*)?"/g,
    (match, asset) => `href="${withTag(asset)}"`
  );
  html = html.replace(
    /src="(?!https?:\/\/)([^"?]+\.js)(\?v=[^"]*)?"/g,
    (match, asset) => `src="${withTag(asset)}"`
  );
  return html;
}

function buildIndexHandler(publicDir, appVersion) {
  return function indexHandler(req, res) {
    const htmlPath = path.join(publicDir, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = injectAssetVersion(html, appVersion);
    html = html
      .replace('</head>', `<script>window.APP_VERSION="${appVersion}";window.INNAR_REALTIME_MODE="http-poll";</script>\n</head>`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(html);
  };
}

/**
 * Configura ruta `GET /` con inyección de versión y un único `express.static`.
 * Excluye explícitamente `/uploads/` para forzar acceso autenticado vía
 * `routes/uploads.js` (privacidad clínica).
 */
/** Redirecciones cortas para WhatsApp (evita URLs largas de Google Maps). */
const UBICACION_MAPS_REDIRECT = {
  principal: 'https://maps.app.goo.gl/nuT1XWpDEg6vXVmS7',
  complementaria:
    'https://www.google.com/maps/search/?api=1&query=Carrera+33+%2313-84+Barrio+San+Ignacio+Pasto+Nari%C3%B1o'
};

function applyStaticFiles(app, { publicDir, appVersion }) {
  app.get('/favicon.ico', (req, res) => res.redirect(302, '/images/icon.png'));

  app.get('/ubicacion/:clave', (req, res) => {
    const dest = UBICACION_MAPS_REDIRECT[String(req.params.clave || '').toLowerCase()];
    if (!dest) {
      return res.status(404).type('text/plain; charset=utf-8').send('Ubicación no encontrada');
    }
    return res.redirect(302, dest);
  });

  app.get('/', buildIndexHandler(publicDir, appVersion));

  const staticMw = express.static(publicDir, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: staticCacheHeaders
  });

  // Bloquea acceso directo a /uploads/* y al shell del visor PDF (requiere sesión vía Express).
  app.use((req, res, next) => {
    if (req.path.startsWith('/uploads/')) return next();
    if (req.path === VISOR_PDF_SHELL_PATH) return next();
    return staticMw(req, res, next);
  });
}

module.exports = {
  applyStaticFiles,
  staticCacheHeaders,
  buildIndexHandler,
  injectAssetVersion,
  readVisorPdfHtml,
  VISOR_PDF_SHELL_PATH,
  UBICACION_MAPS_REDIRECT
};
