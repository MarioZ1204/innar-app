/**
 * Reorden de filas del anexo FIDU (como mover filas en una hoja de cálculo).
 */

function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listaIds(ids) {
  return (Array.isArray(ids) ? ids : []).map(toId).filter(Boolean);
}

/**
 * Mueve `id` para que quede justo antes de `beforeId`.
 * Si `beforeId` es null, lo envía al final.
 */
function moverIdAntesDe(ids, id, beforeId) {
  const list = listaIds(ids);
  const moved = toId(id);
  if (!moved) return list;
  if (list.indexOf(moved) < 0) return list;
  const rest = list.filter((x) => x !== moved);
  const dest = toId(beforeId);
  if (!dest) return [...rest, moved];
  if (dest === moved) return list;
  const to = rest.indexOf(dest);
  if (to < 0) return list;
  const next = rest.slice();
  next.splice(to, 0, moved);
  return next;
}

/** Mueve `id` para que quede justo después de `afterId`. */
function moverIdDespuesDe(ids, id, afterId) {
  const list = listaIds(ids);
  const moved = toId(id);
  const after = toId(afterId);
  if (!moved || !after || moved === after) return list;
  if (list.indexOf(moved) < 0) return list;
  const rest = list.filter((x) => x !== moved);
  const to = rest.indexOf(after);
  if (to < 0) return list;
  const next = rest.slice();
  next.splice(to + 1, 0, moved);
  return next;
}

function reordenarFilaAnexo(ids, id, dest = {}) {
  if (dest.beforeId != null && dest.beforeId !== '') {
    return moverIdAntesDe(ids, id, dest.beforeId);
  }
  if (dest.afterId != null && dest.afterId !== '') {
    return moverIdDespuesDe(ids, id, dest.afterId);
  }
  return moverIdAntesDe(ids, id, null);
}

function mismoOrdenIds(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((id, i) => Number(id) === Number(b[i]));
}

module.exports = {
  moverIdAntesDe,
  moverIdDespuesDe,
  reordenarFilaAnexo,
  mismoOrdenIds
};
