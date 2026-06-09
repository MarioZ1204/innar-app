/**
 * Jerarquía de carpetas PDX (contenedoras y anidación).
 */

function normalizarParentId(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Mapa id → parent_id (0 = raíz). */
function esAncestroEnMapa(posibleAncestroId, carpetaId, parentById) {
  const anc = parseInt(posibleAncestroId, 10);
  let cur = parseInt(carpetaId, 10);
  if (!anc || !cur || anc === cur) return false;
  const seen = new Set();
  while (cur) {
    const p = normalizarParentId(parentById[cur]);
    if (!p) return false;
    if (p === anc) return true;
    if (seen.has(p)) return false;
    seen.add(p);
    cur = p;
  }
  return false;
}

async function cargarParentMapPdx(db) {
  const rows = await db.query('SELECT id, parent_id FROM sop_pdx_carpetas');
  const map = {};
  for (const r of rows) map[r.id] = normalizarParentId(r.parent_id);
  return map;
}

async function esAncestroPdx(db, posibleAncestroId, carpetaId) {
  const map = await cargarParentMapPdx(db);
  return esAncestroEnMapa(posibleAncestroId, carpetaId, map);
}

async function validarMoverCarpetaPdx(db, carpetaId, nuevoParentIdRaw) {
  const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [carpetaId]);
  if (!carpetaRows.length) {
    return { ok: false, status: 404, error: 'Carpeta no encontrada' };
  }
  const carpeta = carpetaRows[0];
  const nuevoParentId = normalizarParentId(nuevoParentIdRaw);
  if (nuevoParentId === carpetaId) {
    return { ok: false, status: 400, error: 'No puede mover una carpeta dentro de sí misma' };
  }
  if (nuevoParentId > 0) {
    const parentRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [nuevoParentId]);
    if (!parentRows.length) {
      return { ok: false, status: 404, error: 'Carpeta destino no encontrada' };
    }
    if (!parentRows[0].es_contenedor) {
      return { ok: false, status: 400, error: 'Solo puede soltar dentro de carpetas contenedoras' };
    }
    if (await esAncestroPdx(db, carpetaId, nuevoParentId)) {
      return { ok: false, status: 400, error: 'No puede mover una carpeta dentro de una subcarpeta suya' };
    }
  }
  const dup = await db.query(
    `SELECT id FROM sop_pdx_carpetas
     WHERE parent_id = ? AND periodo = ? AND nombre_display = ? AND id != ?
     LIMIT 1`,
    [nuevoParentId, carpeta.periodo, carpeta.nombre_display, carpetaId]
  );
  if (dup.length) {
    return { ok: false, status: 409, error: 'Ya existe una carpeta con ese nombre en el destino' };
  }
  return { ok: true, carpeta, nuevoParentId };
}

module.exports = {
  normalizarParentId,
  esAncestroEnMapa,
  esAncestroPdx,
  validarMoverCarpetaPdx
};
