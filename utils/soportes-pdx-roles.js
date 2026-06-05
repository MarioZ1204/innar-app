/** Roles con acceso al módulo Cargar reportes / PDX (debe coincidir con ROLES_SOPORTES en routes/soportes.js). */
const ROLES_PDX_CARPETA = [
  { id: 'superadmin', label: 'Superadmin' },
  { id: 'admin', label: 'Administrador' },
  { id: 'admin_recepcion', label: 'Admin recepción' },
  { id: 'recepcion', label: 'Recepción' },
  { id: 'auxiliar_recepcion', label: 'Auxiliar recepción' },
  { id: 'contabilidad', label: 'Contabilidad' },
  { id: 'admin_electro', label: 'Admin electro' },
  { id: 'electro', label: 'Electrodiagnóstico' },
  { id: 'tecnico_electro', label: 'Técnico electro' }
];

const ROLE_IDS = new Set(ROLES_PDX_CARPETA.map((r) => r.id));

function parseRolesVisibles(raw) {
  if (raw == null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((r) => String(r || '').trim().toLowerCase()).filter((r) => ROLE_IDS.has(r)))];
}

/** null / [] = visible para todos los roles del módulo. */
function carpetaVisibleParaRol(rolesVisibles, rol) {
  const lista = Array.isArray(rolesVisibles) ? rolesVisibles : parseRolesVisibles(rolesVisibles);
  if (!lista.length) return true;
  const r = String(rol || '').trim().toLowerCase();
  return lista.includes(r);
}

function normalizarRolesVisiblesBody(body) {
  if (body == null || body === '') return null;
  if (!Array.isArray(body)) return { error: 'roles_visibles debe ser un arreglo de roles' };
  const lista = parseRolesVisibles(body);
  if (!lista.length) return null;
  return lista;
}

function serializarRolesVisibles(lista) {
  if (lista == null) return null;
  const parsed = parseRolesVisibles(lista);
  if (!parsed.length) return null;
  return JSON.stringify(parsed);
}

function labelRolesVisibles(rolesVisibles) {
  const lista = parseRolesVisibles(rolesVisibles);
  if (!lista.length) return 'Todos los roles';
  const byId = Object.fromEntries(ROLES_PDX_CARPETA.map((r) => [r.id, r.label]));
  return lista.map((id) => byId[id] || id).join(', ');
}

module.exports = {
  ROLES_PDX_CARPETA,
  ROLE_IDS,
  parseRolesVisibles,
  carpetaVisibleParaRol,
  normalizarRolesVisiblesBody,
  serializarRolesVisibles,
  labelRolesVisibles
};
