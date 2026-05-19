// Middleware compartido: autenticación, roles, permisos y helpers
const socketEmitter = require('../utils/socket-emitter');
const logger = require('../utils/logger');

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

function requirePermiso(permiso) {
  return (req, res, next) => {
    const rol = req.session?.rol;
    if (rol === 'superadmin') return next();
    if (rol === 'admin' && (req.session?.permisos === null || req.session?.permisos === undefined)) return next();
    const perms = req.session?.permisos;
    if (perms === null || perms === undefined) return next();
    if (Array.isArray(perms) && perms.includes(permiso)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

function requireRoleOrPerm(roles, permiso) {
  const permisos = Array.isArray(permiso) ? permiso : [permiso];
  return (req, res, next) => {
    if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
    const rol = req.session.rol;
    const perms = req.session?.permisos;
    if (rol === 'superadmin') return next();
    if (rol === 'admin' && (perms === null || perms === undefined)) return next();
    if (roles.includes(rol)) {
      if (perms === null || perms === undefined) return next();
      if (Array.isArray(perms) && permisos.some(p => perms.includes(p))) return next();
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    if (Array.isArray(perms) && permisos.some(p => perms.includes(p))) return next();
    return res.status(403).json({ error: 'Acceso denegado' });
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
  requireAuth, requireAdmin, requireSuperAdmin, requireRole, requirePermiso, requireRoleOrPerm,
  safeError, parseReciboId, emitSocket
};
