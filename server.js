// server.js — punto de entrada Express + Socket.IO
// La lógica de configuración vive en `config/`, `socket/`, `middleware/`, `migrations/`.

require('dotenv').config();

const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
const MISSING_ENV = REQUIRED_ENV.filter(v => process.env[v] === undefined || process.env[v] === null);
if (MISSING_ENV.length > 0) {
  console.error(`[ERROR] Faltan variables de entorno requeridas: ${MISSING_ENV.join(', ')}`);
  console.error('[ERROR] Copie .env.example a .env y configure los valores correctos.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const compression = require('compression');

const db = require('./utils/db-mysql');
const logger = require('./utils/logger');
const { startBackupScheduler } = require('./utils/backup-scheduler');

const { applyCors } = require('./config/cors');
const { applySession } = require('./config/session');
const { applySecurity } = require('./config/security');
const { applyStaticFiles } = require('./config/static-files');
const { applyRateLimiters } = require('./config/rate-limit');
const { runRuntimeMigrations } = require('./migrations/runtime-migrations');
const { attachSockets } = require('./socket/handlers');
const { getSocketIoPath } = require('./config/socket-io-path');
const { requireAuth } = require('./middleware/index');

const PACKAGE_VERSION = require('./package.json').version;
// IMPORTANTE: la versión debe ser ESTABLE entre reinicios.
// Si incluye un timestamp por defecto, el cliente piensa que hay una "nueva versión"
// cada vez que el proceso Node se reinicia y muestra el banner azul falso.
// Para forzar refresco tras un deploy real, setear APP_BUILD_VERSION en el .env del deploy.
const APP_VERSION = process.env.APP_BUILD_VERSION
  || process.env.SOURCE_VERSION
  || PACKAGE_VERSION;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.locals.appVersion = APP_VERSION;

app.use(compression());
applyCors(app);
const { sessionMiddleware, sessionCookieSecure, sessionCookieSameSite } = applySession(app);
applySecurity(app, { sessionCookieSecure, sessionCookieSameSite });

applyStaticFiles(app, { publicDir: PUBLIC_DIR, appVersion: APP_VERSION });
applyRateLimiters(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const EXTENSIONES_ESTATICAS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|map)$/i;
app.use((req, res, next) => {
  if (EXTENSIONES_ESTATICAS.test(req.path)) return next();
  const startTime = Date.now();
  let logged = false;
  const logRequest = () => {
    if (logged) return;
    logged = true;
    const duration = Date.now() - startTime;
    logger.api(req.method, req.path, res.statusCode || 200, duration, {
      ip: req.ip,
      userAgent: req.get('user-agent')?.substring(0, 50)
    });
  };
  const originalEnd = res.end;
  res.end = function (data, encoding) {
    logRequest();
    return originalEnd.call(this, data, encoding);
  };
  next();
});

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=0; includeSubDomains');
    next();
  });
}

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, version: APP_VERSION, uptime: process.uptime() });
});
app.get('/api/socket-status', (req, res) => {
  const sioPath = getSocketIoPath();
  res.json({
    socketio: {
      loaded: !!require.cache[require.resolve('socket.io')],
      mounted: !!app.io,
      path: `${sioPath}/`,
      transports: ['polling'],
      cors_origin: process.env.FRONTEND_URL || 'http://localhost:3000'
    },
    timestamp: new Date().toISOString()
  });
});

// ─── WORKAROUND: Sirve el cliente Socket.IO explícitamente ────
// Si Apache no proxía /socket.io/ correctamente, servimos desde aquí
// Sirve el cliente Socket.IO (engine: {path}/socket.io.js).
app.get(`${getSocketIoPath()}/socket.io.js`, (req, res, next) => {
  const socketIoJs = path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.min.js');
  if (fs.existsSync(socketIoJs)) {
    logger.debug('[SOCKET.IO] Sirviendo cliente desde: ' + socketIoJs);
    res.type('application/javascript');
    res.sendFile(socketIoJs);
  } else {
    logger.warn('[SOCKET.IO] No encontrado: ' + socketIoJs);
    res.status(404).send('socket.io.js not found');
  }
});


// Healthcheck profundo: BD, disco de backups, logs. Requiere auth.
app.get('/api/health/deep', requireAuth, async (req, res) => {
  const start = Date.now();
  const checks = {
    db: { ok: false, latency_ms: null, error: null },
    backupsDir: { ok: false, path: null, files: 0, latestAgeHours: null, error: null },
    logsDir: { ok: false, sizeBytes: 0, error: null },
    process: {
      uptime_s: Math.round(process.uptime()),
      pid: process.pid,
      memRss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      nodeVersion: process.version
    }
  };

  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    checks.db.ok = true;
    checks.db.latency_ms = Date.now() - t0;
  } catch (e) {
    checks.db.error = e.message;
  }

  try {
    const backupsDir = path.join(__dirname, 'backups');
    if (fs.existsSync(backupsDir)) {
      const files = fs.readdirSync(backupsDir)
        .filter(f => /\.(sql|sql\.gz|zip)$/i.test(f))
        .map(f => ({ f, mtime: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }));
      checks.backupsDir.ok = files.length > 0;
      checks.backupsDir.path = backupsDir;
      checks.backupsDir.files = files.length;
      if (files.length > 0) {
        const latest = Math.max(...files.map(x => x.mtime));
        checks.backupsDir.latestAgeHours = Math.round((Date.now() - latest) / 3_600_000);
      }
    } else {
      checks.backupsDir.path = backupsDir;
    }
  } catch (e) {
    checks.backupsDir.error = e.message;
  }

  try {
    const logsDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logsDir)) {
      const total = fs.readdirSync(logsDir).reduce((acc, f) => {
        try { return acc + fs.statSync(path.join(logsDir, f)).size; } catch (_) { return acc; }
      }, 0);
      checks.logsDir.ok = true;
      checks.logsDir.sizeBytes = total;
    }
  } catch (e) {
    checks.logsDir.error = e.message;
  }

  const allOk = checks.db.ok && checks.backupsDir.ok && checks.logsDir.ok;
  res.status(allOk ? 200 : 503).json({
    ok: allOk,
    version: APP_VERSION,
    checked_in_ms: Date.now() - start,
    checks
  });
});

