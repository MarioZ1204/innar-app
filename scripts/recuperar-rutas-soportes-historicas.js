#!/usr/bin/env node
/**
 * Recupera rutas y nombres de archivos SOPORTES a partir de rutas históricas
 * cuando el registro quedó apuntando a una ruta vieja, a un nombre cambiado o a
 * un archivo compartido por otro slot.
 *
 * Uso:
 *   node scripts/recuperar-rutas-soportes-historicas.js
 *   node scripts/recuperar-rutas-soportes-historicas.js 77 88 99
 */

const db = require('../utils/db-mysql');
const { repararArchivosExpediente } = require('../utils/soportes-exp-archivo');

async function main() {
  const idsArg = process.argv.slice(2)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  await db.initPool();

  let expedienteIds = idsArg;
  if (!expedienteIds.length) {
    const rows = await db.query(
      'SELECT DISTINCT expediente_id FROM sop_exp_archivos WHERE expediente_id IS NOT NULL ORDER BY expediente_id'
    );
    expedienteIds = rows.map((row) => row.expediente_id).filter(Boolean);
  }

  if (!expedienteIds.length) {
    console.log('No hay expedientes SOPORTES con archivos para recuperar.');
    return;
  }

  console.log(`Recuperando rutas históricas para ${expedienteIds.length} expediente(s)...`);

  let procesados = 0;
  let cambios = 0;

  for (const expedienteId of expedienteIds) {
    try {
      const reparaciones = await repararArchivosExpediente(expedienteId);
      const aplicadas = reparaciones.filter((item) => item?.repaired);
      procesados += 1;
      cambios += aplicadas.length;
      console.log(`[expediente ${expedienteId}] ${aplicadas.length} cambios aplicados sobre ${reparaciones.length} slot(s)`);
    } catch (error) {
      console.error(`[expediente ${expedienteId}] ERROR:`, error.message);
    }
  }

  console.log(`Proceso finalizado. Expedientes procesados: ${procesados}; cambios aplicados: ${cambios}`);
}

main().catch((error) => {
  console.error('Fallo al recuperar rutas históricas de SOPORTES:', error);
  process.exitCode = 1;
});
