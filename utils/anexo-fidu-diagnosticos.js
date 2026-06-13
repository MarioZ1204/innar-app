'use strict';

function normCie10(codigoRaw) {
  const raw = String(codigoRaw || '').trim();
  if (!raw) return { raw: '', norm: '', flat: '' };
  const norm = raw.toUpperCase();
  const flat = norm.replace(/\./g, '');
  return { raw, norm, flat };
}

function rowToDiagnostico(row) {
  if (!row) return { codigo: '', nombre: '' };
  return {
    codigo: String(row.codigo || '').trim(),
    nombre: String(row.nombre || row.descripcion || '').trim()
  };
}

/** Coincidencia exacta (con o sin puntos en el código). */
async function lookupDiagnosticoExactoDb(db, codigoRaw) {
  const { norm, flat } = normCie10(codigoRaw);
  if (flat.length < 2) return { codigo: '', nombre: '' };
  const rows = await db.query(
    `SELECT nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1
     AND (UPPER(TRIM(codigo)) = ? OR UPPER(REPLACE(TRIM(codigo), '.', '')) = ?)
     LIMIT 1`,
    [norm, flat]
  );
  return rowToDiagnostico(rows[0]);
}

/**
 * Busca diagnóstico por código CIE-10.
 * @param {object} opts.soloExacto — si true, no usa prefijo LIKE (evita falsos positivos al guardar).
 */
async function lookupDiagnosticoDb(db, codigoRaw, opts = {}) {
  const exacto = await lookupDiagnosticoExactoDb(db, codigoRaw);
  if (exacto.nombre || opts.soloExacto) return exacto;

  const { flat } = normCie10(codigoRaw);
  if (flat.length < 2) return { codigo: '', nombre: '' };

  const rows = await db.query(
    `SELECT nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1
     AND UPPER(REPLACE(TRIM(codigo), '.', '')) LIKE ?
     ORDER BY LENGTH(codigo) ASC LIMIT 1`,
    [`${flat}%`]
  );
  return rowToDiagnostico(rows[0]);
}

module.exports = {
  normCie10,
  lookupDiagnosticoExactoDb,
  lookupDiagnosticoDb
};
