/**
 * Reglas de acceso y pairing del chat Messenger.
 * - Recepción con chat.usar ↔ doctores
 * - Recepción con chat.usar ↔ otra recepción con chat.usar
 * - Doctores no se escriben entre sí
 */
const { PERMISOS_ROL_DEFAULTS } = require('../config/permisos-rol-defaults');
const { sesionIncluyePermiso } = require('../config/permisos-legacy');

const ROLES_RECEPCION = new Set(['admin_recepcion', 'recepcion', 'auxiliar_recepcion']);
const ROLES_ADMIN = new Set(['superadmin', 'admin']);

function parsePermisosCampo(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function esRolRecepcion(rol) {
  return ROLES_RECEPCION.has(String(rol || '').toLowerCase());
}

function esRolDoctor(rol) {
  return String(rol || '').toLowerCase() === 'doctor';
}

function esRolAdmin(rol) {
  return ROLES_ADMIN.has(String(rol || '').toLowerCase());
}

/**
 * Misma lógica que tienePermiso('chat.usar') en el frontend:
 * admin/superadmin siempre; si hay array personalizado, debe incluir chat.usar;
 * si permisos es null, se usan defaults del rol.
 */
function usuarioTieneChatUsar({ rol, permisos }) {
  const r = String(rol || '').toLowerCase();
  if (r === 'superadmin' || r === 'admin') return true;
  const perms = parsePermisosCampo(permisos);
  if (Array.isArray(perms)) {
    return perms.includes('chat.usar') || sesionIncluyePermiso(perms, 'chat.usar');
  }
  const defaults = PERMISOS_ROL_DEFAULTS[r];
  if (defaults === null || defaults === undefined) return true;
  return Array.isArray(defaults) && defaults.includes('chat.usar');
}

function pairOrdenado(id1, id2) {
  const a = Math.min(Number(id1), Number(id2));
  const b = Math.max(Number(id1), Number(id2));
  return { usuario_a_id: a, usuario_b_id: b };
}

/**
 * ¿Puede el emisor abrir DM con el destinatario?
 * @param {{ id, rol, permisos }} emisor
 * @param {{ id, rol, permisos, activo? }} destino
 */
function puedeHablarCon(emisor, destino) {
  if (!emisor || !destino) return false;
  if (Number(emisor.id) === Number(destino.id)) return false;
  if (destino.activo === 0 || destino.activo === false) return false;
  if (!usuarioTieneChatUsar(emisor)) return false;

  const er = String(emisor.rol || '').toLowerCase();
  const dr = String(destino.rol || '').toLowerCase();

  // Admin puede hablar con cualquiera que tenga chat (o sea doctor / recepción con permiso)
  if (esRolAdmin(er)) {
    if (esRolDoctor(dr)) return true;
    if (esRolRecepcion(dr) || esRolAdmin(dr)) return usuarioTieneChatUsar(destino) || esRolAdmin(dr);
    return false;
  }

  // Doctor → solo recepción (o admin) con chat
  if (esRolDoctor(er)) {
    if (esRolDoctor(dr)) return false;
    if (esRolAdmin(dr)) return true;
    if (esRolRecepcion(dr)) return usuarioTieneChatUsar(destino);
    return false;
  }

  // Recepción con chat → doctores o otra recepción/admin con chat
  if (esRolRecepcion(er)) {
    if (esRolDoctor(dr)) return true;
    if (esRolAdmin(dr)) return true;
    if (esRolRecepcion(dr)) return usuarioTieneChatUsar(destino);
    return false;
  }

  return false;
}

function requireChatUsar(req, res, next) {
  if (!req.session?.usuarioId) return res.status(401).json({ error: 'No autenticado' });
  const ok = usuarioTieneChatUsar({
    rol: req.session.rol,
    permisos: req.session.permisos
  });
  if (!ok) return res.status(403).json({ error: 'No tienes permiso para usar el chat' });
  return next();
}

module.exports = {
  ROLES_RECEPCION,
  parsePermisosCampo,
  esRolRecepcion,
  esRolDoctor,
  esRolAdmin,
  usuarioTieneChatUsar,
  pairOrdenado,
  puedeHablarCon,
  requireChatUsar
};
