// config/static-files.js
// Servidor de archivos estáticos + inyección de versión en index.html

const fs = require('fs');
const path = require('path');
const express = require('express');

function staticCacheHeaders(res, filePath) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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

function buildIndexHandler(publicDir, appVersion) {
  return function indexHandler(req, res) {
    const htmlPath = path.join(publicDir, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const vTag = `?v=${appVersion}`;
    html = html
      .replace('href="style.css"', `href="style.css${vTag}"`)
      .replace('href="style.css"', `href="style.css${vTag}"`)
      .replace('src="multiselect.js"', `src="multiselect.js${vTag}"`)
      .replace('src="socket-client.js"', `src="socket-client.js${vTag}"`)
      .replace('src="socket-electro.js"', `src="socket-electro.js${vTag}"`)
      .replace('src="dashboard-citas.js"', `src="dashboard-citas.js${vTag}"`)
      .replace('src="calendario-agenda.js"', `src="calendario-agenda.js${vTag}"`)
      .replace('src="app.js"', `src="app.js${vTag}"`)
      .replace('src="calendario-bloqueado.js"', `src="calendario-bloqueado.js${vTag}"`)
      .replace('src="validation-client.js"', `src="validation-client.js${vTag}"`)
      .replace('src="splash.js"', `src="splash.js${vTag}"`)
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
function applyStaticFiles(app, { publicDir, appVersion }) {
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/', buildIndexHandler(publicDir, appVersion));

  const staticMw = express.static(publicDir, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: staticCacheHeaders
  });

  // Bloquea acceso directo a /uploads/* del estático (delega a /uploads/:filename autenticado).
  app.use((req, res, next) => {
    if (req.path.startsWith('/uploads/')) return next();
    return staticMw(req, res, next);
  });
}

module.exports = { applyStaticFiles, staticCacheHeaders, buildIndexHandler };
