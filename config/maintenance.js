/**
 * Modo mantenimiento: bloquea la app (HTML y API) mientras se migra o actualiza.
 *
 * Activar (cualquiera de estas):
 *   MAINTENANCE_MODE=true   en .env / Hostinger
 *   Crear archivo maintenance.flag en la raíz del proyecto
 *   npm run maintenance:on
 *
 * Desactivar:
 *   MAINTENANCE_MODE=false o quitar la variable
 *   Borrar maintenance.flag
 *   npm run maintenance:off
 *
 * Opcional:
 *   MAINTENANCE_TITLE=...
 *   MAINTENANCE_MESSAGE=...
 *   MAINTENANCE_UNTIL=Estimado: hoy 18:00
 *   MAINTENANCE_BYPASS_KEY=secreto  →  ?bypass=secreto (cookie 2 h)
 */
const fs = require('fs');
const path = require('path');

const FLAG_FILE = path.join(process.cwd(), 'maintenance.flag');
const CONFIG_FILE = path.join(process.cwd(), 'maintenance.json');

const ASSET_PREFIXES = ['/images/', '/favicon.ico'];
const ALLOWED_EXACT = new Set(['/mantenimiento', '/api/health', '/api/health/db']);

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

function isMaintenanceActive() {
  const env = String(process.env.MAINTENANCE_MODE || '').trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes' || env === 'on') return true;
  if (env === '0' || env === 'false' || env === 'no' || env === 'off') return false;
  try {
    return fs.existsSync(FLAG_FILE);
  } catch (_) {
    return false;
  }
}

function readJsonConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function getMaintenanceConfig() {
  const fileCfg = readJsonConfig();
  const defaults = {
    title: 'Sistema en mantenimiento',
    message:
      'Estamos realizando una actualización del sistema. '
      + 'El acceso estará disponible nuevamente en breve. Gracias por su comprensión.',
    until: ''
  };
  return {
    title: process.env.MAINTENANCE_TITLE || fileCfg.title || defaults.title,
    message: process.env.MAINTENANCE_MESSAGE || fileCfg.message || defaults.message,
    until: process.env.MAINTENANCE_UNTIL || fileCfg.until || defaults.until
  };
}

function isAllowedDuringMaintenance(reqPath) {
  if (ALLOWED_EXACT.has(reqPath)) return true;
  return ASSET_PREFIXES.some((p) => reqPath.startsWith(p));
}

function setBypassCookie(res, key) {
  const secure = process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  const parts = [
    `innar_maint_bypass=${encodeURIComponent(key)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${2 * 60 * 60}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function hasMaintenanceBypass(req, res) {
  const key = String(process.env.MAINTENANCE_BYPASS_KEY || '').trim();
  if (!key) return false;
  const fromQuery = String(req.query.bypass || req.query.mantenimiento_bypass || '').trim();
  if (fromQuery && fromQuery === key) {
    setBypassCookie(res, key);
    return true;
  }
  return readCookie(req, 'innar_maint_bypass') === key;
}

function wantsHtmlResponse(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = String(req.path || '');
  if (p.startsWith('/api/')) return false;
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) return true;
  return !p.includes('.') || p.endsWith('.html') || p === '/';
}

function buildMaintenanceHtml(publicDir, cfg) {
  const templatePath = path.join(publicDir, 'mantenimiento.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  html = html
    .replace(/\{\{TITLE\}\}/g, escapeHtml(cfg.title))
    .replace(/\{\{MESSAGE\}\}/g, escapeHtml(cfg.message))
    .replace(/\{\{UNTIL\}\}/g, cfg.until ? escapeHtml(cfg.until) : '');
  return html;
}

function applyMaintenanceMode(app, { publicDir }) {
  let htmlCache = null;
  let htmlCacheKey = '';

  function renderMaintenanceHtml(cfg) {
    const key = `${cfg.title}|${cfg.message}|${cfg.until}`;
    if (htmlCache && htmlCacheKey === key) return htmlCache;
    htmlCache = buildMaintenanceHtml(publicDir, cfg);
    htmlCacheKey = key;
    return htmlCache;
  }

  app.get('/mantenimiento', (req, res) => {
    const cfg = getMaintenanceConfig();
    const active = isMaintenanceActive();
    if (!active && !req.query.preview) {
      return res.status(200).type('text/plain; charset=utf-8').send(
        'Modo mantenimiento inactivo.\nVista previa: /mantenimiento?preview=1\nActivar: MAINTENANCE_MODE=true o npm run maintenance:on'
      );
    }
    const previewCfg = !active
      ? {
        ...cfg,
        until: 'Vista previa — el sistema sigue activo para el resto de usuarios'
      }
      : cfg;
    res.status(active ? 503 : 200).type('html').send(renderMaintenanceHtml(previewCfg));
  });

  app.use((req, res, next) => {
    if (!isMaintenanceActive()) return next();
    if (hasMaintenanceBypass(req, res)) return next();
    if (isAllowedDuringMaintenance(req.path)) return next();

    const cfg = getMaintenanceConfig();
    res.setHeader('Retry-After', '3600');

    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        maintenance: true,
        title: cfg.title,
        error: cfg.message,
        until: cfg.until || null
      });
    }

    if (wantsHtmlResponse(req)) {
      return res.status(503).type('html').send(renderMaintenanceHtml(cfg));
    }

    return res.status(503).type('text/plain; charset=utf-8').send(cfg.message);
  });
}

module.exports = {
  applyMaintenanceMode,
  isMaintenanceActive,
  getMaintenanceConfig,
  FLAG_FILE,
  CONFIG_FILE
};
