/**
 * Evita recibos huérfanos al borrar turnos (FK / turno_id apuntando a un id inexistente).
 */
function idsTurnoPositivos(turnoIds) {
  const raw = Array.isArray(turnoIds) ? turnoIds : [turnoIds];
  const seen = new Set();
  const ids = [];
  for (const n of raw) {
    const id = parseInt(n, 10);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function desvincularRecibosDeTurnos(db, turnoIds) {
  const ids = idsTurnoPositivos(turnoIds);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.execute(
    `UPDATE recibos SET turno_id = NULL WHERE turno_id IN (${placeholders})`,
    ids
  );
  return Number(result?.affectedRows) || 0;
}

module.exports = {
  idsTurnoPositivos,
  desvincularRecibosDeTurnos
};
