// server.js — punto de entrada Express (tiempo real vía GET /api/eventos/poll)
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
const { requireAuth } = require('./middleware/index');
const { runRecoveryBootstrap } = require('./scripts/auto-run-recuperacion-soportes');

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

if (process.env.SOPORTES_RECOVERY_ON_DEPLOY === '1' || process.env.SOPORTES_RECOVERY_ON_DEPLOY === 'true') {
  runRecoveryBootstrap().catch((error) => {
    console.error('[server] Falló el bootstrap de recuperación de SOPORTES:', error);
  });
}

app.use(compression({
  filter(req, res) {
    const p = String(req.path || '');
    if (p.includes('/zip') || p.includes('/descargar')) return false;
    if (String(res.getHeader('Content-Type') || '').includes('application/zip')) return false;
    return compression.filter(req, res);
  }
}));
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
/** Ping MySQL sin autenticación (diagnóstico cuando login/sesión devuelven 500). */
app.get('/api/health/db', async (req, res) => {
  try {
    const t0 = Date.now();
    await db.query('SELECT 1 AS ping');
    res.json({ ok: true, latency_ms: Date.now() - t0 });
  } catch (e) {
    res.status(503).json({
      ok: false,
      error: e.message,
      code: e.code || null
    });
  }
});
app.get('/api/socket-status', (req, res) => {
  res.json({
    realtime: {
      mode: 'http-poll',
      pollPath: '/api/eventos/poll',
      pushPath: '/api/eventos/push'
    },
    timestamp: new Date().toISOString()
  });
});


