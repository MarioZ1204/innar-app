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

/** Añade ?v=APP_VERSION a CSS/JS locales (cache bust tras deploy). */
function injectAssetVersion(html, appVersion) {
  const vTag = `?v=${appVersion}`;
  const withTag = (url) => (url.includes('?v=') ? url : `${url}${vTag}`);

  html = html.replace(
    /href="(?!https?:\/\/)([^"?]+\.css)"/g,
    (match, asset) => `href="${withTag(asset)}"`
  );
  html = html.replace(
    /src="(?!https?:\/\/|\/libs\/)([^"?]+\.js)"/g,
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
function applyStaticFiles(app, { publicDir, appVersion }) {
  app.get('/favicon.ico', (req, res) => res.redirect(302, '/images/icon.png'));
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

module.exports = { applyStaticFiles, staticCacheHeaders, buildIndexHandler, injectAssetVersion };
