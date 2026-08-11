/**
 * Búsqueda unificada (Soportes / PDX / Armado / Anexo):
 * - minúsculas, sin acentos
 * - tokens en cualquier orden (AND)
 * - campos compuestos (nombre, doc, archivo, factura…)
 */

function normalizeSearchText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchQuery(q, { minTokenLen = 1 } = {}) {
  const norm = normalizeSearchText(q);
  if (!norm) return [];
  return norm.split(/\s+/).filter((t) => t.length >= minTokenLen);
}

/** Expresión SQL que aproxima NFD+lower para español (MySQL sin unaccent). */
function sqlFoldExpr(col) {
  const c = `COALESCE(${col}, '')`;
  return `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    ${c},
    'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ñ','n'),
    'Á','a'),'É','e'),'Í','i'),'Ó','o'),'Ú','u'),'Ñ','n'))`;
}

function sqlDigitsExpr(col) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '.', ''), '-', ''), ',', '')`;
}

/**
 * WHERE: cada token debe aparecer en al menos un campo (AND entre tokens).
 * @param {string[]} fieldExprs expresiones SQL ya listas (pueden usar sqlFoldExpr)
 * @param {string[]} tokens
 * @returns {{ sql: string, params: any[] }}
 */
function buildTokenAndWhere(fieldExprs, tokens) {
  const fields = (fieldExprs || []).filter(Boolean);
  const toks = (tokens || []).filter(Boolean);
  if (!fields.length || !toks.length) {
    return { sql: '0', params: [] };
  }
  const parts = [];
  const params = [];
  for (const tok of toks) {
    const like = `%${tok}%`;
    parts.push(`(${fields.map((f) => `${f} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < fields.length; i += 1) params.push(like);
  }
  return { sql: parts.join(' AND '), params };
}

/** Campos típicos de sop_pdx_archivos + carpeta. */
function pdxArchivoSearchFields() {
  return [
    'a.paciente_nombre_norm',
    sqlFoldExpr('a.paciente_nombre'),
    sqlFoldExpr('a.apellidos'),
    sqlFoldExpr('a.nombres'),
    sqlFoldExpr('a.estudio_texto'),
    sqlDigitsExpr('a.paciente_documento'),
    sqlFoldExpr('a.paciente_documento'),
    sqlFoldExpr('a.nombre_archivo_original'),
    sqlFoldExpr('a.nombre_archivo_display'),
    sqlFoldExpr('c.nombre_display'),
    sqlFoldExpr('c.periodo')
  ];
}

function armadoExpedienteSearchFields() {
  return [
    sqlFoldExpr('e.paciente_nombre'),
    sqlFoldExpr('e.codigo'),
    sqlDigitsExpr('e.paciente_documento'),
    sqlFoldExpr('e.paciente_documento'),
    sqlFoldExpr('CAST(e.numero_factura AS CHAR)'),
    "CONCAT('fe', CAST(e.numero_factura AS CHAR))",
    sqlFoldExpr('d.nombre_display'),
    sqlFoldExpr('p.etiqueta'),
    sqlFoldExpr('p.periodo')
  ];
}

function anexoPersonaSearchFields(alias = '') {
  const p = alias ? `${alias}.` : '';
  return [
    sqlDigitsExpr(`${p}numero_documento`),
    sqlFoldExpr(`${p}numero_documento`),
    sqlFoldExpr(`${p}nombres_1`),
    sqlFoldExpr(`${p}nombres_2`),
    sqlFoldExpr(`${p}apellidos_1`),
    sqlFoldExpr(`${p}apellidos_2`),
    sqlFoldExpr(`CONCAT_WS(' ', ${p}nombres_1, ${p}nombres_2, ${p}apellidos_1, ${p}apellidos_2)`)
  ];
}

function anexoRegistroSearchFields(alias = '') {
  const p = alias ? `${alias}.` : '';
  return [
    ...anexoPersonaSearchFields(alias),
    sqlFoldExpr(`${p}numero_orden_fomag`),
    sqlDigitsExpr(`${p}numero_orden_fomag`)
  ];
}

function buildPdxBusquedaWhere(q) {
  const tokens = tokenizeSearchQuery(q);
  return buildTokenAndWhere(pdxArchivoSearchFields(), tokens);
}

function buildArmadoBusquedaWhere(q) {
  const tokens = tokenizeSearchQuery(q);
  return buildTokenAndWhere(armadoExpedienteSearchFields(), tokens);
}

function buildAnexoPersonasWhere(q) {
  const tokens = tokenizeSearchQuery(q);
  return buildTokenAndWhere(anexoPersonaSearchFields(), tokens);
}

function buildAnexoRegistrosWhere(q) {
  const tokens = tokenizeSearchQuery(q);
  return buildTokenAndWhere(anexoRegistroSearchFields(), tokens);
}

/** Cliente / post-filtro: ¿el haystack (ya normalizado o crudo) contiene todos los tokens? */
function textMatchesQuery(haystack, q) {
  const tokens = tokenizeSearchQuery(q);
  if (!tokens.length) return true;
  const h = normalizeSearchText(haystack);
  return tokens.every((t) => h.includes(t));
}

function objectMatchesQuery(obj, keys, q) {
  const hay = (keys || []).map((k) => (obj && obj[k] != null ? String(obj[k]) : '')).join(' ');
  return textMatchesQuery(hay, q);
}

module.exports = {
  normalizeSearchText,
  tokenizeSearchQuery,
  sqlFoldExpr,
  sqlDigitsExpr,
  buildTokenAndWhere,
  pdxArchivoSearchFields,
  armadoExpedienteSearchFields,
  buildPdxBusquedaWhere,
  buildArmadoBusquedaWhere,
  buildAnexoPersonasWhere,
  buildAnexoRegistrosWhere,
  textMatchesQuery,
  objectMatchesQuery
};
