/**
 * Normalización y catálogo oficial de entidades (EPS / aseguradoras).
 */

/** Catálogo oficial — únicas entidades que deben aparecer en selects nuevos */
const CATALOGO_ENTIDADES = [
  'PARTICULAR',
  'FOMAG',
  'UCQN',
  'PROINSALUD',
  'FIDUPREVISORA',
  'CAFESALUD',
  'NUEVA EPS',
  'SURA',
  'SANITAS',
  'COMPENSAR',
  'PROTEGEMOS',
  'MEDICINA PARA TODOS'
];

const ALIAS_ENTIDAD = {
  FIDUPREVISRA: 'FIDUPREVISORA',
  FIDUPREVISOR: 'FIDUPREVISORA',
  PARTICULAR: 'PARTICULAR',
  'MEDICA PARA TODOS': 'MEDICINA PARA TODOS',
  'CLINICA CARDIOQUIRU DE NARINO SEDE IDEMA': 'UCQN',
  'CLINICA CARDIOQUIRU DE NARINO SEDE PRAGA': 'UCQN',
  'CLINICA CARDIOQUIRURGICA DE NARINO SEDE IDEMA': 'UCQN',
  'CLINICA CARDIOQUIRURGICA DE NARINO SEDE PRAGA': 'UCQN',
  'CLICAL MEDIC': 'PARTICULAR',
  DOCTORALIA: 'PARTICULAR',
  'DR. ESTRADA': 'PARTICULAR',
  'DR. JHONNY': 'PARTICULAR',
  'EPS FAMILIAR': 'PARTICULAR',
  'GLOBAL SALUD': 'PARTICULAR',
  'MEDICA ESTAR BIEN': 'PARTICULAR',
  'MEDICA PREFERENCIAL': 'PARTICULAR',
  MULTISERVICIOS: 'PARTICULAR',
  OTRA: 'PARTICULAR',
  'PREVENIR DESCUENTOS': 'PARTICULAR',
  PREVIRED: 'PARTICULAR'
};

/** Nombres que no deben aparecer en listas desplegables */
const ENTIDADES_EXCLUIDAS = new Set(['ABOGADO', 'ABOGADO 2', 'OTRA']);

const MOJIBAKE_REPLACEMENTS = [
  [/Ã¡/g, 'á'], [/Ã©/g, 'é'], [/Ã­/g, 'í'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
  [/Ã±/g, 'ñ'], [/Ã/g, 'Á'], [/â€™/g, "'"], [/â€œ/g, '"'], [/â€/g, '"'],
  [/NARIÃ'O/gi, 'NARIÑO'], [/NARIÁ'O/gi, 'NARIÑO'], [/Á'O/g, 'ÑO'],
  [/Ã'O/gi, 'ÑO'], [/NARINO/gi, 'NARIÑO']
];

function repararCodificacionTexto(str) {
  let s = String(str || '');
  for (const [re, rep] of MOJIBAKE_REPLACEMENTS) {
    s = s.replace(re, rep);
  }
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

const CATALOGO_KEYS = new Set(CATALOGO_ENTIDADES.map((n) => claveEntidad(n)));

function normalizarNombreEntidad(raw) {
  let s = repararCodificacionTexto(raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const key = claveEntidad(s);
  if (ENTIDADES_EXCLUIDAS.has(key)) return 'PARTICULAR';
  if (ALIAS_ENTIDAD[key]) return ALIAS_ENTIDAD[key];
  if (key.startsWith('DR.') || key.startsWith('DR ')) return 'PARTICULAR';
  if (key.includes('CARDIOQUIRU') && key.includes('SEDE')) return 'UCQN';
  if (CATALOGO_KEYS.has(key)) {
    return CATALOGO_ENTIDADES.find((n) => claveEntidad(n) === key) || s.toUpperCase();
  }
  return s;
}

/**
 * Mapea un valor histórico al nombre canónico del catálogo (o PARTICULAR).
 */
function mapearEntidadHistorica(raw) {
  const canon = normalizarNombreEntidad(raw);
  if (!canon) return '';
  const key = claveEntidad(canon);
  if (CATALOGO_KEYS.has(key)) {
    return CATALOGO_ENTIDADES.find((n) => claveEntidad(n) === key) || canon.toUpperCase();
  }
  if (ALIAS_ENTIDAD[key]) return ALIAS_ENTIDAD[key];
  return canon.toUpperCase();
}

/** Typos que se unifican en un solo ítem del select (sin colapsar otras filas de BD). */
const ALIAS_SELECT_ENTIDAD = {
  FIDUPREVISRA: 'FIDUPREVISORA',
  FIDUPREVISOR: 'FIDUPREVISORA',
  PARTICULAR: 'PARTICULAR'
};

/**
 * Nombre tal como debe mostrarse en selects, respetando filas activas de la tabla entidades.
 */
function nombreEntidadParaSelect(raw) {
  const s = repararCodificacionTexto(raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const key = claveEntidad(s);
  if (ENTIDADES_EXCLUIDAS.has(key)) return '';
  if (ALIAS_SELECT_ENTIDAD[key]) return ALIAS_SELECT_ENTIDAD[key];
  return s;
}

function ordenarEntidades(lista) {
  return [...lista].sort((a, b) => {
    if (claveEntidad(a) === 'PARTICULAR') return -1;
    if (claveEntidad(b) === 'PARTICULAR') return 1;
    return a.localeCompare(b, 'es', { sensitivity: 'base' });
  });
}

/**
 * Lista para selects: todas las entidades activo=1 en BD (sin colapsar a PARTICULAR).
 */
function listarEntidadesActivasDesdeBd(nombresDb = []) {
  const map = new Map();
  (nombresDb || []).forEach((raw) => {
    const nombre = nombreEntidadParaSelect(raw);
    if (!nombre) return;
    const key = claveEntidad(nombre);
    if (!map.has(key)) map.set(key, nombre);
  });
  if (map.size === 0) {
    CATALOGO_ENTIDADES.forEach((n) => map.set(claveEntidad(n), n));
  }
  return ordenarEntidades([...map.values()]);
}

/** Limpieza histórica / migraciones (aplica alias agresivos). */
function listarEntidadesCatalogo(nombresDb = []) {
  const map = new Map();
  const push = (raw) => {
    const canon = normalizarNombreEntidad(raw);
    if (!canon) return;
    const key = claveEntidad(canon);
    if (ENTIDADES_EXCLUIDAS.has(key)) return;
    map.set(key, canon);
  };
  (nombresDb || []).forEach(push);
  if (map.size === 0) CATALOGO_ENTIDADES.forEach(push);
  return ordenarEntidades([...map.values()]);
}

function fusionarListaEntidades(catalogoNombres) {
  return listarEntidadesActivasDesdeBd(catalogoNombres);
}

module.exports = {
  CATALOGO_ENTIDADES,
  CATALOGO_KEYS,
  ALIAS_ENTIDAD,
  ENTIDADES_EXCLUIDAS,
  repararCodificacionTexto,
  normalizarNombreEntidad,
  nombreEntidadParaSelect,
  claveEntidad,
  mapearEntidadHistorica,
  listarEntidadesActivasDesdeBd,
  listarEntidadesCatalogo,
  fusionarListaEntidades
};
