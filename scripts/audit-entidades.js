require('dotenv').config({ path: '.env.dev' });
const db = require('../utils/db-mysql');

function normKey(s) {
  return String(s || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

(async () => {
  await db.initPool();
  const rows = await db.query('SELECT id, nombre, activo FROM entidades ORDER BY nombre');
  console.log('ENTIDADES TABLE (' + rows.length + '):');
  rows.forEach((r) => console.log(r.id, JSON.stringify(r.nombre), r.activo));

  const usadas = await db.query(`
    SELECT valor, COUNT(*) AS c FROM (
      SELECT TRIM(entidad) AS valor FROM turnos WHERE entidad IS NOT NULL AND TRIM(entidad) <> ''
      UNION ALL
      SELECT TRIM(nombre_entidad) AS valor FROM recibos WHERE nombre_entidad IS NOT NULL AND TRIM(nombre_entidad) <> ''
    ) t GROUP BY valor ORDER BY c DESC
  `);
  console.log('\nUSADAS EN TURNOS/RECIBOS (' + usadas.length + '):');
  usadas.forEach((r) => console.log(r.c, JSON.stringify(r.valor)));

  const byKey = new Map();
  for (const r of rows) {
    const k = normKey(r.nombre);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  console.log('\nDUPLICADOS EN TABLA entidades (misma clave normalizada):');
  for (const [k, list] of byKey) {
    if (list.length > 1) console.log(k, list.map((x) => ({ id: x.id, nombre: x.nombre })));
  }

  const catalogKeys = new Set(rows.map((r) => normKey(r.nombre)));
  const extras = usadas.filter((u) => !catalogKeys.has(normKey(u.valor)));
  console.log('\nEXTRAS (en turnos/recibos, no en catálogo):', extras.length);
  extras.slice(0, 30).forEach((u) => console.log(JSON.stringify(u.valor)));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
