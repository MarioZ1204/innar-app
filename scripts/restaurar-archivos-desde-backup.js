#!/usr/bin/env node
/**
 * Restaura desde un backup completo (ZIP con uploads/) los archivos que no
 * existen actualmente en disco, sin tocar la base de datos.
 *
 * Uso:
 *   node scripts/restaurar-archivos-desde-backup.js                 -> usa el backup más reciente
 *   node scripts/restaurar-archivos-desde-backup.js innar-completo-2026-08-01T10-00-00.zip
 *   node scripts/restaurar-archivos-desde-backup.js --overwrite     -> también sobreescribe existentes
 *   node scripts/restaurar-archivos-desde-backup.js --solo soportes/ -> restringe a un prefijo
 */
const { restoreMissingUploadsFromBackup, latestFullBackupFilename } = require('../utils/soportes-backup-restore');

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const soloIdx = args.indexOf('--solo');
  const onlyPrefixes = soloIdx !== -1 && args[soloIdx + 1] ? [args[soloIdx + 1]] : [];
  const backupFilename = args.find((a) => !a.startsWith('--') && a !== onlyPrefixes[0]) || latestFullBackupFilename();

  if (!backupFilename) {
    console.error('No hay backups completos disponibles para restaurar.');
    process.exitCode = 1;
    return;
  }

  console.log(`Restaurando archivos faltantes desde: ${backupFilename}${overwrite ? ' (sobreescribiendo existentes)' : ''}`);
  const result = await restoreMissingUploadsFromBackup({ backupFilename, overwrite, onlyPrefixes });

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
