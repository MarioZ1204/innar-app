#!/usr/bin/env node
require('dotenv').config();
const db = require('../utils/db-mysql');
const { syncRipsCarpetasDias } = require('../utils/soportes-rips-carpetas-sync');

async function main() {
  const args = process.argv.slice(2);
  const diaIds = args
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  await db.initPool();

  let targetDias = diaIds;
  if (!targetDias.length) {
    const rows = await db.query(
      `SELECT id FROM sop_dias ORDER BY periodo_id ASC, dia ASC, id ASC`
    );
    targetDias = rows.map((row) => row.id);
  }

  console.log(`[RIPS] Procesando ${targetDias.length} día(s) ...`);
  const result = await syncRipsCarpetasDias(db, targetDias, null);
  console.log(`[RIPS] Carpetas espejo creadas: ${result.length}`);
  if (result.length) {
    for (const item of result) {
      console.log(`- ${item.codigo}: ${item.ruta}`);
    }
  }
}

main().catch((err) => {
  console.error('[RIPS] Error:', err);
  process.exitCode = 1;
}).finally(() => {
  db.closePool().catch(() => {});
});