// Reporte de violaciones CSP — usado para verificar que el bundle no use inline/eval
// antes de activar `CSP_STRICT=true`. Logs en logs/app.log con prefijo [CSP].
app.post('/api/csp-report', express.json({ type: ['application/json', 'application/csp-report'] }), (req, res) => {
  const report = (req.body && (req.body['csp-report'] || req.body)) || {};
  logger.warn('[CSP] Violación reportada', {
    blockedUri: report['blocked-uri'],
    violatedDirective: report['violated-directive'],
    effectiveDirective: report['effective-directive'],
    documentUri: report['document-uri'],
    sourceFile: report['source-file'],
    lineNumber: report['line-number'],
    columnNumber: report['column-number']
  });
  res.status(204).end();
});

// Páginas wrapper para reportes (muestran favicon en la pestaña y el PDF en iframe)
app.get('/reportes/diario/vista', requireAuth, (req, res) => {
  const fecha = req.query.fecha || '';
  const pdfUrl = `/api/reportes/diario?fecha=${encodeURIComponent(fecha)}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Diario</title><link rel="icon" type="image/png" href="/icon.png"/>
</head><body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Diario"></iframe>
</body></html>`);
});

app.get('/reportes/mensual/vista', requireAuth, (req, res) => {
  const mes = req.query.mes || '';
  const pdfUrl = `/api/reportes/mensual?mes=${encodeURIComponent(mes)}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Mensual</title><link rel="icon" type="image/png" href="/icon.png"/>
</head><body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Mensual"></iframe>
</body></html>`);
});

// ─── Rutas ────────────────────────────────────────────────────────────────
// Uploads autenticados: reemplaza la exposición pública de public/uploads/
app.use('/', require('./routes/uploads'));
app.use('/api/v1/appointments', requireAuth, require('./routes/appointmentsV1'));
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

(async () => {
  try {
    await db.initPool();

    // Índices de rendimiento en background (no bloquea arranque)
    try {
      const { migrations } = require('./migrations/db-migrations');
      const perfMigration = migrations.find(m => m.name === 'performance_indexes');
      if (perfMigration) {
        const stmts = Array.isArray(perfMigration.sql) ? perfMigration.sql : [perfMigration.sql];
        Promise.all(stmts.map(s => db.execute(s).catch(() => {})))
          .then(() => logger.info('[STARTUP] Índices de rendimiento verificados', { type: 'STARTUP' }));
      }
    } catch (e) {
      logger.warn('[STARTUP] No se aplicaron índices de rendimiento: ' + e.message, { type: 'STARTUP' });
    }

    await runRuntimeMigrations(db, logger);

    const certPath = path.join(__dirname, 'server.crt');
    const keyPath = path.join(__dirname, 'server.key');
    const USE_HTTPS = false;

    let httpServer;
    if (USE_HTTPS && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      httpServer = https.createServer({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      }, app);
      logger.info('[HTTPS] Activado con certificado autofirmado', { type: 'HTTPS' });
    } else {
      httpServer = http.createServer(app);
    }

    try {
      logger.info('[STARTUP] Llamando attachSockets()...', { type: 'STARTUP' });
      attachSockets({ httpServer, app, sessionMiddleware, appVersion: APP_VERSION });
      logger.info('[STARTUP] ✓ attachSockets() completado exitosamente', { type: 'STARTUP' });
    } catch (e) {
      logger.error('[SOCKET.IO INIT ERROR] ' + e.message, { type: 'STARTUP', stack: e.stack });
      throw e;
    }

    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`Servidor corriendo en http://0.0.0.0:${PORT}`);
      logger.cleanOldLogs();
      startBackupScheduler();
    });

    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`\nPuerto ${PORT} ya está en uso.`);
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
      const logsDir = path.join(__dirname, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(path.join(logsDir, 'startup-error.log'),
        '[' + new Date().toISOString() + '] STARTUP ERROR: ' + error.message + '\n' + (error.stack || '') + '\n');
    } catch (_) {}
    process.exit(1);
  }
})();

// ─── Crash logs separados en logs/crashes.log ────────────────────────────────
function appendCrashLog(prefix, payload) {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'crashes.log'),
      '[' + new Date().toISOString() + '] ' + prefix + ': ' + payload + '\n');
  } catch (_) {}
}

process.on('uncaughtException', (error) => {
  logger.error('Error no controlado:', error.message);
  appendCrashLog('uncaughtException', (error && error.stack) ? error.stack : String(error));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rechazado:', reason);
  const detail = (reason && reason.stack) ? reason.stack : String(reason);
  appendCrashLog('unhandledRejection', detail);
});

module.exports = app;
