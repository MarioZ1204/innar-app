#!/usr/bin/env node
/**
 * Restaura desde los backups disponibles (completos y/o solo archivos) los
 * archivos que no existen actualmente en disco, sin tocar la base de datos.
 *
 * Por defecto revisa TODOS los backups, del más reciente al más antiguo, para
 * maximizar la recuperación (un archivo puede faltar en el backup más nuevo
 * pero existir en uno más viejo).
 *
 * Uso:
 *   node scripts/restaurar-archivos-desde-backup.js                    -> revisa todos los backups
 *   node scripts/restaurar-archivos-desde-backup.js innar-completo-2026-08-01T10-00-00.zip  -> uno específico
 *   node scripts/restaurar-archivos-desde-backup.js --overwrite        -> también sobreescribe existentes (solo con un backup específico)
 *   node scripts/restaurar-archivos-desde-backup.js --solo soportes/   -> restringe a un prefijo
 */
const {
  restoreMissingUploadsFromBackup,
  restoreMissingUploadsFromAllBackups
} = require('../utils/soportes-backup-restore');

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const soloIdx = args.indexOf('--solo');
  const onlyPrefixes = soloIdx !== -1 && args[soloIdx + 1] ? [args[soloIdx + 1]] : [];
  const backupFilename = args.find((a) => !a.startsWith('--') && a !== onlyPrefixes[0]) || null;

  let result;
  if (backupFilename) {
    console.log(`Restaurando archivos faltantes desde: ${backupFilename}${overwrite ? ' (sobreescribiendo existentes)' : ''}`);
    result = await restoreMissingUploadsFromBackup({ backupFilename, overwrite, onlyPrefixes });
  } else {
    console.log('Restaurando archivos faltantes revisando todos los backups disponibles (del más reciente al más antiguo)...');
    result = await restoreMissingUploadsFromAllBackups({ onlyPrefixes });
    if (!result.backupsRevisados.length) {
      console.error('No hay backups disponibles para restaurar.');
      process.exitCode = 1;
      return;
    }
    console.log(`Backups revisados: ${result.backupsRevisados.join(', ')}`);
  }

  console.log(`Restaurados: ${result.restaurados.length}`);
  console.log(`Omitidos (ya existían): ${result.omitidos}`);
  if (result.errores.length) {
    console.log(`Errores: ${result.errores.length}`);
    result.errores.forEach((e) => console.log(`  - ${e.ruta}: ${e.error}`));
  }
  if (result.restaurados.length) {
    console.log('Archivos restaurados:');
    result.restaurados.forEach((r) => console.log(`  + ${r}`));
  }
}

main().catch((error) => {
  console.error('Fallo al restaurar archivos desde backup:', error);
  process.exitCode = 1;
});
