/**
 * Permisos legados reemplazados por claves canónicas.
 * Mantener alineado con PERMISOS_LEGACY_REEMPLAZOS en public/app.js.
 */
const PERMISOS_LEGACY_REEMPLAZOS = {
  'modulo.archivo_soportes': ['modulo.reportes_historico'],
  'soportes.ver_archivo': ['modulo.reportes_historico'],
};

const PERMISOS_LEGACY_SET = new Set(Object.keys(PERMISOS_LEGACY_REEMPLAZOS));

/** Claves legadas aún aceptadas al validar PUT /permisos (se normalizan al guardar). */
const PERMISOS_LEGACY_VALIDOS = [...PERMISOS_LEGACY_SET];

function sesionIncluyePermiso(permisos, permKey) {
  if (!Array.isArray(permisos) || !permKey) return false;
  if (permisos.includes(permKey)) return true;
  for (const [legacy, canonList] of Object.entries(PERMISOS_LEGACY_REEMPLAZOS)) {
    if (permisos.includes(legacy) && canonList.includes(permKey)) return true;
  }
  return false;
}

function sesionIncluyeAlgunPermiso(permisos, permKeys) {
  const list = Array.isArray(permKeys) ? permKeys : [permKeys];
  return list.some((p) => sesionIncluyePermiso(permisos, p));
}

/**
 * Convierte permisos legados a canónicos y elimina duplicados.
 * @returns {{ list: string[], changed: boolean }}
 */
function normalizePermisosLista(permisos) {
  if (!Array.isArray(permisos)) return { list: permisos, changed: false };
  const out = new Set();
  let changed = false;
  for (const p of permisos) {
    const reemplazos = PERMISOS_LEGACY_REEMPLAZOS[p];
    if (reemplazos) {
      changed = true;
      reemplazos.forEach((c) => out.add(c));
    } else {
      out.add(p);
    }
  }
  const list = [...out];
  if (!changed && list.length !== permisos.length) changed = true;
  return { list, changed };
}

module.exports = {
  PERMISOS_LEGACY_REEMPLAZOS,
  PERMISOS_LEGACY_SET,
  PERMISOS_LEGACY_VALIDOS,
  sesionIncluyePermiso,
  sesionIncluyeAlgunPermiso,
  normalizePermisosLista,
};
