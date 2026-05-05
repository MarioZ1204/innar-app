// server.js
require('dotenv').config();

// Validar variables de entorno requeridas antes de arrancar
const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
const MISSING_ENV = REQUIRED_ENV.filter(v => process.env[v] === undefined || process.env[v] === null);
if (MISSING_ENV.length > 0) {
  console.error(`[ERROR] Faltan variables de entorno requeridas: ${MISSING_ENV.join(', ')}`);
  console.error('[ERROR] Copie .env.example a .env y configure los valores correctos.');
  process.exit(1);
}

const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const db = require('./utils/db-mysql');
const rateLimiter = require('./modules/rate-limiter');
const validation = require('./modules/validation');
const auditLog = require('./modules/audit-log');
const transactions = require('./utils/transactions');
const logger = require('./utils/logger');
const procesarAgendaExcel = require('./utils/procesar-agenda-excel');
const cors = require('cors');
const compression = require('compression');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Versión de la aplicación (para cache busting + detección de despliegue)
// Si no hay variable de entorno de build, usar timestamp de arranque para detectar deploy/restart.
const PACKAGE_VERSION = require('./package.json').version;
const APP_VERSION = process.env.APP_BUILD_VERSION || process.env.SOURCE_VERSION || `${PACKAGE_VERSION}-${Math.floor(Date.now() / 1000)}`;
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const appointmentsRouter = require('./routes/appointmentsV1');
const { startBackupScheduler } = require('./utils/backup-scheduler');

const app = express();

// Compresión gzip para todas las respuestas
app.use(compression());

// CORS debe ir antes de cualquier sesión o body parser
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://innarapp.neurocienciasnarino.com';
const allowedOrigins = [FRONTEND_URL];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/
  );
}
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Configuración de sesión recomendada para Hostinger/proxy
app.set('trust proxy', 1);
// Cookies de sesión: en Hostinger el TLS termina en Apache; Node recibe HTTP internamente,
// pero `trust proxy` + `secure: true` funcionan cuando el proxy envía X-Forwarded-Proto: https.
// Mismo sitio (SPA + /api en el mismo dominio): SameSite=Lax es más seguro que None.
const SESSION_COOKIE_SECURE = (process.env.SESSION_COOKIE_SECURE !== undefined)
  ? (process.env.SESSION_COOKIE_SECURE === 'true')
  : (process.env.NODE_ENV === 'production');
const SESSION_COOKIE_SAMESITE = process.env.SESSION_COOKIE_SAMESITE
  || (process.env.NODE_ENV === 'production' ? 'lax' : 'lax');
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  rolling: true,
  cookie: {
    secure: SESSION_COOKIE_SECURE,
    httpOnly: true,
    sameSite: SESSION_COOKIE_SAMESITE,
    maxAge: 8 * 60 * 60 * 1000,
    // domain: '.neurocienciasnarino.com' // Descomenta si frontend y backend están en subdominios distintos
  }
});
app.use(sessionMiddleware);

// --- CSRF (doble envío: cookie legible + cabecera en mutaciones) ---
const CSRF_TOKEN_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: SESSION_COOKIE_SECURE,
  sameSite: SESSION_COOKIE_SAMESITE,
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
};

function ensureCsrfForSession(req, res) {
  if (!req.session) return;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.cookie(CSRF_TOKEN_COOKIE, req.session.csrfToken, CSRF_COOKIE_OPTS);
}

function csrfProtection(req, res, next) {
  const p = req.path || '';
  const method = (req.method || 'GET').toUpperCase();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  // Rutas que no deben exigir CSRF
  if (p === '/api/login') return next();
  if (p === '/api/logout') return next();
  if (p === '/api/sesion' && method === 'GET') return next();
  if (!p.startsWith('/api/')) return next();
  if (!mutating) return next();

  // Sin sesión autenticada no exigimos CSRF (evita bloquear logout/limpieza con sesión rota)
  if (!req.session?.usuarioId) return next();

  // Basta con que el header coincida con la sesión (el atacante cross-site no puede leerlo).
  // La cookie legible es opcional: algunos navegadores/proxy no exponen document.cookie igual que el servidor.
  const tokenSession = req.session?.csrfToken;
  const tokenHeader = req.get(CSRF_HEADER);
  if (!tokenSession || !tokenHeader || tokenHeader !== tokenSession) {
    return res.status(403).json({ error: 'Token CSRF inválido o faltante', code: 'CSRF_INVALID' });
  }
  return next();
}

// Emite/renueva cookie CSRF cuando hay sesión autenticada (GET /api/*)
function issueCsrfIfAuthed(req, res, next) {
  const p = req.path || '';
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' && p.startsWith('/api/') && req.session?.usuarioId) {
    ensureCsrfForSession(req, res);
  }
  return next();
}

app.use(issueCsrfIfAuthed);
app.use(csrfProtection);

// Servir archivos estáticos desde public (sin headers — la ruta GET / con versioning los sirve vía el segundo middleware)
app.use(express.static(path.join(__dirname, 'public')));

// Manejo explícito de favicon.ico
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Middleware para cerrar sesión por inactividad (60 minutos)
app.use((req, res, next) => {
  if (req.session) {
    const INACTIVITY_MS = 60 * 60 * 1000;
    const now = Date.now();
    if (req.session.lastActivity && (now - req.session.lastActivity) > INACTIVITY_MS) {
      return req.session.destroy(() => next());
    }
    req.session.lastActivity = now;
  }
  next();
});

