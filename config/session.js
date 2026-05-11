// config/session.js
// express-session + cookies seguras + cierre por inactividad + store persistente en MySQL

const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');

const INACTIVITY_MS = 60 * 60 * 1000; // 60 minutos

function buildSessionStore() {
  // Si SESSION_STORE=memory (o no hay DB configurada), usa MemoryStore.
  // Cualquier otro valor (o sin valor en producción) → MySQLStore.
  // El store persistente sobrevive reinicios del proceso Node y evita
  // el toast falso de "Sesión expirada" tras un restart del servidor.
  const wantsMemory = (process.env.SESSION_STORE || '').toLowerCase() === 'memory';
  if (wantsMemory || !process.env.DB_HOST) return undefined;

  try {
    const MySQLStore = MySQLStoreFactory(session);
    const store = new MySQLStore({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
      createDatabaseTable: true,
      schema: {
        tableName: 'app_sessions',
        columnNames: {
          session_id: 'session_id',
          expires: 'expires',
          data: 'data'
        }
      },
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000, // limpia expiradas cada 15 min
      expiration: 8 * 60 * 60 * 1000           // mismo maxAge que la cookie
    });
    store.on('error', (err) => {
      try { require('../utils/logger').error('[SESSION-STORE] ' + (err && err.message)); } catch (_) {}
    });
    return store;
  } catch (e) {
    try { require('../utils/logger').warn('[SESSION-STORE] fallback a MemoryStore: ' + e.message); } catch (_) {}
    return undefined;
  }
}

function buildSessionConfig() {
  const sessionCookieSecure = (process.env.SESSION_COOKIE_SECURE !== undefined)
    ? (process.env.SESSION_COOKIE_SECURE === 'true')
    : (process.env.NODE_ENV === 'production');
  const sessionCookieSameSite = process.env.SESSION_COOKIE_SAMESITE || 'lax';

  const store = buildSessionStore();

  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    rolling: true,
    ...(store ? { store } : {}),
    cookie: {
      secure: sessionCookieSecure,
      httpOnly: true,
      sameSite: sessionCookieSameSite,
      maxAge: 8 * 60 * 60 * 1000
    }
  });

  return { sessionMiddleware, sessionCookieSecure, sessionCookieSameSite };
}

function inactivityGuard(req, res, next) {
  if (req.session) {
    const now = Date.now();
    if (req.session.lastActivity && (now - req.session.lastActivity) > INACTIVITY_MS) {
      return req.session.destroy(() => next());
    }
    req.session.lastActivity = now;
  }
  next();
}

/**
 * Configura sesión + inactividad. Debe ir antes que `applySecurity`.
 * @returns { sessionCookieSecure, sessionCookieSameSite }
 */
function applySession(app) {
  const { sessionMiddleware, sessionCookieSecure, sessionCookieSameSite } = buildSessionConfig();
  app.set('trust proxy', 1);
  app.use(sessionMiddleware);
  app.use(inactivityGuard);
  return { sessionCookieSecure, sessionCookieSameSite, sessionMiddleware };
}

module.exports = { applySession, inactivityGuard, INACTIVITY_MS };