// Healthcheck profundo: BD, disco de backups, logs. Requiere auth.
app.get('/api/health/deep', requireAuth, async (req, res) => {
  const start = Date.now();
  const checks = {
    db: { ok: false, latency_ms: null, error: null },
    uploadsDir: { ok: false, path: null, writable: false, soportesPdxFiles: 0, error: null },
    backupsDir: { ok: false, path: null, files: 0, latestAgeHours: null, error: null },
    logsDir: { ok: false, sizeBytes: 0, error: null },
    process: {
      uptime_s: Math.round(process.uptime()),
      pid: process.pid,
      memRss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      nodeVersion: process.version
    },
    chromium: { ok: false, diagnostic: null, launch: null, error: null }
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
    const { getUploadsRoot } = require('./config/uploads-path');
    const uploadsDir = getUploadsRoot();
    const testFile = path.join(uploadsDir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    checks.uploadsDir.path = uploadsDir;
    checks.uploadsDir.writable = true;
    checks.uploadsDir.ok = true;
    const pdxRoot = path.join(uploadsDir, 'soportes', 'pdx');
    if (fs.existsSync(pdxRoot)) {
      let count = 0;
      const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.name.toLowerCase().endsWith('.pdf')) count += 1;
        }
      };
      walk(pdxRoot);
      checks.uploadsDir.soportesPdxFiles = count;
    }
  } catch (e) {
    checks.uploadsDir.error = e.message;
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

  try {
    const { getChromiumDiagnostic, probeChromiumLaunch } = require('./utils/puppeteer-utils');
    checks.chromium.diagnostic = getChromiumDiagnostic();
    const launch = await probeChromiumLaunch();
    checks.chromium.launch = launch;
    checks.chromium.ok = !!launch.ok;
    if (!launch.ok) checks.chromium.error = launch.error;
  } catch (e) {
    checks.chromium.error = e.message;
  }

  const criticalOk = checks.db.ok && checks.uploadsDir.ok && checks.logsDir.ok;
  res.status(criticalOk ? 200 : 503).json({
    ok: criticalOk,
    backups_ok: checks.backupsDir.ok,
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

// Visor PDF Soportes (pantalla completa, requiere sesión)
app.get('/soportes/visor-pdf', requireAuth, (req, res, next) => {
  const visorPath = path.join(__dirname, 'views', 'visor-pdf.html');
  if (!fs.existsSync(visorPath)) {
    logger.warn('[VISOR-PDF] Archivo no encontrado', { path: visorPath });
    return res.status(404).json({ error: 'Visor PDF no disponible' });
  }
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(visorPath, (err) => {
    if (err && !res.headersSent) {
      logger.error('[VISOR-PDF] Error al enviar archivo', { error: err.message });
      res.status(500).json({ error: 'No se pudo cargar el visor PDF' });
    }
  });
});

const INNAR_FAVICON = '/images/icon.png';

function escapeHtmlLite(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAllowedSoportesPdfVistaSrc(src) {
  const s = String(src || '').trim();
  if (!s.startsWith('/api/soportes/')) return false;
  if (s.includes('://') || s.startsWith('//')) return false;
  return true;
}

/** Vista PDF en pestaña con favicon Innar (ojo / ver en navegador). */
app.get('/soportes/pdf-vista', requireAuth, (req, res) => {
  const src = String(req.query.src || '').trim();
  if (!isAllowedSoportesPdfVistaSrc(src)) {
    return res.status(400).type('html').send('<!DOCTYPE html><html lang="es"><body><p>URL de PDF no válida.</p></body></html>');
  }
  const titulo = escapeHtmlLite(req.query.titulo || 'Documento PDF');
  const pdfUrl = escapeHtmlLite(src);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${titulo}</title>
  <link rel="icon" type="image/png" href="${INNAR_FAVICON}"/>
</head><body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="${titulo}"></iframe>
</body></html>`);
});

// Páginas wrapper para reportes (muestran favicon en la pestaña y el PDF en iframe)
app.get('/reportes/diario/vista', requireAuth, (req, res) => {
  const fecha = req.query.fecha || '';
  const pdfUrl = `/api/reportes/diario?fecha=${encodeURIComponent(fecha)}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Diario</title><link rel="icon" type="image/png" href="${INNAR_FAVICON}"/>
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
  <title>Reporte Mensual</title><link rel="icon" type="image/png" href="${INNAR_FAVICON}"/>
</head><body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Mensual"></iframe>
</body></html>`);
});

// ─── Rutas ────────────────────────────────────────────────────────────────
// Uploads autenticados: reemplaza la exposición pública de public/uploads/
app.use('/', require('./routes/uploads'));
app.use('/api/v1/appointments', requireAuth, require('./routes/appointmentsV1'));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/eventos'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/auditoria', require('./routes/auditoria'));
app.use('/api', require('./routes/agenda'));
app.use('/api', require('./routes/turnos'));
app.use('/api', require('./routes/pacientes'));
app.use('/api', require('./routes/electro'));
app.use('/api', require('./routes/recibos'));
app.use('/api', require('./routes/pdf'));
app.use('/api', require('./routes/certificados'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/integraciones-worldoffice'));
app.use('/api', require('./routes/soportes'));
app.use('/api', require('./routes/archivo-modulo'));
app.use('/api', require('./routes/anexo-fidu'));
app.use('/api', require('./routes/llamado'));
app.use('/api', require('./routes/backup'));

// Errores de sesión MySQL (cookie corrupta) u otros → no dejar la API sin respuesta JSON
app.use((err, req, res, _next) => {
  logger.error('[EXPRESS] Error no capturado', {
    path: req.path,
    method: req.method,
    message: err?.message,
    code: err?.code
  });
  const finish = () => {
    if (req.method === 'GET' && req.path === '/api/sesion') {
      return res.json({ autenticado: false });
    }
    if (req.path && String(req.path).startsWith('/api/')) {
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
    return res.status(500).send('Error');
  };
  // Solo destruir sesión si es un error de corrupción de sesión MySQL,
  // NO en todos los errores (evita que un fallo accidental destruya la sesión)
  const isCriticalSessionError = err?.code === 'ER_PARSE_ERROR' || 
                                  String(err?.message || '').includes('session');
  if (req.session && isCriticalSessionError) {
    return req.session.destroy(() => finish());
  }
  return finish();
});

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

    try {
      const { recargarCatalogoAnexoFidu } = require('./utils/anexo-fidu-servicios');
      await recargarCatalogoAnexoFidu(db);
      logger.info('[STARTUP] Catálogo CUPS Anexo FIDU cargado', { type: 'STARTUP' });
    } catch (e) {
      logger.warn('[STARTUP] Catálogo CUPS Anexo FIDU no precargado: ' + e.message, { type: 'STARTUP' });
    }

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

    attachSockets({ httpServer, app, sessionMiddleware, appVersion: APP_VERSION });

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
