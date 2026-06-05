/**
 * Visibilidad de carpetas PDX por usuario (permisos granulares en módulo Usuarios).
 */
const { PERMISOS_ROL_DEFAULTS } = require('../config/permisos-rol-defaults');

const PERMISO_CARPETAS_TODAS = 'soportes.pdx.carpetas.todas';
const PREFIJO_CARPETA = 'soportes.pdx.carpeta.';

function permisoKeyCarpetaPdx(carpetaId) {
  return `${PREFIJO_CARPETA}${parseInt(carpetaId, 10)}`;
}

function esPermisoCarpetaPdx(key) {
  return String(key || '').startsWith(PREFIJO_CARPETA);
}

function carpetaIdDesdePermiso(key) {
  const m = String(key || '').match(/^soportes\.pdx\.carpeta\.(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
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

function permisosPersonalizadosSesion(session) {
  return Array.isArray(session?.permisos);
}

function permisosEfectivosSesion(session) {
  const rol = String(session?.rol || '').trim().toLowerCase();
  if (rol === 'superadmin') return null;
  const personalizados = parsePermisosSesion(session?.permisos);
  if (Array.isArray(personalizados)) return personalizados;
  const defaults = PERMISOS_ROL_DEFAULTS[rol];
  if (defaults === null || defaults === undefined) return null;
  return Array.isArray(defaults) ? defaults : [];
}

function tieneAccesoModuloPdx(permisos) {
  if (!Array.isArray(permisos)) return true;
  return permisos.includes('modulo.reportes_pdx')
    || permisos.includes('soportes.pdx.ver')
    || permisos.includes('soportes.pdx.subir')
    || permisos.includes('soportes.pdx.editar')
    || permisos.includes('soportes.pdx.crear_carpeta');
}

function tienePermisoTodasCarpetas(permisos) {
  return Array.isArray(permisos) && permisos.includes(PERMISO_CARPETAS_TODAS);
}

function idsCarpetasPermitidas(permisos) {
  if (!Array.isArray(permisos)) return [];
  return permisos
    .filter(esPermisoCarpetaPdx)
    .map(carpetaIdDesdePermiso)
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * ¿El usuario puede ver esta carpeta PDX?
 * - superadmin / admin sin lista: todas
 * - soportes.pdx.carpetas.todas: todas
 * - soportes.pdx.carpeta.{id}: solo esas
 * - Rol con todas por defecto (recepción, electro…): todas
 * - Auxiliar u otros sin "todas": solo carpetas marcadas explícitamente
 */
function usuarioVeCarpetaPdx(session, carpetaRow) {
  if (!carpetaRow) return false;
  const rol = String(session?.rol || '').trim().toLowerCase();
  if (rol === 'superadmin') return true;

  const efectivos = permisosEfectivosSesion(session);
  if (efectivos === null) return true;
  if (!tieneAccesoModuloPdx(efectivos)) return false;

  if (tienePermisoTodasCarpetas(efectivos)) return true;

  const ids = idsCarpetasPermitidas(efectivos);
  if (ids.length > 0) {
    return ids.includes(Number(carpetaRow.id));
  }

  if (permisosPersonalizadosSesion(session)) return false;

  const defaults = PERMISOS_ROL_DEFAULTS[rol];
  if (defaults === null || defaults === undefined) return true;
  return Array.isArray(defaults) && defaults.includes(PERMISO_CARPETAS_TODAS);
}

function esPermisoPdxValido(key) {
  const k = String(key || '');
  if (k === PERMISO_CARPETAS_TODAS) return true;
  return /^soportes\.pdx\.carpeta\.\d+$/.test(k);
}

module.exports = {
  PERMISO_CARPETAS_TODAS,
  PREFIJO_CARPETA,
  permisoKeyCarpetaPdx,
  esPermisoCarpetaPdx,
  esPermisoPdxValido,
  carpetaIdDesdePermiso,
  permisosEfectivosSesion,
  usuarioVeCarpetaPdx,
  tienePermisoTodasCarpetas,
  idsCarpetasPermitidas
};
