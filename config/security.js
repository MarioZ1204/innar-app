// config/security.js
// Helmet + CSP + CSRF (doble envío con cookie legible + cabecera)

const crypto = require('crypto');
const helmet = require('helmet');

const CSRF_TOKEN_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

function applyHelmet(app) {
  const cspEnabled = (process.env.CSP_ENABLED || 'true').toLowerCase() === 'true';
  const cspReportOnly = (process.env.CSP_REPORT_ONLY || 'true').toLowerCase() === 'true';
  // CSP_STRICT=true elimina 'unsafe-inline' y 'unsafe-eval' de scriptSrc.
  // Solo activar cuando NO queden handlers inline ni eval/new Function en el bundle (ver docs/FRONTEND-REFACTOR.md).
  const cspStrict = (process.env.CSP_STRICT || 'false').toLowerCase() === 'true';

  const scriptSrc = cspStrict
    ? ["'self'"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  const styleSrc = cspStrict
    ? ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'] // mantener inline en CSS hasta migrar style=""
    : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'];

  app.use(helmet({
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'sameorigin' },
    contentSecurityPolicy: cspEnabled ? {
      reportOnly: cspReportOnly,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        styleSrc,
        scriptSrc,
        connectSrc: ["'self'", 'ws:', 'wss:'],
        ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
        reportUri: ['/api/csp-report']
      }
    } : false
  }));
}

function buildCsrfCookieOpts(secure, sameSite) {
  return {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  };
}

function makeEnsureCsrfForSession(cookieOpts) {
  return function ensureCsrfForSession(req, res) {
    if (!req.session) return;
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.cookie(CSRF_TOKEN_COOKIE, req.session.csrfToken, cookieOpts);
  };
}

function csrfProtection(req, res, next) {
  const p = req.path || '';
  const method = (req.method || 'GET').toUpperCase();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (p === '/api/login') return next();
  if (p === '/api/logout') return next();
  if (p === '/api/sesion' && method === 'GET') return next();
  if (!p.startsWith('/api/')) return next();
  if (!mutating) return next();
  if (!req.session?.usuarioId) return next();

  const tokenSession = req.session?.csrfToken;
  const tokenHeader = req.get(CSRF_HEADER);
  if (!tokenSession || !tokenHeader || tokenHeader !== tokenSession) {
    return res.status(403).json({ error: 'Token CSRF inválido o faltante', code: 'CSRF_INVALID' });
  }
  return next();
}

function makeIssueCsrfIfAuthed(ensureCsrfForSession) {
  return function issueCsrfIfAuthed(req, res, next) {
    const p = req.path || '';
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' && p.startsWith('/api/') && req.session?.usuarioId) {
      ensureCsrfForSession(req, res);
    }
    return next();
  };
}

/**
 * Aplica seguridad: helmet + CSP + CSRF a la app.
 * Debe llamarse DESPUÉS de `session()` y ANTES de las rutas.
 * @returns { ensureCsrfForSession } para reutilizar en login/sesion handlers.
 */
function applySecurity(app, { sessionCookieSecure, sessionCookieSameSite }) {
  applyHelmet(app);
  const cookieOpts = buildCsrfCookieOpts(sessionCookieSecure, sessionCookieSameSite);
  const ensureCsrfForSession = makeEnsureCsrfForSession(cookieOpts);
  app.use(makeIssueCsrfIfAuthed(ensureCsrfForSession));
  app.use(csrfProtection);
  app.locals.ensureCsrfForSession = ensureCsrfForSession;
  return { ensureCsrfForSession };
}

module.exports = {
  applySecurity,
  applyHelmet,
  csrfProtection,
  CSRF_TOKEN_COOKIE,
  CSRF_HEADER
};