// Headers de seguridad
// CSP se habilita inicialmente en modo "report-only" para no romper el frontend actual (que aún tiene inline).
const CSP_ENABLED = (process.env.CSP_ENABLED || 'true').toLowerCase() === 'true';
const CSP_REPORT_ONLY = (process.env.CSP_REPORT_ONLY || 'true').toLowerCase() === 'true';

app.use(helmet({
  hsts: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'sameorigin' },
  contentSecurityPolicy: CSP_ENABLED ? {
    reportOnly: CSP_REPORT_ONLY,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
      reportUri: ['/api/csp-report'],
    }
  } : false,
}));


const trustedIps = (process.env.RATE_LIMIT_TRUSTED_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

function isTrustedIp(ip) {
  if (!ip) return false;
  return trustedIps.includes(ip);
}

// Rate limiter global — limita por usuario/sesión y permite whitelist de IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en un minuto' },
  skip: (req) => {
    // No limitar healthcheck/version y permitir IPs de confianza (oficina/sede)
    if (req.path === '/health' || req.path === '/version') return true;
    return isTrustedIp(req.ip);
  },
  keyGenerator: (req, res) => {
    // Preferir usuario autenticado cuando exista
    if (req.session?.usuarioId) return `user:${req.session.usuarioId}`;
    if (req.user?.id) return `user:${req.user.id}`;
    // Fallback por sesión para no castigar a toda una red NAT
    if (req.sessionID) return `session:${req.sessionID}`;
    // Último fallback: IP (compatible IPv6 con express-rate-limit v8+)
    return ipKeyGenerator(req, res);
  }
});
app.use('/api/', apiLimiter);

// Límite estricto solo para login por IP (protección anti fuerza bruta)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' },
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  skip: (req) => isTrustedIp(req.ip)
});
app.use('/api/login', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// 50mb para rutas que generan PDFs con HTML grande
const jsonLargeBody = express.json({ limit: '50mb' });
const urlencodedLargeBody = express.urlencoded({ limit: '50mb', extended: true });

// Logging de requests  ignora assets estáticos
const EXTENSIONES_ESTATICAS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|map)$/i;
app.use((req, res, next) => {
  if (EXTENSIONES_ESTATICAS.test(req.path)) return next();

  const startTime = Date.now();
  let logged = false;
  
  const logRequest = () => {
    if (logged) return;
    logged = true;
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode || 200;
    logger.api(req.method, req.path, statusCode, duration, {
      ip: req.ip,
      userAgent: req.get('user-agent')?.substring(0, 50)
    });
  };

  const originalEnd = res.end;
  res.end = function(data, encoding) {
    logRequest();
    return originalEnd.call(this, data, encoding);
  };
  
  next();
});

// Configurar multer para uploads de archivos
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g,'_')}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv', '.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${ext}`));
    }
  }
});
// Rutas de la API v1 de Appointments Service
app.use('/api/v1/appointments', requireAuth, appointmentsRouter);

// Páginas wrapper para reportes (muestran favicon en la pestaña y el PDF en iframe)
app.get('/reportes/diario/vista', requireAuth, (req, res) => {
  const fecha = req.query.fecha || '';
  const pdfUrl = `/api/reportes/diario?fecha=${encodeURIComponent(fecha)}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Diario</title>
  <link rel="icon" type="image/png" href="/icon.png"/>
</head>
<body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Diario"></iframe>
</body>
</html>`;
  res.type('html').send(html);
});

app.get('/reportes/mensual/vista', requireAuth, (req, res) => {
  const mes = req.query.mes || '';
  const pdfUrl = `/api/reportes/mensual?mes=${encodeURIComponent(mes)}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Mensual</title>
  <link rel="icon" type="image/png" href="/icon.png"/>
