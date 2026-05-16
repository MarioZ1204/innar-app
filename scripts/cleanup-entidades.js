/**
 * Limpieza única de entidades (también aplicada vía rt_entidades_cleanup al arranque).
 * Uso: node scripts/cleanup-entidades.js
 */
require('dotenv').config({ path: '.env.dev' });
require('dotenv').config();
const db = require('../utils/db-mysql');
const { runRuntimeMigrations } = require('../migrations/runtime-migrations');

(async () => {
  await db.initPool();
  await runRuntimeMigrations(db, console);
  const rows = await db.query('SELECT id, nombre FROM entidades WHERE activo=1 ORDER BY nombre');
  console.log('Entidades activas tras limpieza:', rows.map((r) => r.nombre).join(', '));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
