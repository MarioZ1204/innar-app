/**
 * Normalización y fusión de nombres de entidad (catálogo + histórico).
 */

const ALIAS_ENTIDAD = {
  FIDUPREVISRA: 'FIDUPREVISORA',
  FIDUPREVISOR: 'FIDUPREVISORA',
  PARTICULAR: 'PARTICULAR'
};

/** Nombres que no deben aparecer en listas desplegables */
const ENTIDADES_EXCLUIDAS = new Set(['ABOGADO', 'ABOGADO 2']);

const MOJIBAKE_REPLACEMENTS = [
  [/Ã¡/g, 'á'], [/Ã©/g, 'é'], [/Ã­/g, 'í'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
  [/Ã±/g, 'ñ'], [/Ã/g, 'Á'], [/â€™/g, "'"], [/â€œ/g, '"'], [/â€/g, '"']
];

function repararCodificacionTexto(str) {
  let s = String(str || '');
  for (const [re, rep] of MOJIBAKE_REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  return s;
}

function normalizarNombreEntidad(raw) {
  let s = repararCodificacionTexto(raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const key = claveEntidad(s);
  if (ALIAS_ENTIDAD[key]) return ALIAS_ENTIDAD[key];
  return s;
}

function claveEntidad(raw) {
  return repararCodificacionTexto(raw)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Fusiona catálogo oficial + valores usados en turnos/recibos sin duplicados.
 * Prioriza el nombre del catálogo cuando la clave coincide.
 */
function fusionarListaEntidades(catalogoNombres, extrasNombres = []) {
  const map = new Map();

  const push = (raw, preferirCanonico = false) => {
    const canon = normalizarNombreEntidad(raw);
    if (!canon) return;
    const key = claveEntidad(canon);
    if (ENTIDADES_EXCLUIDAS.has(key)) return;
    if (!map.has(key)) {
      map.set(key, canon);
      return;
    }
    if (preferirCanonico) map.set(key, canon);
  };

  (catalogoNombres || []).forEach((n) => push(n, true));
  (extrasNombres || []).forEach((n) => push(n, false));

  return [...map.values()].sort((a, b) => {
    if (a.toUpperCase() === 'PARTICULAR') return -1;
    if (b.toUpperCase() === 'PARTICULAR') return 1;
    return a.localeCompare(b, 'es', { sensitivity: 'base' });
  });
}

module.exports = {
  ALIAS_ENTIDAD,
  ENTIDADES_EXCLUIDAS,
  repararCodificacionTexto,
  normalizarNombreEntidad,
  claveEntidad,
  fusionarListaEntidades
};
