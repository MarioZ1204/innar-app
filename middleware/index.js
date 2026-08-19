// Middleware compartido: autenticación, roles, permisos y helpers
const socketEmitter = require('../utils/socket-emitter');
const logger = require('../utils/logger');
const { sesionIncluyePermiso } = require('../config/permisos-legacy');
const { PERMISOS_ROL_DEFAULTS } = require('../config/permisos-rol-defaults');

// ── Helpers de rol ──────────────────────────────────────────────────────────
function isAdminRol(rol) {
  return rol === 'superadmin' || rol === 'admin';
}
function isRecepcionRol(rol) {
  return rol === 'admin_recepcion' || rol === 'recepcion' || isAdminRol(rol);
}
function isElectroRol(rol) {
  return rol === 'admin_electro' || rol === 'electro' || rol === 'tecnico_electro' || isAdminRol(rol);
}
function canViewAuditoriaCitas(rol) {
  return isAdminRol(rol) || rol === 'admin_recepcion' || rol === 'recepcion' || rol === 'admin_electro' || rol === 'electro';
}

// ── Middleware de autenticación ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.usuarioId) return next();
  const wantsJson = (req.path || '').startsWith('/api/')
    || req.get('X-Requested-With') === 'XMLHttpRequest'
    || (req.get('Accept') || '').includes('application/json');
  if (!wantsJson) {
    const target = encodeURIComponent(req.originalUrl || req.url || req.path || '/');
    return res.redirect(302, `/?login=1&redirect=${target}`);
  }
  return res.status(401).json({ error: 'No autenticado' });
}

function requireAdmin(req, res, next) {
  if (req.session && isAdminRol(req.session.rol)) return next();
  return res.status(403).json({ error: 'Solo super administradores pueden realizar esta acción' });
}

/** Solo superadmin (el rol admin no hereda estas rutas). */
function requireSuperAdmin(req, res, next) {
  if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.rol === 'superadmin') return next();
  return res.status(403).json({ error: 'Solo el Super Administrador puede realizar esta acción' });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (req.session && req.session.usuarioId && roles.includes(req.session.rol)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

function parsePermisosSesion(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Misma lógica que window.tienePermiso en public/app.js:
 * superadmin siempre; opt-in solo con lista explícita; admin sin lista = todo
 * (salvo opt-in); si permisos es null, se usan PERMISOS_ROL_DEFAULTS del rol.
 */
function sesionTienePermiso(session, permiso) {
  if (!session?.usuarioId || !permiso) return false;
  const rol = session.rol;
  if (rol === 'superadmin') return true;
  const { esPermisoOptIn } = require('../config/permisos-opt-in');
  const perms = parsePermisosSesion(session.permisos);
  if (esPermisoOptIn(permiso)) {
    return Array.isArray(perms) && (perms.includes(permiso) || sesionIncluyePermiso(perms, permiso));
  }
  if (rol === 'admin' && !Array.isArray(perms)) return true;
  if (Array.isArray(perms)) return sesionIncluyePermiso(perms, permiso);
  const defaults = PERMISOS_ROL_DEFAULTS[rol];
  if (defaults === null || defaults === undefined) return true;
  return Array.isArray(defaults) && sesionIncluyePermiso(defaults, permiso);
}

function sesionTieneAlgunPermiso(session, permisos) {
  const keys = Array.isArray(permisos) ? permisos.filter(Boolean) : [permisos];
  return keys.some((p) => sesionTienePermiso(session, p));
}

function requirePermiso(permiso) {
  return (req, res, next) => {
    if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
    if (sesionTienePermiso(req.session, permiso)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

function requireRoleOrPerm(roles, permiso) {
  const rolesList = Array.isArray(roles) ? roles : [];
  const permisos = permiso === undefined || permiso === null
    ? []
    : (Array.isArray(permiso) ? permiso.filter(Boolean) : [permiso]);
  return (req, res, next) => {
    if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
    const rol = req.session.rol;
    if (rol === 'superadmin') return next();
    if (!permisos.length) {
      if (rolesList.includes(rol)) return next();
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    if (sesionTieneAlgunPermiso(req.session, permisos)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

// ── Helpers de respuesta ────────────────────────────────────────────────────
// Genera un mensaje seguro para devolver al cliente. NUNCA expone stack ni
// estructura interna; solo el mensaje en entornos no-producción para depurar.
function safeError(e, prefix) {
  if (process.env.NODE_ENV === 'production') return 'Error interno del servidor';
  const rawMsg = (e && typeof e.message === 'string') ? e.message : (typeof e === 'string' ? e : 'Error');
  // Cortar a 200 chars para evitar volcado de queries enteras o stacks pegados
  const msg = rawMsg.split('\n')[0].slice(0, 200);
  return prefix ? prefix + msg : msg;
}

function parseReciboId(id) {
  const n = parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Socket.IO helper ────────────────────────────────────────────────────────
function emitSocket(eventName, data) {
  socketEmitter.emit(eventName, data);
}

module.exports = {
  isAdminRol, isRecepcionRol, isElectroRol, canViewAuditoriaCitas,
  parsePermisosSesion, sesionTienePermiso, sesionTieneAlgunPermiso,
  requireAuth, requireAdmin, requireSuperAdmin, requireRole, requirePermiso, requireRoleOrPerm,
  safeError, parseReciboId, emitSocket
};