</head>
<body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Mensual"></iframe>
</body>
</html>`;
  res.type('html').send(html);
});

// En desarrollo: limpiar cache HSTS del navegador para que no fuerce HTTPS
// En producción: Helmet ya envía HSTS con max-age=31536000 (ver config Helmet arriba)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=0; includeSubDomains');
    next();
  });
}

// Headers anti-cache solo para rutas /api (los assets estáticos sí pueden cachearse)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Servir index.html con inyección de versión para cache busting
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  // Inyectar versión como variable global y agregar ?v=VERSION a assets locales
  const vTag = `?v=${APP_VERSION}`;
  html = html
    .replace('href="style.css"', `href="style.css${vTag}"`)
    .replace('src="multiselect.js"', `src="multiselect.js${vTag}"`)
    .replace('src="socket-client.js"', `src="socket-client.js${vTag}"`)
    .replace('src="socket-electro.js"', `src="socket-electro.js${vTag}"`)
    .replace('src="dashboard-citas.js"', `src="dashboard-citas.js${vTag}"`)
    .replace('src="calendario-agenda.js"', `src="calendario-agenda.js${vTag}"`)
    .replace('src="app.js"', `src="app.js${vTag}"`)
    .replace('src="calendario-bloqueado.js"', `src="calendario-bloqueado.js${vTag}"`)
    .replace('src="validation-client.js"', `src="validation-client.js${vTag}"`)
    .replace('</head>', `<script>window.APP_VERSION="${APP_VERSION}";</script>\n</head>`);
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(html);
});

app.use(express.static('public', {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // HTML: no cachear nunca (siempre verificar con servidor)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // JS/CSS: 1 año (el servidor inyecta ?v=VERSION en la URL desde la ruta GET /)
    // Visitas repetidas servirán desde caché del navegador sin red
    else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Imágenes: 7 días (menos frecuente de cambiar, pero pueden actualizarse)
    else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
    // Fuentes: 1 año
    else if (/\.(woff2?|ttf|eot)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Endpoint de versión (público, sin auth)
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// Healthcheck para validar arranque en Hostinger/CDN
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    version: APP_VERSION,
    uptime: process.uptime()
  });
});

// Endpoint para recibir reportes de violación CSP (navegador envía JSON)
app.post('/api/csp-report', express.json({ type: ['application/json', 'application/csp-report'] }), (req, res) => {
  const report = req.body['csp-report'] || req.body;
  logger.warn('[CSP] Violación reportada', {
    blockedUri: report['blocked-uri'],
    violatedDirective: report['violated-directive'],
    documentUri: report['document-uri'],
    sourceFile: report['source-file'],
    lineNumber: report['line-number'],
  });
  res.status(204).end();
});

// Cargar imagen del logo como base64
let logoBase64 = '';

// Función para obtener la ruta del logo (compatible con pkg)
function getLogoPath() {
  const possiblePaths = [
    path.join(__dirname, 'public', 'images', 'logo.png'),  // ubicación real
    path.join(__dirname, 'public', 'logo.png'),
    path.join(__dirname, '../public/images/logo.png'),
    path.join(__dirname, '../public/logo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logo.png'),
    path.join(process.execPath, '..', 'public', 'logo.png'),
  ];
  for (let p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Cargar logo de forma lazy (al primer uso) para tolerar reinicios sin logo
function getLogoBase64() {
  if (logoBase64) return logoBase64;
  const logoPath = getLogoPath();
  if (logoPath) {
    try {
      logoBase64 = fs.readFileSync(logoPath).toString('base64');
    } catch(e) {
      logger.warn('Error cargando logo:', e.message);
    }
  }
  return logoBase64;
}

// Intento inicial (no crítico)
try { getLogoBase64(); } catch(_) {}

// Logo específico para recibos (logorecibo.png)
let logoReciboBase64 = null;
function getLogoReciboBase64() {
  if (logoReciboBase64) return logoReciboBase64;
  const possiblePaths = [
    path.join(__dirname, 'public', 'images', 'logorecibo.png'),
    path.join(__dirname, 'public', 'logorecibo.png'),
    path.join(__dirname, '../public/images/logorecibo.png'),
    path.join(__dirname, '../public/logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'logorecibo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try { logoReciboBase64 = fs.readFileSync(p).toString('base64'); } catch(_) {}
      break;
    }
  }
  return logoReciboBase64 || getLogoBase64(); // fallback al logo genérico
}

// Las tablas de MySQL se inicializan con npm run init-db
// No es necesario db.exec() aquí

// Opciones para Puppeteer (Chrome/Edge del sistema si existe)
function getPuppeteerLaunchOptions() {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'],
    dumpio: false
  };
  const chromePaths = [
    // Linux (Hostinger / servidor)
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Windows (desarrollo local)
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
  // puppeteer-core exige executablePath: lanzar error claro si no se encuentra Chrome
  if (!launchOptions.executablePath) {
    throw new Error(
      'No se encontró Chrome/Chromium instalado. En Hostinger ejecute: apt-get install -y chromium-browser. ' +
      'En Windows instale Google Chrome o Microsoft Edge.'
    );
  }
  return launchOptions;
}

// Mensajes de error seguros: en producción no exponer detalles internos al cliente
function safeError(e, prefix) {
  if (process.env.NODE_ENV === 'production') return 'Error interno del servidor';
  const msg = (e && e.message) ? e.message : String(e);
  return prefix ? prefix + msg : msg;
}

// Validar que id sea un entero positivo (para rutas :id)
function parseReciboId(id) {
  const n = parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Helper seguro para emitir eventos de Socket.IO
function emitSocket(eventName, data) {
  try {
    if (app.io) {
      app.io.emit(eventName, data);
    }
  } catch (error) {
    logger.warn(`Socket.IO emit error: ${eventName}`, { error: error.message });
  }
}

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.usuarioId) {
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

// Helper: comprueba si el rol es superadmin (o admin legacy)
function isAdminRol(rol) {
  return rol === 'superadmin' || rol === 'admin';
}
// Helper: roles que gestionan Recepción
function isRecepcionRol(rol) {
  return rol === 'admin_recepcion' || rol === 'recepcion' || isAdminRol(rol);
}
// Helper: roles que gestionan Electrodiagnóstico
function isElectroRol(rol) {
  return rol === 'admin_electro' || rol === 'electro' || rol === 'tecnico_electro' || isAdminRol(rol);
}
// Helper: puede ver auditoría de citas
function canViewAuditoriaCitas(rol) {
  return isAdminRol(rol) || rol === 'admin_recepcion' || rol === 'recepcion' || rol === 'admin_electro' || rol === 'electro';
}

// Middleware: solo rol superadmin (y legacy admin)
function requireAdmin(req, res, next) {
  if (req.session && isAdminRol(req.session.rol)) {
    return next();
  }
  return res.status(403).json({ error: 'Solo super administradores pueden realizar esta acción' });
}

// Middleware: rol permitido (array de roles)
function requireRole(roles) {
  return (req, res, next) => {
    if (req.session && req.session.usuarioId && roles.includes(req.session.rol)) {
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

// Middleware: permiso granular (verifica permisos personalizados del superadmin)
// Si el usuario tiene permisos personalizados (array), exige que incluya el permiso.
// Si permisos es null (rol sin restricciones), deja pasar.
// superadmin y admin siempre pasan.
function requirePermiso(permiso) {
  return (req, res, next) => {
    const rol = req.session?.rol;
    if (rol === 'superadmin' || rol === 'admin') return next();
    const perms = req.session?.permisos;
    if (perms === null || perms === undefined) return next(); // sin restricciones personalizadas
    if (Array.isArray(perms) && perms.includes(permiso)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

// Middleware: rol base O permiso explícito.
// Permite que el superadmin otorgue permisos a roles que no los tienen por defecto.
// Si el rol está en la lista: igual que requireRole + requirePermiso combinados.
// Si el rol NO está en la lista: pasa si tiene el permiso concedido explícitamente.
function requireRoleOrPerm(roles, permiso) {
  const permisos = Array.isArray(permiso) ? permiso : [permiso];
  return (req, res, next) => {
    if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
    const rol = req.session.rol;
    const perms = req.session?.permisos; // null = sin restricciones; array = permisos personalizados
    if (rol === 'superadmin' || rol === 'admin') return next();
    if (roles.includes(rol)) {
      // Rol permitido por defecto: verificar que no esté restringido
      if (perms === null || perms === undefined) return next();
      if (Array.isArray(perms) && permisos.some(p => perms.includes(p))) return next();
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    // Rol fuera de la lista base: solo pasa si tiene el permiso explícito
    if (Array.isArray(perms) && permisos.some(p => perms.includes(p))) return next();
    return res.status(403).json({ error: 'Acceso denegado' });
  };
}

// Almacenar ensureCsrfForSession en app.locals para que los routers puedan accederlo
app.locals.ensureCsrfForSession = ensureCsrfForSession;

// ─── Montar Rutas ────────────────────────────────────────────────────────────
app.use('/api', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/auditoria', require('./routes/auditoria'));
app.use('/api', require('./routes/agenda'));
app.use('/api', require('./routes/turnos'));
app.use('/api', require('./routes/pacientes'));
app.use('/api', require('./routes/electro'));
app.use('/api', require('./routes/recibos'));
app.use('/api', require('./routes/pdf'));
app.use('/api', require('./routes/admin'));

const PORT = process.env.PORT || 3000;

// Inicializar pool MySQL y luego iniciar servidor
(async () => {
  try {
    await db.initPool();

    // Aplicar índices de rendimiento en background (no bloquea el arranque)
    const { migrations } = require('./migrations/db-migrations');
    const perfMigration = migrations.find(m => m.name === 'performance_indexes');
    if (perfMigration) {
      const stmts = Array.isArray(perfMigration.sql) ? perfMigration.sql : [perfMigration.sql];
      Promise.all(stmts.map(s => db.execute(s).catch(() => {})))
        .then(() => logger.info('[STARTUP] Índices de rendimiento verificados', { type: 'STARTUP' }));
    }

    // ─── Inicializar tabla de servicios ──────────────────────────────────────
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS servicios_recibo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(300) NOT NULL UNIQUE,
        activo TINYINT DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const svcRows = await db.query('SELECT COUNT(*) AS n FROM servicios_recibo');
      if (svcRows[0].n === 0) {
        const defaults = [
          'Electroencefalograma Computarizado',
          'Electroencefalograma Convencional',
          'Monitorización Electroencefalográfica por video y radio',
          'Polisomnografía',
          'Polisomnograma en Titulación de CPAP/BPAP',
          'Test de Latencia Múltiple',
          'Polisomnograma Noche Dividida'
        ];
        for (const nombre of defaults) {
          await db.execute('INSERT IGNORE INTO servicios_recibo (nombre) VALUES (?)', [nombre]);
        }
        logger.info('[STARTUP] Tabla servicios_recibo creada y poblada con valores por defecto', { type: 'STARTUP' });
      } else {
        logger.info('[STARTUP] Tabla servicios_recibo lista', { type: 'STARTUP' });
      }
    } catch (svcErr) {
      logger.warn('[STARTUP] Error inicializando servicios_recibo: ' + svcErr.message, { type: 'STARTUP' });
    }

    // ── Tabla entidades ──────────────────────────────────────────────────────
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS entidades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL UNIQUE,
        activo TINYINT DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const entRows = await db.query('SELECT COUNT(*) AS n FROM entidades');
      if (entRows[0].n === 0) {
        const defaults = ['PARTICULAR', 'FOMAG', 'UCQN', 'PROINSALUD', 'FIDUPREVISORA', 'CAFESALUD', 'NUEVA EPS', 'SURA', 'SANITAS', 'COMPENSAR'];
        for (const nombre of defaults) {
          await db.execute('INSERT IGNORE INTO entidades (nombre) VALUES (?)', [nombre]);
        }
        logger.info('[STARTUP] Tabla entidades creada con valores por defecto', { type: 'STARTUP' });
      }
    } catch (entErr) {
      logger.warn('[STARTUP] Error inicializando entidades: ' + entErr.message, { type: 'STARTUP' });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // --- Migración: corregir collation de doctor_disponibilidad_mensual ---
    try {
      await db.execute(
        'ALTER TABLE doctor_disponibilidad_mensual CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
      );
      logger.info('[MIGRATION] Collation de doctor_disponibilidad_mensual corregida a utf8mb4_general_ci', { type: 'STARTUP' });
    } catch (migErr) {
      if (!migErr.message.includes("doesn't exist")) {
        logger.warn('[MIGRATION] Advertencia collation doctor_disponibilidad_mensual: ' + migErr.message, { type: 'STARTUP' });
      }
    }

    // --- Migración: agregar columna motivo_ausencia a doctor_disponibilidad_mensual ---
    try {
      const colMotivoRows = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'doctor_disponibilidad_mensual'
           AND COLUMN_NAME  = 'motivo_ausencia'`
      );
      if (!colMotivoRows || !colMotivoRows[0] || colMotivoRows[0].cnt === 0) {
        await db.execute(
          `ALTER TABLE doctor_disponibilidad_mensual ADD COLUMN motivo_ausencia VARCHAR(200) DEFAULT NULL`
        );
        logger.info('[MIGRATION] Columna motivo_ausencia agregada a doctor_disponibilidad_mensual', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia motivo_ausencia: ' + migErr.message, { type: 'STARTUP' });
    }

    // ─── Auto-migraciones al inicio ──────────────────────────────────────────
    // Agregar columna deleted_at a citas_electro si no existe (soft-delete)
    // Compatible con MySQL 5.x y 8.x
    try {
      const colRows = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'citas_electro'
           AND COLUMN_NAME  = 'deleted_at'`
      );
      if (!colRows || !colRows[0] || colRows[0].cnt === 0) {
        await db.execute(
          `ALTER TABLE citas_electro ADD COLUMN deleted_at DATETIME DEFAULT NULL`
        );
        logger.info('[MIGRATION] Columna citas_electro.deleted_at agregada', { type: 'STARTUP' });
      } else {
        logger.info('[MIGRATION] citas_electro.deleted_at ya existe, sin cambios', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración deleted_at: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: columna entidad en citas_electro ─────────────────────────
    try {
      const colEntidad = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'citas_electro'
           AND COLUMN_NAME  = 'entidad'`
      );
      if (!colEntidad || !colEntidad[0] || colEntidad[0].cnt === 0) {
        await db.execute(`ALTER TABLE citas_electro ADD COLUMN entidad VARCHAR(200) DEFAULT NULL AFTER diagnostico_id`);
        await db.execute(`ALTER TABLE citas_electro ADD INDEX idx_entidad (entidad)`);
        logger.info('[MIGRATION] Columna citas_electro.entidad agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración entidad citas_electro: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: tabla ucqn_estudios ──────────────────────────────────────
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ucqn_estudios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          cita_electro_id INT NOT NULL,
          fecha_estudio DATE NOT NULL,
          hora_estudio TIME NULL,
          paciente_nombres VARCHAR(150) NOT NULL,
          paciente_apellidos VARCHAR(150) DEFAULT NULL,
          paciente_documento VARCHAR(50) DEFAULT NULL,
          tipo_estudio VARCHAR(255) DEFAULT NULL,
          entidad VARCHAR(100) NOT NULL DEFAULT 'UCQN',
          estado ENUM('PENDIENTE','LEIDO','FACTURADO') NOT NULL DEFAULT 'PENDIENTE',
          estado_actualizado_en DATETIME DEFAULT NULL,
          estado_actualizado_por VARCHAR(150) DEFAULT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_ucqn_cita (cita_electro_id),
          INDEX idx_ucqn_fecha (fecha_estudio),
          INDEX idx_ucqn_estado (estado),
          CONSTRAINT fk_ucqn_cita_electro FOREIGN KEY (cita_electro_id) REFERENCES citas_electro(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      logger.info('[MIGRATION] Tabla ucqn_estudios verificada', { type: 'STARTUP' });
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración tabla ucqn_estudios: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: equipos 5 y 6 bloqueados (inactivos) ─────────────────────
    try {
      await db.execute(
        `INSERT IGNORE INTO equipos_electro (nombre, activo) VALUES ('Equipo 5', 0), ('Equipo 6', 0)`
      );
      logger.info('[MIGRATION] Equipos 5 y 6 verificados (bloqueados/inactivos)', { type: 'STARTUP' });
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración equipos 5 y 6: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: paciente_telefono2 en turnos ──────────────────────────────
    try {
      const colTel2Turnos = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'turnos'
           AND COLUMN_NAME  = 'paciente_telefono2'`
      );
      if (!colTel2Turnos || !colTel2Turnos[0] || colTel2Turnos[0].cnt === 0) {
        await db.execute(`ALTER TABLE turnos ADD COLUMN paciente_telefono2 VARCHAR(20) DEFAULT NULL AFTER paciente_telefono`);
        logger.info('[MIGRATION] Columna turnos.paciente_telefono2 agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración turnos.paciente_telefono2: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: telefono2 en pacientes ───────────────────────────────────
    try {
      const colTel2Pac = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'pacientes'
           AND COLUMN_NAME  = 'telefono2'`
      );
      if (!colTel2Pac || !colTel2Pac[0] || colTel2Pac[0].cnt === 0) {
        await db.execute(`ALTER TABLE pacientes ADD COLUMN telefono2 VARCHAR(20) DEFAULT NULL AFTER telefono`);
        logger.info('[MIGRATION] Columna pacientes.telefono2 agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración pacientes.telefono2: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: permisos en usuarios ──────────────────────────────────────
    try {
      const colPermisos = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'permisos'`
      );
      if (!colPermisos || !colPermisos[0] || colPermisos[0].cnt === 0) {
        await db.execute(`ALTER TABLE usuarios ADD COLUMN permisos JSON DEFAULT NULL`);
        logger.info('[MIGRATION] Columna usuarios.permisos agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración usuarios.permisos: ' + migErr.message, { type: 'STARTUP' });
    }

    // ─── Migración: ultimo_acceso en usuarios ────────────────────────────────
    try {
      const colUltAcc = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'ultimo_acceso'`
      );
      if (!colUltAcc || !colUltAcc[0] || colUltAcc[0].cnt === 0) {
        await db.execute(`ALTER TABLE usuarios ADD COLUMN ultimo_acceso DATETIME DEFAULT NULL`);
        logger.info('[MIGRATION] Columna usuarios.ultimo_acceso agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración usuarios.ultimo_acceso: ' + migErr.message, { type: 'STARTUP' });
    }

    // --- Migracion: convertir usuario 'admin' legacy a 'superadmin' ----------
    try {
      const existingSuperadmin = await db.query("SELECT COUNT(*) AS cnt FROM usuarios WHERE rol = 'superadmin'");
      if (existingSuperadmin?.[0]?.cnt === 0) {
        const legacyAdmin = await db.queryOne("SELECT id FROM usuarios WHERE usuario = 'admin' AND rol = 'admin'");
        if (legacyAdmin) {
          await db.execute("UPDATE usuarios SET rol = 'superadmin', nombre = 'Super Administrador' WHERE id = ?", [legacyAdmin.id]);
          logger.info('[MIGRATION] Usuario admin convertido a superadmin', { type: 'STARTUP' });
        }
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migracion admin->superadmin: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: ENUM rol en usuarios (agregar nuevos roles) ─────────────
    try {
      const enumRow = await db.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'rol'`
      );
      const currentEnum = enumRow?.[0]?.COLUMN_TYPE || '';
      if (!currentEnum.includes('superadmin') || !currentEnum.includes('admin_recepcion') || !currentEnum.includes('auxiliar_recepcion')) {
        await db.execute(
          `ALTER TABLE usuarios MODIFY COLUMN rol ENUM('doctor','recepcion','admin','electro','contabilidad','superadmin','admin_recepcion','admin_electro','tecnico_electro','auxiliar_recepcion') NOT NULL DEFAULT 'auxiliar_recepcion'`
        );
        logger.info('[MIGRATION] ENUM rol de usuarios actualizado con nuevos roles', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración ENUM rol: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: tabla pacientes_espera ───────────────────────────────────
    try {
      const tblEspera = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'pacientes_espera'`
      );
      if (!tblEspera || !tblEspera[0] || tblEspera[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE pacientes_espera (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            documento    VARCHAR(20)  NOT NULL,
            nombres      VARCHAR(100) NOT NULL,
            apellidos    VARCHAR(100) NOT NULL,
            entidad      VARCHAR(50)  NOT NULL,
            prioridad    ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
            ingresado_por VARCHAR(100) DEFAULT NULL,
            creado_en    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla pacientes_espera creada', { type: 'STARTUP' });
      } else {
        // Migración: agregar columnas nuevas si no existen
        const colsEspera = await db.query(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes_espera'`
        );
        const colNamesEspera = colsEspera.map(c => c.COLUMN_NAME);
        if (!colNamesEspera.includes('telefono1')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN telefono1 VARCHAR(20) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna telefono1 agregada a pacientes_espera', { type: 'STARTUP' });
        }
        if (!colNamesEspera.includes('telefono2')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN telefono2 VARCHAR(20) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna telefono2 agregada a pacientes_espera', { type: 'STARTUP' });
        }
        if (!colNamesEspera.includes('tipo_estudio')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN tipo_estudio VARCHAR(100) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna tipo_estudio agregada a pacientes_espera', { type: 'STARTUP' });
        }
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla pacientes_espera: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: tabla especialidades ─────────────────────────────────────
    try {
      const tblEsp = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'especialidades'`
      );
      if (!tblEsp || !tblEsp[0] || tblEsp[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE especialidades (
            id        INT AUTO_INCREMENT PRIMARY KEY,
            nombre    VARCHAR(100) NOT NULL,
            activo    TINYINT(1) NOT NULL DEFAULT 1,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_esp_nombre (nombre)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla especialidades creada', { type: 'STARTUP' });
        const seedEsp = ['Neurología', 'Epileptología', 'Psicología', 'Neuropsicología', 'Psiquiatría'];
        for (const nombre of seedEsp) {
          await db.execute('INSERT IGNORE INTO especialidades (nombre) VALUES (?)', [nombre]);
        }
        logger.info('[MIGRATION] Especialidades sembradas', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla especialidades: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: tabla tipos_consulta ─────────────────────────────────────
    try {
      const tblTc = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipos_consulta'`
      );
      if (!tblTc || !tblTc[0] || tblTc[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE tipos_consulta (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            especialidad_id INT NOT NULL,
            nombre          VARCHAR(200) NOT NULL,
            orden           INT NOT NULL DEFAULT 0,
            activo          TINYINT(1) NOT NULL DEFAULT 1,
            FOREIGN KEY (especialidad_id) REFERENCES especialidades(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla tipos_consulta creada', { type: 'STARTUP' });
        const tiposPorEsp = {
          'Neurología':     ['Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Agente Anestésico','Particular','Otra'],
          'Epileptología':  ['Consulta de Primera Vez por Epileptología','Consulta de Control por Epileptología','Consulta Virtual de Primera Vez por Epileptología','Consulta Virtual de Control por Epileptología','Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Bloqueo Mioneural','Particular','Otra'],
          'Psicología':     ['Consulta de Primera Vez por Psicología','Consulta de Control por Psicología','Otra'],
          'Neuropsicología':['Consulta de Primera Vez por Neuropsicología','Consulta de Control por Neuropsicología','Otra'],
          'Psiquiatría':    ['Consulta de Primera Vez por Psiquiatría','Consulta de Control por Psiquiatría','Otra'],
        };
        for (const [espNombre, tipos] of Object.entries(tiposPorEsp)) {
          const espRows = await db.query('SELECT id FROM especialidades WHERE nombre = ?', [espNombre]);
          if (espRows && espRows.length > 0) {
            const espId = espRows[0].id;
            for (let i = 0; i < tipos.length; i++) {
              await db.execute(
                'INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)',
                [espId, tipos[i], i]
              );
            }
          }
        }
        logger.info('[MIGRATION] Tipos de consulta sembrados', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla tipos_consulta: ' + migErr.message, { type: 'STARTUP' });
    }

    // --- Migration: recibos anulación columns ---
    try {
      await db.query(`
        ALTER TABLE recibos
        ADD COLUMN IF NOT EXISTS anulado TINYINT(1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS anulado_razon TEXT NULL,
        ADD COLUMN IF NOT EXISTS anulado_por_id INT NULL,
        ADD COLUMN IF NOT EXISTS anulado_por_nombre VARCHAR(200) NULL,
        ADD COLUMN IF NOT EXISTS anulado_en DATETIME NULL
      `);
      logger.info('[MIGRATION] Columnas de anulación en recibos verificadas', { type: 'STARTUP' });
    } catch (migErr) {
      logger.warn('[MIGRATION] Error en migración anulación recibos: ' + migErr.message, { type: 'STARTUP' });
    }

    // --- Migration: recibos estado de pago columns ---
    try {
      await db.query(`
        ALTER TABLE recibos
        ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'PAGADO',
        ADD COLUMN IF NOT EXISTS fecha_pago DATETIME NULL,
        ADD COLUMN IF NOT EXISTS pagado_por_id INT NULL,
        ADD COLUMN IF NOT EXISTS pagado_por_nombre VARCHAR(200) NULL
      `);
      logger.info('[MIGRATION] Columnas de estado de pago en recibos verificadas', { type: 'STARTUP' });
    } catch (migErr) {
      logger.warn('[MIGRATION] Error en migración estado de pago recibos: ' + migErr.message, { type: 'STARTUP' });
    }

    // Detectar certificado autofirmado y usar HTTPS si está configurado
    // NOTA: Deshabilitado para acceso por IP local. Solo funciona en localhost
    const USE_HTTPS = false; // Deshabilitado para desarrollo en red local
    const certPath = path.join(__dirname, 'server.crt');
    const keyPath = path.join(__dirname, 'server.key');
    let httpServer;

    if (USE_HTTPS && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      // Usar HTTPS con certificado autofirmado
      console.log('ðŸ” Iniciando servidor con HTTPS...');
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };

      httpServer = https.createServer(options, app);

      // Crear servidor HTTP que redirige a HTTPS
      const httpApp = express();
      httpApp.use((req, res) => {
        res.redirect(`https://localhost:${PORT}${req.url}`);
      });
      
      const redirectServer = http.createServer(httpApp);
      const httpPort = 3001;
      
      redirectServer.listen(httpPort, '0.0.0.0', () => {
        logger.info('HTTP → HTTPS redirect server listening on port 3001', { type: 'HTTPS' });
      });

      logger.info('[HTTPS] Activado con certificado autofirmado', { type: 'HTTPS' });
    } else if (USE_HTTPS && !fs.existsSync(certPath)) {
      // Usuario quiere HTTPS pero no tiene certificado
      logger.warn('⚠️ USE_HTTPS=true pero no hay certificados. Generando...', { type: 'HTTPS' });
      console.log('\nðŸ” Para generar certificado, ejecuta:');
      console.log('   node utils/generate-cert.js\n');
      
      // Continuar con HTTP por ahora
      httpServer = http.createServer(app);
      logger.warn('Iniciando temporalmente con HTTP (sin certificado)', { type: 'HTTPS' });
    } else {
      // Desarrollo local sin HTTPS (HTTP)
      httpServer = http.createServer(app);
    }

    const io = socketIo(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      pingInterval: 30000,
      pingTimeout: 60000,
      maxHttpBufferSize: 1e6,
      serveClient: true,
      perMessageDeflate: {
        threshold: 32 * 1024
      }
    });

    // Almacenar instancia de io en app para usar en rutas
    app.io = io;

    // Inicializar socket emitter singleton (usado por rutas via emitSocket())
    const socketEmitter = require('./utils/socket-emitter');
    socketEmitter.init(io);

    // Autenticación de Socket.IO: verificar sesión antes de aceptar conexión
    io.use((socket, next) => {
      sessionMiddleware(socket.request, {}, () => {
        if (socket.request.session && socket.request.session.usuarioId) {
          next();
        } else {
          next(new Error('No autenticado'));
        }
      });
    });

    // Manejar conexiones de WebSocket
    io.on('connection', (socket) => {
      // Enviar versión al conectar para que el cliente detecte actualizaciones
      socket.emit('sistema:version', { version: APP_VERSION });

      // Evento: Nuevo recibo creado
      socket.on('recibo:crear', (data) => {
        io.emit('recibo:actualizar-lista');
        io.emit('stats:actualizar');
      });

      // Evento: Recibo eliminado
      socket.on('recibo:eliminar', (data) => {
        io.emit('recibo:actualizar-lista');
        io.emit('stats:actualizar');
      });

      // Evento: Nueva cita en agenda médica
      socket.on('cita:crear', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
      });

      // Evento: Cita cancelada/actualizada
      socket.on('cita:actualizar', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
      });

      // Evento: Cita atendida
      socket.on('cita:atender', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
        io.emit('voz:anunciar-siguiente', data);
      });

      // Evento: Doctor anuncia paciente (voz solo para recepción)
      socket.on('agenda:anunciar-paciente', (data) => {
        socket.broadcast.emit('agenda:anunciar-paciente', data);
      });

      // Evento: Nuevo turno en electrodiagnóstico
      socket.on('electro:crear-turno', (data) => {
        io.emit('electro:actualizar-equipo', data.equipo);
        io.emit('electro:actualizar-lista');
      });

      // Evento: Turno completado
      socket.on('electro:completar-turno', (data) => {
        io.emit('electro:actualizar-equipo', data.equipo);
        io.emit('electro:actualizar-lista');
      });

      // Evento: Cita creada en electrodiagnóstico
      socket.on('electro:cita-creada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:nueva-cita', data);
      });

      // Evento: Cita actualizada en electrodiagnóstico
      socket.on('electro:cita-actualizada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:cita-cambio-estado', data);
      });

      // Evento: Cita eliminada en electrodiagnóstico
      socket.on('electro:cita-eliminada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:cita-removida', data);
      });

      // Evento: Estudio iniciado en electrodiagnóstico
      socket.on('electro:estudio-iniciado', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // Evento: Estudio finalizado en electrodiagnóstico
      socket.on('electro:estudio-finalizado', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // Evento: Cambios guardados en electrodiagnóstico
      socket.on('electro:cambios-guardados', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // ========== Eventos para Turnos Médicos (Agenda Médica) ==========
      
      // Evento: Estado de turno médico actualizado
      socket.on('turno-medico:estado-actualizado', (data) => {
        logger.debug('[SOCKET] turno-medico:estado-actualizado');
        io.emit('turno-medico:estado-actualizado', data);
      });

      // Evento: Turno médico reprogramado
      socket.on('turno-medico:reprogramado', (data) => {
        logger.debug('[SOCKET] turno-medico:reprogramado');
        io.emit('turno-medico:reprogramado', data);
      });

      // Evento: Nuevo turno médico creado
      socket.on('turno-medico:creado', (data) => {
        logger.debug('[SOCKET] turno-medico:creado');
        io.emit('turno-medico:creado', data);
      });

      socket.on('disconnect', () => {
        // Usuario desconectado
      });
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`Servidor corriendo en http://0.0.0.0:${PORT}`);
      logger.cleanOldLogs(); // Rotar logs al iniciar
      startBackupScheduler();
      
      // Backups automáticos desactivados (ejecutar manualmente: node utils/backup.js)
    });

    // Manejo de errores
    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`\nâŒ Puerto ${PORT} ya está en uso.\n`);
        console.log(`Intenta con otro puerto:`);
        console.log(`set PORT=3001 && node server.js\n`);
        process.exit(1);
      } else {
        throw error;
      }
    });
  } catch (error) {
    logger.error('STARTUP ERROR:', error.message);
    logger.error(error.stack);
    try {
      const _fs = require('fs'), _path = require('path');
      const _d = _path.join(__dirname, 'logs');
      if (!_fs.existsSync(_d)) _fs.mkdirSync(_d, { recursive: true });
      _fs.appendFileSync(_path.join(_d, 'startup-error.log'),
        '[' + new Date().toISOString() + '] STARTUP ERROR: ' + error.message + '\n' + error.stack + '\n');
    } catch (_) {}
    process.exit(1);
  }
})();

// Manejo de excepciones no capturadas
process.on('uncaughtException', (error) => {
  logger.error('\nâŒ Error no controlado:', error.message);
  logger.error('El servidor seguirá funcionando, pero verifica los errores anteriores.\n');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('\nâŒ Promise rechazado:', reason);
});

